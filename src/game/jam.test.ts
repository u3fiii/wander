import test from 'node:test';
import assert from 'node:assert/strict';
import { JAM, along, planJam, recordWave, resetJam, setWaveLearned, stepJam, trafficJam, waveLearned } from './jam.ts';

const LENGTH = 190;
const cars = (positions: [number, boolean][]) => positions.map(([progress, forward], index) => ({ index, progress, forward }));
const spread = cars([[0.1, true], [0.3, true], [0.45, false], [0.6, true], [0.7, false], [0.85, false], [0.95, true]]);

test('the shockwave counts as learned only after waves that caught cars', () => {
  setWaveLearned(0);
  recordWave(0);
  assert.equal(waveLearned(), false, 'a wave that missed teaches nothing');
  for (let i = 0; i < JAM.learnAfter; i++) recordWave(2);
  assert.equal(waveLearned(), true);
});

test('until it is learned no jam forms; after, one forms ahead while the wave is ready', () => {
  setWaveLearned(0);
  resetJam();
  assert.equal(stepJam(60, 0, LENGTH, true, true, spread), null, 'not learned: traffic as before');
  setWaveLearned(JAM.learnAfter);
  resetJam();
  assert.equal(stepJam(60, 0, LENGTH, false, true, spread), null, 'not while the wave is charging');
  const plan = stepJam(1, 0, LENGTH, true, true, spread);
  assert.ok(plan, 'a jam forms');
  assert.ok(Math.abs(along(0, plan.centre, LENGTH) - JAM.ahead) < 0.5, 'ahead of the player, out of sight');
  for (const progress of plan.members.values()) assert.ok(Math.abs(along(plan.centre, progress, LENGTH)) <= JAM.spacing * 2 + 0.01, 'bunched up');
  assert.equal(stepJam(1, 0, LENGTH, true, true, spread), null, 'and only one at a time');
});

test('cars near the player are never moved into a jam', () => {
  const near = cars([[0.02, true], [0.05, false], [0.98, true], [0.5, true], [0.6, false], [0.7, true]]);
  const plan = planJam(0, LENGTH, near);
  assert.ok(plan);
  assert.deepEqual([...plan.members.keys()].sort(), [3, 4, 5]);
});

test('the jam breaks up once the player has passed it, and the next waits its turn', () => {
  setWaveLearned(JAM.learnAfter);
  resetJam();
  trafficJam.since = JAM.every;
  const plan = stepJam(1, 0, LENGTH, true, true, spread)!;
  const past = plan.centre + (JAM.endPast + 1) / LENGTH;
  stepJam(1, past, LENGTH, true, true, spread);
  assert.equal(trafficJam.active, false);
  assert.equal(stepJam(1, past, LENGTH, true, true, spread), null, 'not straight away again');
});
