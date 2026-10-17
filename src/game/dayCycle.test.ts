import test from 'node:test';
import assert from 'node:assert/strict';
import { CYCLE, advanceCycle, cycle, goTo, nightAmount, skyAt, twilight } from './dayCycle.ts';

const day = { top: '#6ecff2', horizon: '#e6f7f3' }, night = { top: '#111118', horizon: '#0a0a0b' };
const dusk = CYCLE.day, nightStart = CYCLE.day + CYCLE.dusk, dawn = nightStart + CYCLE.night;

test('night comes on gradually through dusk and goes off through dawn', () => {
  assert.equal(nightAmount(10), 0);
  assert.equal(nightAmount(nightStart + 5), 1);
  let last = 0;
  for (let t = dusk; t <= nightStart; t += 1) {
    const n = nightAmount(t);
    assert.ok(n >= last - 1e-9, 'never steps back during dusk');
    last = n;
  }
  assert.ok(nightAmount(dawn + CYCLE.dawn * 0.4) > 0 && nightAmount(dawn + CYCLE.dawn * 0.4) < 1);
});

test('the sky runs from the day colours through warm sunset tones to the night colours', () => {
  assert.deepEqual(skyAt(day, night, 10), day);
  assert.deepEqual(skyAt(day, night, nightStart + 5), night);
  const sunset = skyAt(day, night, dusk + CYCLE.dusk * 0.5);
  const [r, , b] = [1, 3, 5].map(i => parseInt(sunset.horizon.slice(i, i + 2), 16));
  assert.ok(r > b, `sunset horizon ${sunset.horizon} is warm`);
  assert.ok(twilight(dusk + CYCLE.dusk * 0.45) > 0.8);
  assert.equal(twilight(10), 0);
});

test('the button cross-fades straight to night in a fraction of a second, then stops', () => {
  cycle.time = 30; cycle.jump = null;
  goTo('night');
  assert.equal(nightAmount(), 0, 'starts from where the sky is');
  let frames = 0;
  for (; frames < 1000 && cycle.jump; frames++) advanceCycle(1 / 60, false);
  assert.ok(frames / 60 >= 0.25 && frames / 60 <= 0.4, `took ${(frames / 60).toFixed(2)} s`);
  assert.equal(nightAmount(), 1);
  const time = cycle.time;
  advanceCycle(1, false);
  assert.equal(cycle.time, time, 'stays put when not running');
});

test('the button back to day ends in full day, and turns round if pressed mid-fade', () => {
  cycle.time = nightStart + 10; cycle.jump = null;
  goTo('day');
  for (let i = 0; i < 9; i++) advanceCycle(1 / 60, false);
  const mid = nightAmount();
  assert.ok(mid > 0 && mid < 1);
  goTo('night');
  advanceCycle(1 / 60, false);
  assert.ok(nightAmount() > mid, 'heads back toward night');
  goTo('day');
  for (let i = 0; i < 1000 && cycle.jump; i++) advanceCycle(1 / 60, false);
  assert.equal(nightAmount(), 0);
});
