import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR_CONFIG } from './config.ts';
import { initialLoopCar, stepLoopCar } from './driving.ts';
import { GLOBE_RADIUS, loopFrame, loopLatitude } from './globe.ts';
import { trafficAhead, NEAR_MISS, classifyTrafficHit, clearObstacleGroup, drainNearMisses, drainTrafficHits, isSpecialNearMiss, resetNearMiss, setObstacleGroup, trackNearMiss, trafficContact } from './obstacles.ts';
import type { TrafficContact } from './obstacles.ts';
import { difficulty } from './difficulty.ts';
import type { Obstacle } from './obstacles.ts';

const eastNorth = (v: number[], latitude: number, longitude: number): [number, number] => {
  const east = Math.cos(longitude) * v[0] - Math.sin(longitude) * v[2];
  const north = -Math.sin(latitude) * Math.sin(longitude) * v[0] + Math.cos(latitude) * v[1] - Math.sin(latitude) * Math.cos(longitude) * v[2];
  const length = Math.hypot(east, north);
  return [east / length, north / length];
};

const controls = { forward: true, back: false, left: false, right: false, brake: false };
const pose = (car: ReturnType<typeof initialLoopCar>) => {
  const latitude = loopLatitude(car.x) + car.z / GLOBE_RADIUS;
  const frame = loopFrame(car.x, car.z);
  const left = [
    frame.normal[1] * frame.tangent[2] - frame.normal[2] * frame.tangent[1],
    frame.normal[2] * frame.tangent[0] - frame.normal[0] * frame.tangent[2],
    frame.normal[0] * frame.tangent[1] - frame.normal[1] * frame.tangent[0],
  ];
  const facing = frame.tangent.map((t, i) => t * Math.cos(car.heading) + left[i] * Math.sin(car.heading));
  return { latitude, longitude: car.x, facing: eastNorth(facing, latitude, car.x) };
};

test('the player cannot drive through a traffic car that stays put', () => {
  // Dry run: where the car is after 1.2 s at full throttle is where the traffic car will wait.
  const probe = initialLoopCar();
  for (let i = 0; i < 72; i++) stepLoopCar(probe, controls, 1 / 60);
  const spot = pose(probe);
  const npc: Obstacle = { latitude: spot.latitude, longitude: spot.longitude, radius: 0.55, halfLength: 0.6, movable: true, forward: spot.facing };
  setObstacleGroup('traffic', [npc]);
  try {
    const car = initialLoopCar();
    let worst = Infinity;
    for (let i = 0; i < 240; i++) {
      stepLoopCar(car, controls, 1 / 60);
      npc.ramCooldown = Math.max(0, (npc.ramCooldown ?? 0) - 1 / 60);
      const now = pose(car);
      const gap = trafficContact(now.latitude, now.longitude, now.facing, CAR_CONFIG.collisionHalfLength, CAR_CONFIG.trafficRadius)?.gap ?? Infinity;
      worst = Math.min(worst, gap);
    }
    assert.ok(npc.impact && npc.impact > 0, 'the car reached the traffic car');
    const hits = drainTrafficHits();
    assert.equal(hits.length, 1, 'one head-on hit is scored');
    assert.equal(hits[0].kind, 'front', 'a nose-first hit is scored as front');
    assert.ok(worst > -0.15, `overlapped the traffic car by ${(-worst).toFixed(2)} m`);
  } finally {
    clearObstacleGroup('traffic');
  }
});

test('hits are scored by which part of the car touched, and whether it was the player\'s doing', () => {
  const north: [number, number] = [0, 1];
  const contact = (playerAlong: number, away: [number, number]): TrafficContact =>
    ({ obstacle: {} as Obstacle, gap: -0.1, away, playerAlong });
  // Nose into a car ahead: the car is pushed back against its facing.
  assert.equal(classifyTrafficHit(contact(0.8, [0, -1]), north), 'front');
  // Front corner swerving into a car alongside: still a side clip.
  assert.equal(classifyTrafficHit(contact(0.8, [0.7, -0.7]), north), 'side');
  // Flank of the middle of the car: pushed sideways.
  assert.equal(classifyTrafficHit(contact(0, [1, 0]), north), 'side');
  // Rear of the car clipped from beside.
  assert.equal(classifyTrafficHit(contact(-0.6, [-1, 0]), north), 'side');
  // Traffic rear-ending the player is not scored.
  assert.equal(classifyTrafficHit(contact(-0.8, [0, 1]), north), undefined);
});

