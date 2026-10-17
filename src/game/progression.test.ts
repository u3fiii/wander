import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_TITLES, levelFor } from './progression.ts';

test('levels start at 1 and each needs a little more XP than the last', () => {
  assert.deepEqual(levelFor(0), { level: 1, into: 0, need: 120, title: 'Learner' });
  assert.equal(levelFor(119).level, 1);
  assert.deepEqual(levelFor(120), { level: 2, into: 0, need: 180, title: 'Sunday Driver' });
  assert.equal(levelFor(120 + 180).level, 3);
});

test('past the last title, levels keep counting with the top title', () => {
  const high = levelFor(100000);
  assert.ok(high.level > LEVEL_TITLES.length);
  assert.equal(high.title, LEVEL_TITLES.at(-1));
});

test('difficulty starts easy, firms up with level and levels off', async () => {
  const { difficultyAt } = await import('./difficulty.ts');
  const easy = difficultyAt(1), mid = difficultyAt(6), full = difficultyAt(12), beyond = difficultyAt(40);
  assert.equal(easy.trafficCars, 3);
  assert.equal(full.trafficCars, 11);
  assert.equal(easy.swervers, 0);
  assert.ok(full.swervers >= 3);
  assert.ok(full.weaveMax > easy.weaveMax && full.weaveWindow < easy.weaveWindow);
  assert.deepEqual(beyond, full);
  assert.ok(easy.nearMissGap > mid.nearMissGap && mid.nearMissGap > full.nearMissGap);
  assert.ok(easy.penalty < full.penalty && easy.bonus > full.bonus);
  assert.ok(difficultyAt(2).r < 0.03, 'the first level-ups barely change anything');
});
