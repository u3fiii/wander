import test from 'node:test';
import assert from 'node:assert/strict';
import { DRIVE_MODE, EDGE, RAILS, TIRES, lateralScale, emptyControls, initialCar, initialLoopCar, keepOnBridge, isBlocked, onRoadSurface, recoverToRoad, stepCar, stepLoopCar } from './driving.ts';
import type { CarState, Controls } from './driving.ts';
import { CAR_CONFIG, LOOP_DRIVE } from './config.ts';
import { FULL_TURN, GLOBE_RADIUS, LOOP_LENGTH, loopFrame, loopLatitude, loopPoint } from './globe.ts';
import { WORLD_SETTINGS, distanceToRoadNetwork, landInfluence } from './worldMap.ts';

function drive(car: CarState, input: Partial<Controls>, seconds: number, fps = 60) {
  for (let i = 0; i < Math.round(seconds * fps); i++) stepLoopCar(car, { ...emptyControls(), ...input }, 1 / fps);
  return car;
}

test('accelerates along the starting street without crossing city blocks', () => {
  const car = initialCar(); const input = { ...emptyControls(), forward: true };
  for (let i = 0; i < 240; i++) stepCar(car, input, 1 / 60);
  assert.ok(car.z < 0); assert.ok(car.distance > 35); assert.ok(car.speed <= 23);
  assert.equal(isBlocked(car.x, car.z), false);
});
test('braking stops rather than reversing, reverse gear is bounded', () => {
  const car = initialCar(); car.speed = 20;
  for (let i = 0; i < 100; i++) stepCar(car, { ...emptyControls(), brake: true }, 1 / 60);
  assert.equal(car.speed, 0);
  for (let i = 0; i < 120; i++) stepCar(car, { ...emptyControls(), back: true }, 1 / 60);
  assert.equal(car.speed, -8);
});
test('a curb collision keeps the car outside the building block', () => {
  const car = initialCar(); car.x = 5; car.z = 25; car.heading = -Math.PI / 2; car.speed = 12;
  let hit = false;
  for (let i = 0; i < 60; i++) { hit = stepCar(car, { ...emptyControls(), forward: true }, 1 / 60) || hit; assert.equal(isBlocked(car.x, car.z), false); }
  assert.ok(hit); assert.ok(car.x < 6);
});
test('large frame gaps are bounded and cannot jump through an entire block', () => {
  const car = initialCar(); car.speed = 23; const before = car.z;
  stepCar(car, emptyControls(), 10);
  assert.ok(Math.abs(car.z - before) < 1.2);
});
test('steering direction reverses while backing up', () => {
  const front = initialCar(); front.speed = 5;
  const back = initialCar(); back.speed = -5;
  stepCar(front, { ...emptyControls(), left: true }, 1 / 60);
  stepCar(back, { ...emptyControls(), left: true }, 1 / 60);
  assert.ok(front.heading > 0); assert.ok(back.heading < 0);
});
test('loop driving wraps around the globe indefinitely', () => {
  const car = initialLoopCar(); const input = { ...emptyControls(), forward: true };
  for (let i = 0; i < 9000; i++) stepLoopCar(car, input, 1 / 60);
  assert.ok(car.distance > LOOP_LENGTH * 3);
  assert.ok(car.x >= 0 && car.x < Math.PI * 2);
});
test('globe acceleration builds progressively and speed stays bounded in both gears', () => {
  const car = initialLoopCar();
  drive(car, { forward: true }, 0.5);
  const launchSpeed = car.speed;
  // Launch is a deliberate kick, then the engine tapers toward top speed.
  assert.ok(launchSpeed > 4 && launchSpeed < 9);
  drive(car, { forward: true }, 1);
  assert.ok(car.speed > launchSpeed && car.speed < CAR_CONFIG.maxSpeed);
  drive(car, { forward: true }, 20);
  assert.ok(car.speed > CAR_CONFIG.maxSpeed * 0.9 && car.speed <= CAR_CONFIG.maxSpeed);
  drive(car, { back: true }, 20);
  assert.equal(car.speed, -CAR_CONFIG.reverseMaxSpeed);
});
test('left and right steer continuously between junctions', () => {
  const makeCar = () => ({ ...initialLoopCar(), x: 0.5 });
  const straight = drive(makeCar(), { forward: true }, 1);
  const left = drive(makeCar(), { forward: true, left: true }, 1);
  const right = drive(makeCar(), { forward: true, right: true }, 1);
  assert.ok(left.z > straight.z + 0.5);
  assert.ok(right.z < straight.z - 0.5);
  assert.ok(left.heading > straight.heading);
  assert.ok(right.heading < straight.heading);
});
test('stationary wheels can steer without rotating or moving the body', () => {
  const car = drive(initialLoopCar(), { left: true }, 2);
  assert.ok(car.steering > 0);
  assert.equal(car.speed, 0);
  assert.equal(car.x, 0);
  assert.equal(car.z, 0);
  assert.equal(car.heading, 0);
  assert.equal(car.wheelTravel, 0);
});
test('globe braking takes priority over the accelerator and never reverses', () => {
  const car = { ...initialLoopCar(), speed: 12 };
  drive(car, { brake: true, forward: true }, 1);
  assert.equal(car.speed, 0);
  const stopped = { ...car };
  drive(car, { brake: true, forward: true }, 1);
  assert.equal(car.x, stopped.x);
  assert.equal(car.z, stopped.z);
  assert.equal(car.wheelTravel, stopped.wheelTravel);
});
test('opposite pedal stops before engaging reverse, and conflicting pedals brake', () => {
  const car = { ...initialLoopCar(), speed: 0.1 };
  stepLoopCar(car, { ...emptyControls(), back: true }, 1 / 120);
  assert.equal(car.speed, 0);
  stepLoopCar(car, { ...emptyControls(), back: true }, 1 / 120);
  assert.ok(car.speed < 0);
  drive(car, { forward: true, back: true }, 1);
  assert.equal(car.speed, 0);
  stepLoopCar(car, { ...emptyControls(), forward: true }, 1 / 120);
  assert.ok(car.speed > 0);
});
test('coasting slows gradually and comes to rest without reversing', () => {
  for (const speed of [10, -4]) {
    const car = { ...initialLoopCar(), speed };
    drive(car, {}, 1);
    assert.equal(Math.sign(car.speed), Math.sign(speed));
    assert.ok(Math.abs(car.speed) < Math.abs(speed));
    drive(car, {}, 30);
    assert.equal(car.speed, 0);
  }
});
test('reverse steering follows rearward travel and wheels roll backwards', () => {
  const forward = drive({ ...initialLoopCar(), speed: 4 }, { left: true }, 0.3);
  const reverse = drive({ ...initialLoopCar(), speed: -4 }, { left: true }, 0.3);
  assert.ok(forward.yawRate > 0);
  assert.ok(reverse.yawRate < 0);
  assert.ok(reverse.wheelTravel < 0);
  assert.ok(reverse.distance > 0);
});
test('steering returns smoothly and high-speed cornering respects grip', () => {
  const slow = drive({ ...initialLoopCar(), speed: 4 }, { left: true }, 0.5);
  const fast = drive({ ...initialLoopCar(), speed: 18 }, { forward: true, left: true }, 0.5);
  assert.ok(Math.abs(fast.yawRate * fast.speed) <= CAR_CONFIG.lateralGrip + 0.01);
  const angle = slow.steering;
  stepLoopCar(slow, emptyControls(), 1 / 60);
  assert.ok(slow.steering > 0 && slow.steering < angle);
  drive(slow, {}, 1);
  assert.ok(Math.abs(slow.steering) < 0.001);
});
test('movement follows the nose on the sphere, including at the poles', () => {
  for (const latitude of [0.32, Math.PI / 2, -Math.PI / 2]) {
    const car = { ...initialLoopCar(), x: 0.4, speed: 8, heading: 0.8 };
    car.z = (latitude - loopLatitude(car.x)) * GLOBE_RADIUS;
    const frame = loopFrame(car.x, car.z);
    const [n, t] = [frame.normal, frame.tangent];
    const left = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
    const facing = t.map((v, i) => v * Math.cos(car.heading) + left[i] * Math.sin(car.heading));
    stepLoopCar(car, emptyControls(), 1 / 120);
    const point = loopPoint(car.x, car.z);
    const displacement = point.map((v, i) => v - frame.point[i]);
    const alignment = displacement.reduce((sum, v, i) => sum + v * facing[i], 0) / Math.hypot(...displacement);
    assert.ok(alignment > 0.99999, `nose alignment at latitude ${latitude}: ${alignment}`);
    assert.ok(Math.abs(Math.hypot(point[0], point[1] + GLOBE_RADIUS, point[2]) - GLOBE_RADIUS) < 1e-9);
    assert.ok(Object.values(car).every(Number.isFinite));
  }
});
test('equivalent inputs behave consistently at 30, 60, 120 and 144 fps', () => {
  const simulate = (fps: number) => {
    const car = initialLoopCar();
    drive(car, { forward: true }, 2, fps);
    drive(car, { forward: true, left: true }, 1, fps);
    drive(car, { right: true }, 1, fps);
    drive(car, { brake: true }, 1, fps);
    drive(car, { back: true, left: true }, 1, fps);
    return car;
  };
  const reference = simulate(120);
  for (const fps of [30, 60, 144]) {
    const car = simulate(fps);
    const difference = Math.hypot(...loopPoint(car.x, car.z).map((v, i) => v - loopPoint(reference.x, reference.z)[i]));
    assert.ok(difference < 0.04, `${fps} fps position differs by ${difference}m`);
    assert.ok(Math.abs(car.speed - reference.speed) < 0.02);
    assert.ok(Math.abs(car.distance - reference.distance) < 0.04);
  }
});
test('invalid frame times are ignored and long gaps cannot teleport the car', () => {
  const car = { ...initialLoopCar(), speed: 18 };
  const before = { ...car };
  for (const delta of [0, -1, NaN, Infinity]) {
    stepLoopCar(car, { ...emptyControls(), left: true }, delta);
    assert.deepEqual(car, before);
  }
  stepLoopCar(car, emptyControls(), 10);
  assert.ok(car.distance > 0 && car.distance <= CAR_CONFIG.maxSpeed * LOOP_DRIVE.maxFrameDelta);
  assert.ok(Object.values(car).every(Number.isFinite));
});
test('crossing the longitude seam works forwards and backwards', () => {
  for (const speed of [8, -4]) {
    const car = { ...initialLoopCar(), speed, x: speed > 0 ? FULL_TURN - 0.001 : 0.001 };
    drive(car, {}, 0.1);
    assert.ok(car.x >= 0 && car.x < FULL_TURN);
    assert.ok(speed > 0 ? car.x < 0.1 : car.x > FULL_TURN - 0.1);
  }
});