// A traffic car parked beside the player's path at the spot where the player is at speed, `lateral` metres to the side.
const parkedAlongside = (lateral: number, steps: number) => {
  const probe = initialLoopCar();
  for (let i = 0; i < steps; i++) stepLoopCar(probe, controls, 1 / 60);
  const spot = pose(probe);
  const [east, north] = [-spot.facing[1] * lateral, spot.facing[0] * lateral];
  const latitude = spot.latitude + north / GLOBE_RADIUS;
  return { probe, npc: { latitude, longitude: spot.longitude + east / (GLOBE_RADIUS * Math.cos(latitude)), radius: 0.55, halfLength: 0.6, movable: true, forward: spot.facing, velocity: 0 } as Obstacle };
};
const driveBy = (npc: Obstacle) => {
  setObstacleGroup('traffic', [npc]);
  drainTrafficHits(); drainNearMisses();
  try {
    const car = initialLoopCar();
    for (let i = 0; i < 300; i++) stepLoopCar(car, controls, 1 / 60);
    return { hits: drainTrafficHits(), misses: drainNearMisses() };
  } finally { clearObstacleGroup('traffic'); resetNearMiss(); }
};

test('flashing past a parked car by a hair is a near miss, once', () => {
  const { probe, npc } = parkedAlongside(1.45, 150);
  assert.ok(Math.abs(probe.speed) > difficulty.nearMissSpeed, 'the player is at speed by then');
  const { hits, misses } = driveBy(npc);
  assert.equal(hits.length, 0);
  assert.equal(misses.length, 1);
  assert.ok(misses[0].gap > 0 && misses[0].gap <= NEAR_MISS.gap);
});

test('passing a car with room to spare is not a near miss', () => {
  assert.equal(driveBy(parkedAlongside(2.6, 150).npc).misses.length, 0);
});

test('ramming a car at speed is a hit with a high closing speed, not a near miss', () => {
  const { hits, misses } = driveBy(parkedAlongside(0, 150).npc);
  assert.equal(misses.length, 0);
  assert.ok(hits.length >= 1);
  assert.ok(hits[0].closing > difficulty.nearMissSpeed);
});

test('a pass is not rewarded early and a later scrape invalidates the whole pass', () => {
  resetNearMiss(); drainNearMisses();
  const obstacle: Obstacle = { latitude: 0, longitude: 0, radius: 0.55, movable: true };
  const track = (gap: number) => trackNearMiss({ obstacle, gap, away: [1, 0], playerAlong: 0 }, 22, 16, 1, false);
  try {
    track(1.2); track(0.25); track(0.4);
    assert.equal(drainNearMisses().length, 0, 'small separation does not trigger a premature celebration');
    track(-0.01); track(0.5); track(1.7);
    assert.equal(drainNearMisses().length, 0, 'even a small scrape cancels the pass');
  } finally { resetNearMiss(); drainNearMisses(); }
});

test('only a fully cleared fast traffic pass with a visible narrow gap qualifies for slow motion', () => {
  resetNearMiss(); drainNearMisses();
  const obstacle: Obstacle = { latitude: 0, longitude: 0, radius: 0.55, movable: true };
  const track = (gap: number) => trackNearMiss({ obstacle, gap, away: [1, 0], playerAlong: 0 }, 22, 16, 1, false);
  try {
    track(1.2); track(0.25); track(0.4); track(1.7);
    const misses = drainNearMisses();
    assert.equal(misses.length, 1);
    const miss = misses[0];
    assert.equal(isSpecialNearMiss(miss), true);
    assert.equal(isSpecialNearMiss({ ...miss, clearance: 0.03 }), false, 'visually grazing the car is not exceptional');
    assert.equal(isSpecialNearMiss({ ...miss, clearance: 0.9 }), false, 'a wide pass is ordinary');
    assert.equal(isSpecialNearMiss({ ...miss, playerSpeed: 7 }), false, 'a slow pass is ordinary');
    assert.equal(isSpecialNearMiss({ ...miss, speed: 8 }), false, 'overtaking with little relative speed is ordinary');
    assert.equal(isSpecialNearMiss({ ...miss, source: 'static' }), false, 'roadside props do not trigger the cut-in');
  } finally { resetNearMiss(); drainNearMisses(); }
});

