import test from 'node:test';
import assert from 'node:assert/strict';
import { pickNearMissCut } from './nearMissCut.ts';

// A scripted "random": the values it will give, in turn.
const rolls = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

test('the chance decides whether a near miss gets a slow-motion at all', () => {
  assert.equal(pickNearMissCut(rolls(0.9, 0.1), 0.7, 0.5), 'none');
  assert.notEqual(pickNearMissCut(rolls(0.5, 0.1), 0.7, 0.5), 'none');
  assert.equal(pickNearMissCut(rolls(0, 0), 0, 0.5), 'none', 'a zero chance never gets one');
  assert.notEqual(pickNearMissCut(rolls(0.999, 0), 1, 0.5), 'none', 'a full chance always does');
});
test('the share decides which one, and either can come', () => {
  assert.equal(pickNearMissCut(rolls(0.1, 0.2), 1, 0.5), 'overhead');
  assert.equal(pickNearMissCut(rolls(0.1, 0.8), 1, 0.5), 'faded');
  assert.equal(pickNearMissCut(rolls(0.1, 0.99), 1, 1), 'overhead', 'all overhead');
  assert.equal(pickNearMissCut(rolls(0.1, 0.0), 1, 0), 'faded', 'all faded');
  const counts = { none: 0, overhead: 0, faded: 0 };
  let seed = 7; const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 4000; i++) counts[pickNearMissCut(random, 0.7, 0.4)]++;
  assert.ok(Math.abs(counts.none / 4000 - 0.3) < 0.04, 'about 30% get none');
  assert.ok(Math.abs(counts.overhead / 4000 - 0.7 * 0.4) < 0.04, 'about 28% overhead');
  assert.ok(Math.abs(counts.faded / 4000 - 0.7 * 0.6) < 0.04, 'about 42% faded');
});
