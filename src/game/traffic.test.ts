import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR_CONFIG } from './config.ts';
import { initialLoopCar, stepLoopCar } from './driving.ts';
import { GLOBE_RADIUS, loopFrame, loopLatitude } from './globe.ts';
import { NEAR_MISS, classifyTrafficHit, clearObstacleGroup, drainNearMisses, drainTrafficHits, resetNearMiss, setObstacleGroup, trafficContact } from './obstacles.ts';
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