test('the car cannot drive into water: it is turned along the shore and can still reverse', () => {
  const car = { ...initialLoopCar(), x: 0, z: 7.4, heading: -Math.PI / 2, speed: 7 };
  for (let index = 0; index < 240; index++) {
    stepLoopCar(car, { ...emptyControls(), forward: true }, 1 / 60, true);
    const frame = loopFrame(car.x, car.z);
    const onRoad = onRoadSurface(frame.latitude, car.x);
    assert.ok(onRoad || landInfluence(frame.latitude, car.x) >= LOOP_DRIVE.waterSurfaceInfluence, 'the car entered the water');
  }
  const before = car.distance;
  for (let index = 0; index < 60; index++) stepLoopCar(car, { ...emptyControls(), back: true }, 1 / 60, true);
  assert.ok(car.distance > before, 'reversing away from the shore should move the car');
  assert.ok(Object.values(car).every(Number.isFinite));
});

test('the bridge deck is drivable out to its railings, and the railings hold the car in', () => {
  const bridge = WORLD_SETTINGS.roads.bridgeLongitude;
  const railing = (WORLD_SETTINGS.roads.mainWidth + WORLD_SETTINGS.roads.shoulderExtra) * 0.5;
  const scaleAt = (longitude: number) => {
    const step = 1e-3;
    const slope = (loopLatitude(longitude + step) - loopLatitude(longitude - step)) / (2 * step) / Math.cos(loopLatitude(longitude));
    return 1 / Math.sqrt(1 + slope * slope);
  };
  for (const [lateral, heading] of [[2.6, 0], [-2.6, 0], [1, 0.35], [-1, -0.35]]) {
    const start = bridge - 0.2;
    const car = { ...initialLoopCar(), x: start, z: lateral / scaleAt(start), heading, speed: 10 };
    let worst = 0;
    for (let index = 0; index < 180 && car.x < bridge + 0.2; index++) {
      stepLoopCar(car, { ...emptyControls(), forward: true }, 1 / 60, true);
      if (Math.abs(car.x - bridge) < WORLD_SETTINGS.roads.bridgeDeckHalfSpan) worst = Math.max(worst, Math.abs(car.z) * scaleAt(car.x));
    }
    assert.ok(car.x > bridge + 0.12, `the car crossed the bridge (lateral ${lateral}, heading ${heading})`);
    assert.ok(worst <= railing - CAR_CONFIG.trafficRadius + 0.05, `stayed inside the railings (reached ${worst.toFixed(2)} m)`);
  }
});

