import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyControls, initialCar, isBlocked, stepCar } from './driving.ts';

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
