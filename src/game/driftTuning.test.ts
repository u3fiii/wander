import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR_CONFIG, JUICE_CONFIG } from './config.ts';
import { readFileSync } from 'node:fs';
import { DRIFT_CAM, DRIFT_CINE, DRIFT_SCORE, DRIFT_TUNING_SLIDERS, applyDriftTuning, currentDriftTuning } from './driftNumbers.ts';
import type { DriftTuning } from './driftNumbers.ts';

const DRIFT_TUNING_SAVED = JSON.parse(readFileSync(new URL('./driftTuning.json', import.meta.url), 'utf8')) as DriftTuning;

test('every drift number has a slider, and the sliders move the numbers they say', () => {
  assert.deepEqual(DRIFT_TUNING_SLIDERS.map(slider => slider.key).sort(), Object.keys(DRIFT_TUNING_SAVED).sort());
  const before = currentDriftTuning();
  applyDriftTuning({ ...before, driftMinSpeed: 9, driftAngleMax: 0.4, scoreGrace: 1, camSwing: 5, cineRest: 33, driftSteerMin: 0.5 });
  assert.equal(CAR_CONFIG.driftMinSpeed, 9);
  assert.equal(CAR_CONFIG.driftSteerMin, 0.5);
  assert.equal(JUICE_CONFIG.driftAngleMax, 0.4);
  assert.equal(DRIFT_SCORE.grace, 1);
  assert.equal(DRIFT_CAM.swing, 5);
  assert.equal(DRIFT_CINE.rest, 33);
  applyDriftTuning(before);
  assert.equal(CAR_CONFIG.driftMinSpeed, before.driftMinSpeed);
});

test('every slider range holds its saved value', () => {
  for (const slider of DRIFT_TUNING_SLIDERS) {
    const value = DRIFT_TUNING_SAVED[slider.key];
    assert.ok(value >= slider.min && value <= slider.max, `${slider.key} = ${value} is outside ${slider.min}..${slider.max}`);
  }
});