test('on rails (mobile) a knock never turns the car round: it keeps driving forward round the loop', () => {
  DRIVE_MODE.rails = true;
  try {
    // Knocked almost all the way round (as a hard hit can do), at speed and stopped, steering either way.
    for (const heading of [2.9, -2.9, 1.8, -1.6]) for (const speed of [12, 1]) for (const steer of ['left', 'right', 'none'] as const) {
      const car = { ...initialLoopCar(), x: 0.6, heading, speed };
      const start = car.x;
      for (let i = 0; i < 60 * 4; i++) {
        stepLoopCar(car, { ...emptyControls(), throttle: RAILS.autoThrottle, left: steer === 'left', right: steer === 'right' }, 1 / 60, true);
        assert.ok(Math.abs(car.heading) <= RAILS.maxHeading + 1e-9, `heading ${car.heading.toFixed(2)} off the road direction`);
      }
      const travelled = Math.atan2(Math.sin(car.x - start), Math.cos(car.x - start));
      assert.ok(travelled > 0.3, `heading ${heading}, speed ${speed}, ${steer}: went ${travelled.toFixed(2)} rad forward`);
    }
    // Back to road on rails also faces forward.
    const car = { ...initialLoopCar(), heading: 3 };
    recoverToRoad(car);
    assert.equal(car.heading, 0);
  } finally { DRIVE_MODE.rails = false; }
});

