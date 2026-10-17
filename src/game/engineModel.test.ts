import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineState, gearTops, stepEngine } from './engineModel.ts';

const settings = { gears: 5, gearSpread: 0.85, rpmRise: 7, rpmFall: 1.6, revInPlace: 0.55, coastRpm: 0.75, shiftDrop: 0.35, shiftTime: 0.22, boostPitchBump: 0.25, boostBumpTime: 0.6 };
const dt = 1 / 60;

test('rpm rises quickly with the throttle and falls slowly when it is released', () => {
  const state = createEngineState();
  for (let i = 0; i < 20; i++) stepEngine(state, { throttle: 1, speed: 0 }, settings, dt);
  const revved = state.rpm;
  assert.ok(revved > 0.4, `rose to ${revved} in a third of a second`);
  for (let i = 0; i < 20; i++) stepEngine(state, { throttle: 0, speed: 0 }, settings, dt);
  assert.ok(state.rpm > revved * 0.5, `fell only to ${state.rpm} in the same time`);
});

test('accelerating runs up through the gears, each shift dropping the rpm and holding it briefly', () => {
  const state = createEngineState();
  const shifts: number[] = [];
  let lastRpm = 0;
  for (let i = 0; i <= 600; i++) {
    const speed = i / 600;
    const { shifted } = stepEngine(state, { throttle: 1, speed }, settings, dt);
    if (shifted === 'up') { shifts.push(i); assert.ok(state.rpm < lastRpm, 'rpm drops on the shift'); }
    lastRpm = state.rpm;
  }
  assert.equal(shifts.length, 4, 'five gears, four upshifts');
  assert.equal(state.gear, 4);
  assert.deepEqual(gearTops(5, 1), [0.2, 0.4, 0.6, 0.8, 1]);
});

test('slowing down shifts back down, and a boost bumps the pitch for a moment', () => {
  const state = createEngineState();
  stepEngine(state, { throttle: 1, speed: 0.9 }, settings, dt);
  assert.equal(state.gear, 4);
  stepEngine(state, { throttle: 0, speed: 0.1 }, settings, dt);
  assert.equal(state.gear, 0);
  stepEngine(state, { throttle: 1, speed: 0.5, boostStarted: true }, settings, dt);
  assert.equal(state.bump, settings.boostPitchBump);
  for (let i = 0; i < 60; i++) stepEngine(state, { throttle: 1, speed: 0.5 }, settings, dt);
  assert.equal(state.bump, 0);
});