test('a pass that used boost remains ineligible even if boost ends before separation', () => {
  resetNearMiss(); drainNearMisses();
  const obstacle: Obstacle = { latitude: 0, longitude: 0, radius: 0.55, movable: true };
  try {
    trackNearMiss({ obstacle, gap: 0.25, away: [1, 0], playerAlong: 0 }, 22, 16, 1, true);
    trackNearMiss(undefined, 22, 16, 1, false);
    assert.equal(drainNearMisses().length, 0);
  } finally { resetNearMiss(); drainNearMisses(); }
});

const pastTree = (lateral: number) => {
  const { npc } = parkedAlongside(lateral, 150);
  setObstacleGroup('trees', [{ latitude: npc.latitude, longitude: npc.longitude, radius: 0.5 }]);
  drainTrafficHits(); drainNearMisses();
  try {
    const car = initialLoopCar();
    for (let i = 0; i < 300; i++) stepLoopCar(car, controls, 1 / 60);
    return drainNearMisses();
  } finally { clearObstacleGroup('trees'); resetNearMiss(); }
};

test('threading past a tree at speed is a near miss too', () => {
  assert.equal(pastTree(1.35).length, 1);
  assert.equal(pastTree(3).length, 0, 'not with room to spare');
});

test('running into a tree is never a near miss', () => {
  assert.equal(pastTree(0).length, 0);
});

test('under boost, traffic never slows, turns or shoves the player', () => {
  const boostControls = { ...controls, boost: true };
  const run = (withCar: boolean) => {
    const { npc } = parkedAlongside(0.3, 100);
    if (withCar) setObstacleGroup('traffic', [npc]);
    try {
      const car = initialLoopCar();
      car.boostCharge = 1; // This case starts with boost available.
      drainTrafficHits();
      let boosted = false;
      for (let i = 0; i < 160; i++) { stepLoopCar(car, boostControls, 1 / 60); boosted ||= car.boosting > 0; }
      return Object.assign(car, { hits: drainTrafficHits(), boosted });
    } finally { clearObstacleGroup('traffic'); resetNearMiss(); drainNearMisses(); }
  };
  const clear = run(false), rammed = run(true);
  assert.ok(rammed.boosted, 'boost fired');
  assert.ok(rammed.hits.length >= 1 && rammed.hits[0].boosted, 'the player really hit the car while boosting');
  assert.ok(Math.abs(rammed.speed - clear.speed) < 1e-6, `speed ${rammed.speed} vs ${clear.speed}`);
  assert.ok(Math.abs(rammed.heading - clear.heading) < 1e-6, 'same heading');
  assert.ok(Math.abs(rammed.z - clear.z) < 1e-6 && Math.abs(rammed.x - clear.x) < 1e-6, 'same line');
});

test('in rails mode the car never leaves the road, even steering hard into the verge', async () => {
  const { DRIVE_MODE, RAILS } = await import('./driving.ts');
  DRIVE_MODE.rails = true;
  try {
    const { distanceToRoadNetwork } = await import('./worldMap.ts');
    const car = initialLoopCar();
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      stepLoopCar(car, { ...controls, left: i < 300, right: i >= 300, throttle: RAILS.autoThrottle }, 1 / 60, true);
      // The same test the game uses for "on the road".
      worst = Math.max(worst, distanceToRoadNetwork(loopLatitude(car.x) + car.z / GLOBE_RADIUS, car.x));
    }
    // Held on the curb this long it is slowed right down (CAR_CONFIG.curbSpeedFactorLong), but never stopped.
    assert.ok(car.speed > 3, 'kept driving');
    assert.ok(worst < 0.7, `went ${worst.toFixed(2)} off the road`);
  } finally { DRIVE_MODE.rails = false; }
});

test('the car ahead in the same lane is found with its gap and speed; oncoming and side lanes are not', () => {
  const car = (latitude: number, east: number, velocity: number, direction: 1 | -1) => ({
    latitude, longitude: east / GLOBE_RADIUS, radius: 0.6, movable: true, forward: [0, direction] as [number, number], halfLength: 0.9, velocity,
  });
  setObstacleGroup('ahead', [
    car(10 / GLOBE_RADIUS, 0, 5, 1),     // 10 m ahead, going the same way
    car(6 / GLOBE_RADIUS, 2.4, 5, -1),   // beside us, in the other lane, coming towards us
  ]);
  const found = trafficAhead(0, 0, [0, 1], 18, 1.6, 0.8);
  assert.ok(found && Math.abs(found.gap - (10 - 0.9 - 0.8)) < 0.05, 'the gap is bumper to bumper');
  assert.equal(found!.speed, 5);
  assert.equal(trafficAhead(0, 0, [0, 1], 6, 1.6, 0.8), undefined, 'out of range');
  clearObstacleGroup('ahead');
});