test('on rails (mobile) the car can be steered onto the curb, and the curb slows it there too', () => {
  DRIVE_MODE.rails = true;
  EDGE.tires = false;
  try {
    const car = { ...initialLoopCar(), x: 0.6, speed: CAR_CONFIG.maxSpeed };
    let curb = 0, lowest = Infinity;
    for (let i = 0; i < 60 * 6; i++) {
      stepLoopCar(car, { ...emptyControls(), throttle: RAILS.autoThrottle, left: true }, 1 / 60, true);
      curb = Math.max(curb, car.curb);
      if (i > 60 * 3) lowest = Math.min(lowest, car.speed);
    }
    assert.ok(curb > 0.5, `reached the curb (${curb.toFixed(2)})`);
    assert.ok(lowest < CAR_CONFIG.maxSpeed * 0.8, `slowed on it (${lowest.toFixed(1)} m/s)`);
  } finally { DRIVE_MODE.rails = false; EDGE.tires = true; }
});

test('with the tyre wall the car bounces off the edge and goes on at speed, never riding along it', () => {
  DRIVE_MODE.rails = true;
  try {
    const car = { ...initialLoopCar(), x: 0.6, speed: CAR_CONFIG.maxSpeed };
    let bounces = 0, lastHit = 0, widest = 0, lowest = Infinity, atWall = 0;
    for (let i = 0; i < 60 * 6; i++) {
      stepLoopCar(car, { ...emptyControls(), throttle: RAILS.autoThrottle, left: i < 60 * 3 }, 1 / 60, true);
      if ((car.tireHit ?? 0) > lastHit + 0.05) bounces++;
      lastHit = car.tireHit ?? 0;
      const lateral = Math.abs(car.z) * lateralScale(car.x);
      widest = Math.max(widest, lateral);
      if (lateral > TIRES.line - 0.05) atWall++;
      if (i > 60) lowest = Math.min(lowest, car.speed);
    }
    assert.ok(bounces >= 1, 'it hit the tyres');
    assert.ok(widest <= (TIRES.line + TIRES.give) * 1.05, `never into them (${widest.toFixed(2)} m)`);
    assert.ok(lowest > CAR_CONFIG.maxSpeed * 0.6, `kept its pace (${lowest.toFixed(1)} m/s at the slowest)`);
    assert.ok(Math.abs(car.z) * lateralScale(car.x) < TIRES.line - 0.3, `let go, it is back in the road (${car.z.toFixed(2)} m)`);
    assert.equal(car.curb, 0, 'no slowing curb');
    void atWall;
  } finally { DRIVE_MODE.rails = false; }
});

