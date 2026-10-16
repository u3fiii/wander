import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyControls, initialCar, initialLoopCar, isBlocked, stepCar, stepLoopCar } from './driving.ts';
import type { CarState, Controls } from './driving.ts';
import { CAR_CONFIG, LOOP_DRIVE } from './config.ts';
import { FULL_TURN, GLOBE_RADIUS, LOOP_LENGTH, loopFrame, loopLatitude, loopPoint } from './globe.ts';
import { distanceToRoadNetwork, landInfluence } from './worldMap.ts';

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
    const onRoad = distanceToRoadNetwork(frame.latitude, car.x) <= LOOP_DRIVE.waterRoadMargin;
    assert.ok(onRoad || landInfluence(frame.latitude, car.x) >= LOOP_DRIVE.waterSurfaceInfluence, 'the car entered the water');
  }
  const before = car.distance;
  for (let index = 0; index < 60; index++) stepLoopCar(car, { ...emptyControls(), back: true }, 1 / 60, true);
  assert.ok(car.distance > before, 'reversing away from the shore should move the car');
  assert.ok(Object.values(car).every(Number.isFinite));
});
