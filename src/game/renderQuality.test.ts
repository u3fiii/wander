import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptPacing, adaptResolution, createPacingState, createResolutionState, QUALITY_PROFILES, resolutionBounds, selectVisualQuality } from './renderQuality.ts';

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
  assert.deepEqual(resolutionBounds(QUALITY_PROFILES.mobile, 3), { min: 0.9, max: 2, initial: 1.3 });
  assert.deepEqual(resolutionBounds(QUALITY_PROFILES.mobile, 1), { min: 0.9, max: 1, initial: 1 });
  assert.deepEqual(resolutionBounds(QUALITY_PROFILES.mobile, NaN), { min: 0.9, max: 1, initial: 1 });
});

function simulator(deviceDpr = 3) {
  const bounds = resolutionBounds(QUALITY_PROFILES.mobile, deviceDpr);
  const state = createResolutionState();
  let dpr = bounds.initial;
  const frames = (count: number, delta = 1 / 60, active = true, cpu = 0) => {
    for (let i = 0; i < count; i++) dpr = adaptResolution(state, delta, active, dpr, bounds, cpu);
    return dpr;
  };
  return { frames, state, get dpr() { return dpr; } };
}

test('startup and a brief hitch do not lower mobile quality', () => {
  const s = simulator();
  s.frames(85, 1 / 30); // Slow startup, within the warmup.
  assert.equal(s.dpr, 1.3);
  s.frames(30);
  s.frames(30, 1 / 30); // A single short slow window, then smooth rendering.
  s.frames(180);
  assert.ok(s.dpr >= 1.3);
});

test('sustained overload lowers quality to its floor and stable frames recover it', () => {
  const s = simulator();
  s.frames(900, 1 / 30);
  assert.equal(s.dpr, 0.9);
  s.frames(5400);
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
  assert.equal(s.frames(900, 1 / 30), 0.9);
});

test('intermediate frame rates do not repeatedly change resolution', () => {
  const s = simulator();
  assert.equal(s.frames(1800, 1 / 56), 1.3);
});

test('phones with the same reported hardware settle at different resolutions based on frame performance', () => {
  const strong = simulator(), limited = simulator();
  let highestLimited = limited.dpr;
  for (let frame = 0; frame < 5400; frame++) {
    strong.frames(1);
    limited.frames(1, limited.dpr <= 1.3 ? 1 / 60 : 1 / 42);
    highestLimited = Math.max(highestLimited, limited.dpr);
  }
  assert.equal(strong.dpr, 2);
  assert.ok(highestLimited <= 1.4);
  assert.ok(limited.dpr <= 1.4);
});

test('overload recovery waits before trying higher quality again', () => {
  const s = simulator();
  s.frames(900, 1 / 30);
  assert.equal(s.dpr, 0.9);
  assert.equal(s.frames(900), 0.9);
  assert.ok(s.frames(1200) > 0.9);
});

test('slow frames from a busy processor leave the picture sharp; slow frames from the graphics still lower it', () => {
  const cpuBound = simulator();
  cpuBound.frames(900, 1 / 30, true, 0.03);
  assert.equal(cpuBound.dpr, 1.3, 'the main thread used nearly the whole frame: fewer pixels would not help');
  const gpuBound = simulator();
  gpuBound.frames(900, 1 / 30, true, 0.008);
  assert.equal(gpuBound.dpr, 0.9);
});

test('a device that cannot hold 60 settles at a steady 30, and goes back to 60 once its frames get light', () => {
  const state = createPacingState();
  // `delta`: a fixed frame time (a device that can't keep up), or null for one that keeps up with the current rate.
  const run = (seconds: number, delta: number | null, cpu: number) => {
    let fps = state.fps;
    for (let t = 0; t < seconds;) { const d = delta ?? 1 / fps; fps = adaptPacing(state, d, true, cpu); t += d; }
    return fps;
  };
  assert.equal(run(4, null, 0.008), 60, 'smooth: stays at 60');
  assert.equal(run(1.5, 1 / 40, 0.024), 60, 'a short slow patch: still 60');
  assert.equal(run(6, 1 / 40, 0.024), 30, 'sustained: steady 30');
  assert.equal(run(6, null, 0.024), 30, 'still heavy: stays at 30');
  assert.equal(run(25, null, 0.006), 60, 'light again for a while: back to 60');
  // Too hopeful: it drops again, and waits longer before the next try.
  assert.equal(run(6, 1 / 40, 0.024), 30);
  assert.equal(run(25, null, 0.006), 30, 'the wait has doubled');
  assert.equal(run(30, null, 0.006), 60);
});