test('on rails, let go of the pads and the car lines up with the road again', () => {
  DRIVE_MODE.rails = true;
  try {
    // Pointed at the edge, let go: it turns back along the road before it gets there, bends included.
    for (const x of [0.3, 0.6, 1, 2, 3, 4, 5]) {
      const car = { ...initialLoopCar(), x, heading: 0.3, speed: 12 };
      let widest = 0;
      for (let i = 0; i < 120; i++) {
        stepLoopCar(car, { ...emptyControls(), throttle: RAILS.autoThrottle }, 1 / 60, true);
        widest = Math.max(widest, Math.abs(car.z) * lateralScale(car.x));
      }
      assert.ok(widest < TIRES.line, `at ${x}: never reached the edge (${widest.toFixed(2)} m)`);
      assert.ok(Math.abs(car.heading) < 0.15, `at ${x}: lined up (${car.heading.toFixed(2)} rad)`);
    }
  } finally { DRIVE_MODE.rails = false; }
});

// Road assist: only a hold on the road's edge (the curbs count as road), nothing while the car is inside it.
// The widest the car gets from the road's centre line (m) when it is steered hard out of the road.
function widestOutOfRoad(assist: number) {
  const saved = CAR_CONFIG.roadAssist;
  CAR_CONFIG.roadAssist = assist;
  const car = { ...initialLoopCar(), x: 0.3, z: 0, speed: 12 };
  let widest = 0;
  for (let i = 0; i < 360; i++) {
    stepLoopCar(car, { ...emptyControls(), forward: true, steer: -0.5 }, 1 / 60, true);
    const latitude = loopLatitude(car.x) + car.z / GLOBE_RADIUS;
    widest = Math.max(widest, distanceToRoadNetwork(latitude, car.x) + WORLD_SETTINGS.roads.mainWidth / 2);
  }
  CAR_CONFIG.roadAssist = saved;
  return widest;
}
test('with the road assist high the road edge, curbs included, is a wall; with none the car just leaves', () => {
  assert.ok(widestOutOfRoad(0) > 8, 'no assist: the car drives off');
  assert.ok(widestOutOfRoad(CAR_CONFIG.roadAssistFull) < CAR_CONFIG.roadEdgeHalfWidth + 0.4, 'full assist: held at the edge (within the curbs and shoulder)');
  assert.ok(widestOutOfRoad(0.8) <= widestOutOfRoad(0) + 1e-6, 'a gentle assist never lets it go further than none');
  assert.equal(CAR_CONFIG.roadAssist, CAR_CONFIG.roadAssistFull, 'and by default the edge is a wall');
});
test('road assist does not straighten the car while it is inside the road', () => {
  const heading = (assist: number) => {
    const saved = CAR_CONFIG.roadAssist;
    CAR_CONFIG.roadAssist = assist;
    const car = { ...initialLoopCar(), x: 0.3, z: 0.2, heading: 0.15, speed: 8 };
    for (let i = 0; i < 30; i++) stepLoopCar(car, { ...emptyControls(), forward: true }, 1 / 60, true);
    CAR_CONFIG.roadAssist = saved;
    return car.heading;
  };
  assert.ok(Math.abs(heading(0) - heading(3)) < 1e-9, 'the same heading with no assist and with a lot, well inside the road');
});

