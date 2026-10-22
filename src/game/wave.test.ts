import test from 'node:test';
import assert from 'node:assert/strict';
import { WAVE, chargeWave, createWave, fireWave, ready, waveOver, waveRadius, waveScore } from './wave.ts';

test('the first shockwave comes soon, the next after the longer charge, and it only fires when ready', () => {
  const wave = createWave();
  assert.equal(fireWave(wave), false, 'not ready at the start');
  let readyAt = 0;
  for (let t = 0; t < 30 && !ready(wave); t += 0.1) { chargeWave(wave, 0.1); readyAt = t + 0.1; }
  assert.ok(Math.abs(readyAt - WAVE.firstAfter) < 0.15, `first ready after ${readyAt.toFixed(1)} s`);
  assert.equal(fireWave(wave), true);
  assert.equal(wave.charge, 0);
  readyAt = 0;
  for (let t = 0; t < 60 && !ready(wave); t += 0.1) { chargeWave(wave, 0.1); readyAt = t + 0.1; }
  assert.ok(Math.abs(readyAt - WAVE.every) < 0.15, `next ready after ${readyAt.toFixed(1)} s`);
});

test('the ring spreads fast at first and reaches its full radius, then is gone', () => {
  const wave = createWave();
  wave.charge = 1;
  fireWave(wave);
  wave.time = WAVE.spread * 0.25;
  const early = waveRadius(wave);
  assert.ok(early > WAVE.radius * 0.5, `half way out in a quarter of the time (${early.toFixed(1)} m)`);
  wave.time = WAVE.spread;
  assert.ok(Math.abs(waveRadius(wave) - WAVE.radius) < 1e-6);
  wave.time = WAVE.spread + 0.01;
  assert.equal(waveRadius(wave), -1);
});

test('once it has spread, the wave is over', () => {
  const wave = createWave();
  wave.time = WAVE.spread + 0.3;
  assert.ok(waveOver(wave));
});

test('a crowded wave pays far more than the same cars one at a time', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(waveScore), [0, 100, 300, 600, 1000]);
  assert.ok(waveScore(4) > 4 * waveScore(1) * 2, 'four at once beat four singles more than twice over');
});