// A car `aside` metres to the player's left (and `along` metres ahead), as a movable obstacle driving the same way.
function carBeside(car: ReturnType<typeof initialLoopCar>, aside: number, along: number): Obstacle {
  const here = pose(car), [fx, fy] = here.facing;
  const east = fx * along - fy * aside, north = fy * along + fx * aside;
  return { latitude: here.latitude + north / GLOBE_RADIUS, longitude: here.longitude + east / (GLOBE_RADIUS * Math.cos(here.latitude)), radius: 0.6, movable: true, forward: [fx, fy], halfLength: 0.9, velocity: 5 };
}
test('a boosting car throws aside traffic it only passes close to, without touching it', () => {
  const car = { ...initialLoopCar(), speed: 14, boostTime: 3 };
  const other = carBeside(car, 1.95, 2); // 0.7 m of air between them
  setObstacleGroup('wake', [other]);
  drainTrafficHits();
  for (let i = 0; i < 20; i++) stepLoopCar(car, { ...controls }, 1 / 60, true);
  const hits = drainTrafficHits();
  clearObstacleGroup('wake');
  assert.equal(car.boosting, 1);
  assert.ok(other.boostHit && (other.impact ?? 0) > 0, 'the car beside was hit by the wake');
  assert.ok(hits.some(hit => hit.wake && hit.boosted), 'and reported as a boosted, no-touch hit');
  assert.ok(car.speed > 10, 'the player kept its speed');
});
test('a boosting car passing at two or three metres no longer throws the car beside it', () => {
  const car = { ...initialLoopCar(), speed: 14, boostTime: 3 };
  const other = carBeside(car, 2.9, 2);
  setObstacleGroup('wake', [other]);
  for (let i = 0; i < 20; i++) stepLoopCar(car, { ...controls }, 1 / 60, true);
  clearObstacleGroup('wake');
  assert.ok(!other.boostHit && !other.impact, 'too far for the wake');
});
test('without boost a car passed at the same distance is left alone', () => {
  const car = { ...initialLoopCar(), speed: 14 };
  const other = carBeside(car, 2.9, 2);
  setObstacleGroup('wake', [other]);
  drainTrafficHits();
  for (let i = 0; i < 20; i++) stepLoopCar(car, { ...controls }, 1 / 60, true);
  clearObstacleGroup('wake');
  assert.ok(!other.boostHit && !other.impact, 'nothing happened to it');
});
test('a car further off than the wake reach is not touched even by a boosting car', () => {
  const car = { ...initialLoopCar(), speed: 14, boostTime: 3 };
  const other = carBeside(car, 6, 2);
  setObstacleGroup('wake', [other]);
  for (let i = 0; i < 20; i++) stepLoopCar(car, { ...controls }, 1 / 60, true);
  clearObstacleGroup('wake');
  assert.ok(!other.boostHit && !other.impact);
});

test('a normal near miss awards the pass without changing the traffic car', () => {
  for (const side of [-1, 1]) {
    resetNearMiss();
    const other: Obstacle = { latitude: 0, longitude: 0, radius: 0.6, movable: true, forward: [0, 1], halfLength: 0.9, velocity: 5 };
    const before = structuredClone(other);
    trackNearMiss({ obstacle: other, gap: 0.2, away: [side, 0], playerAlong: 0 }, 20, 15, side, false);
    trackNearMiss(undefined, 20, 15, side, false);
    assert.equal(drainNearMisses().length, 1, 'the near miss still scores');
    assert.deepEqual(other, before, 'no impact, boost flag, spin trigger or cooldown');
    assert.equal(drainNearMisses().length, 0, 'the pass only scores once');
  }
  resetNearMiss();
});

test('a car thrown by the shockwave that tumbles into the player passes through: no crash, no heart', () => {
  const car = { ...initialLoopCar(), speed: 14 };
  const other = { ...carBeside(car, 0, 1.2), untouchable: 1 }; // right in the car's way
  setObstacleGroup('thrown', [other]);
  drainTrafficHits();
  for (let i = 0; i < 30; i++) stepLoopCar(car, { ...controls }, 1 / 60, true);
  const hits = drainTrafficHits();
  clearObstacleGroup('thrown');
  assert.equal(hits.length, 0, 'not reported as a hit');
  assert.ok(car.speed > 13, `and the player drove straight on (${car.speed.toFixed(1)} m/s)`);
});