test('auto-cruise keeps the car in its own lane while the wheel is untouched, and the player\'s wheel wins', () => {
  const lane = (steer: number) => {
    const car = { ...initialLoopCar(), x: 0.05, z: -3, speed: 6, cruise: 1 };
    // (holding about the traffic's pace, as the auto-cruise does)
    for (let i = 0; i < 60 * 8; i++) stepLoopCar(car, { ...emptyControls(), throttle: Math.max(0, Math.min(1, (6 - car.speed) * 0.9)), steer } as never, 1 / 60, true);
    return car.z;
  };
  assert.ok(Math.abs(lane(0) + CAR_CONFIG.cruiseLaneOffset) < 0.6, 'it settles in the traffic lane');
  const withCruise = { ...initialLoopCar(), x: 0.05, z: 0, speed: 6, cruise: 1 }, without = { ...initialLoopCar(), x: 0.05, z: 0, speed: 6, cruise: 0 };
  for (const car of [withCruise, without]) for (let i = 0; i < 30; i++) stepLoopCar(car, { ...emptyControls(), forward: true, steer: 1 }, 1 / 60, true);
  assert.ok(Math.abs(withCruise.heading - without.heading) < 0.15, 'steering hard overrides the lane keeping');
});

// The assists never fight the player: no pull inside the road (the bridge approach included), and the road's edge is
// a soft cushion rather than a rail.
function assisted(start: Partial<CarState>, steer: (t: number) => number, seconds: number, assists = true) {
  const saved = { roadAssist: CAR_CONFIG.roadAssist, bridgeFunnelAssist: CAR_CONFIG.bridgeFunnelAssist };
  if (!assists) Object.assign(CAR_CONFIG, { roadAssist: 0, bridgeFunnelAssist: 0 });
  const car = { ...initialLoopCar(), ...start };
  let sharpest = 0, previous = car.heading;
  for (let i = 0; i < seconds * 60; i++) {
    stepLoopCar(car, { ...emptyControls(), throttle: Math.max(0, Math.min(1, ((start.speed ?? 12) - car.speed) * 0.9)), steer: steer(i / 60) } as never, 1 / 60, true);
    sharpest = Math.max(sharpest, Math.abs(car.heading - previous) * 60);
    previous = car.heading;
  }
  Object.assign(CAR_CONFIG, saved);
  return { car, sharpest };
}
test('steering near the bridge is the player\'s alone', () => {
  const free = assisted({ x: 1.25, z: 0, speed: 12 }, t => (t < 0.8 ? 0.4 : 0), 1.5, false).car;
  const helped = assisted({ x: 1.25, z: 0, speed: 12 }, t => (t < 0.8 ? 0.4 : 0), 1.5).car;
  assert.ok(Math.abs(helped.z - free.z) < 0.2, `the same line with and without the assist (${helped.z.toFixed(2)} vs ${free.z.toFixed(2)})`);
});
test('heading for the edge, the car is turned along it softly and never leaves the road', () => {
  const { car, sharpest } = assisted({ x: 0.25, z: 0, heading: 0.35, speed: 12 }, () => 0, 2.5);
  const latitude = loopLatitude(car.x) + car.z / GLOBE_RADIUS;
  assert.ok(distanceToRoadNetwork(latitude, car.x) + WORLD_SETTINGS.roads.mainWidth / 2 < CAR_CONFIG.roadEdgeHalfWidth + 0.4, 'still on the road');
  assert.ok(sharpest < 2.5, `no snap (${sharpest.toFixed(2)} rad/s at most)`);
});
test('let go while cruising, the car keeps the lane it was nearer to and follows the road', () => {
  const { car } = assisted({ x: 0.05, z: -3, speed: 6, cruise: 1 }, () => 0, 12);
  assert.ok(Math.abs(car.z + CAR_CONFIG.cruiseLaneOffset) < 0.6, `in its lane (${car.z.toFixed(2)})`);
});

