import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptResolution, createResolutionState, QUALITY_PROFILES, resolutionBounds, selectVisualQuality } from './renderQuality.ts';

test('touch devices get a sharp mobile profile, with a fallback for constrained hardware', () => {
  assert.equal(selectVisualQuality({ touch: true }), 'mobile');
  assert.equal(selectVisualQuality({ touch: true, cores: 4, memory: 4 }), 'mobile');
  assert.equal(selectVisualQuality({ touch: true, cores: 2 }), 'low');
  assert.equal(selectVisualQuality({ touch: true, memory: 2 }), 'low');
  assert.equal(selectVisualQuality({}), 'high');
  assert.equal(selectVisualQuality({ cores: 4 }), 'low');
  assert.equal(selectVisualQuality({ memory: 4 }), 'low');
  assert.equal(selectVisualQuality({ touch: true, forced: 'high' }), 'high');
  assert.equal(selectVisualQuality({ forced: 'mobile' }), 'mobile');
  assert.equal(selectVisualQuality({ forced: 'low' }), 'low');
  assert.equal(selectVisualQuality({ touch: true, forced: 'invalid' }), 'mobile');
});

test('mobile retains a clarity floor without supersampling lower-density screens', () => {
  assert.deepEqual(resolutionBounds(QUALITY_PROFILES.mobile, 3), { min: 1.25, max: 2, initial: 1.75 });
  assert.deepEqual(resolutionBounds(QUALITY_PROFILES.mobile, 1), { min: 1, max: 1, initial: 1 });
  assert.deepEqual(resolutionBounds(QUALITY_PROFILES.mobile, NaN), { min: 1, max: 1, initial: 1 });
});

function simulator(deviceDpr = 3) {
  const bounds = resolutionBounds(QUALITY_PROFILES.mobile, deviceDpr);
  const state = createResolutionState();
  let dpr = bounds.initial;
  const frames = (count: number, delta = 1 / 60, active = true) => {
    for (let i = 0; i < count; i++) dpr = adaptResolution(state, delta, active, dpr, bounds);
    return dpr;
  };
  return { frames, state, get dpr() { return dpr; } };
}

test('startup and a brief hitch do not lower mobile quality', () => {
  const s = simulator();
  s.frames(85, 1 / 30); // Slow startup, within the warmup.
  assert.equal(s.dpr, 1.75);
  s.frames(30);
  s.frames(30, 1 / 30); // A single short slow window, then smooth rendering.
  s.frames(180);
  assert.equal(s.dpr, 1.75);
});

test('sustained overload lowers quality to its floor and stable frames recover it', () => {
  const s = simulator();
  s.frames(900, 1 / 30);
  assert.equal(s.dpr, 1.25);
  s.frames(3600);
  assert.equal(s.dpr, 2);
});

test('pause and long gaps clear stale samples and give rendering a fresh warmup', () => {
  for (const [delta, active] of [[1 / 30, false], [1, true], [NaN, true]] as const) {
    const s = simulator();
    s.frames(700);
    s.frames(35, 1 / 30);
    const before = s.dpr;
    s.frames(1, delta, active);
    assert.deepEqual(s.state, createResolutionState());
    s.frames(85, 1 / 30);
    assert.equal(s.dpr, before);
  }
});

test('a lower-density device never increases resolution past its native density', () => {
  const s = simulator(1);
  assert.equal(s.frames(2400), 1);
  assert.equal(s.frames(900, 1 / 30), 1);
});

test('intermediate frame rates do not repeatedly change resolution', () => {
  const s = simulator();
  assert.equal(s.frames(1800, 1 / 52), 1.75);
});