test('riding the curb rumbles the car down to a slower pace; back in the lane it is full speed again', () => {
  EDGE.tires = false;
  try {
  // The offset (along the globe's north) that puts the car's centre `metres` from the road's centre line here.
  const offsetFor = (x: number, metres: number) => {
    let z = 0;
    while (distanceToRoadNetwork(loopLatitude(x) + z / GLOBE_RADIUS, x) + WORLD_SETTINGS.roads.mainWidth / 2 < metres) z += 0.02;
    return z;
  };
  const run = (metres: number) => {
    const car = { ...initialLoopCar(), x: 0.3, z: offsetFor(0.3, metres), speed: CAR_CONFIG.maxSpeed };
    let lowest = Infinity, curb = 0;
    for (let i = 0; i < 120; i++) {
      stepLoopCar(car, { ...emptyControls(), forward: true }, 1 / 60, true);
      curb = Math.max(curb, car.curb);
      lowest = Math.min(lowest, car.speed);
      car.z = offsetFor(car.x, metres); car.heading = 0;
    }
    return { curb, lowest };
  };
  const onCurb = run(2.75), inLane = run(1.2);
  assert.ok(onCurb.curb > 0.5, `on the curb (${onCurb.curb.toFixed(2)})`);
  assert.ok(onCurb.lowest < CAR_CONFIG.maxSpeed * 0.8, `slowed on the curb (${onCurb.lowest.toFixed(1)} m/s)`);
  assert.equal(inLane.curb, 0);
  assert.ok(inLane.lowest > onCurb.lowest + 2, `faster in the lane (${inLane.lowest.toFixed(1)} vs ${onCurb.lowest.toFixed(1)} m/s)`);
  } finally { EDGE.tires = true; }
});


test('bridge rails contain the whole angled car on both sides after a shove', () => {
  const x = WORLD_SETTINGS.roads.bridgeLongitude;
  const step = 1e-3;
  const slope = (loopLatitude(x + step) - loopLatitude(x - step)) / (2 * step) / Math.cos(loopLatitude(x));
  const scale = 1 / Math.sqrt(1 + slope * slope);
  const face = (WORLD_SETTINGS.roads.mainWidth + WORLD_SETTINGS.roads.shoulderExtra) / 2 - WORLD_SETTINGS.roads.bridgeRailInset;
  for (const side of [-1, 1]) for (const angle of [0, 0.45, 1.1]) {
    const car = { ...initialLoopCar(), x, z: side * 3.04 / scale, heading: side * angle, speed: 12 };
    keepOnBridge(car, x, side * 2 / scale, 1 / 60);
    const edge = Math.abs(car.z) * scale + CAR_CONFIG.trafficRadius + CAR_CONFIG.collisionHalfLength * Math.abs(Math.sin(car.heading));
    assert.ok(edge <= face + 1e-6, 'nose, tail and side stay inside the visible rail');
    assert.ok(car.speed > 10, 'a scrape keeps forward momentum');
  }
});

test('steering away from a bridge rail is not straightened back into it', () => {
  const x = WORLD_SETTINGS.roads.bridgeLongitude;
  for (const side of [-1, 1]) {
    const car = { ...initialLoopCar(), x, z: side * 3, heading: -side * 0.4, speed: 8 };
    keepOnBridge(car, x, side * 2.5, 1 / 60);
    assert.equal(car.heading, -side * 0.4);
    assert.equal(car.speed, 8);
  }
});
