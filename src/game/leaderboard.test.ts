import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_SECONDS, addEntry, cleanName, qualifies, stageFor } from './leaderboard.ts';
import type { Entry } from './leaderboard.ts';

const entry = (score: number, date = score): Entry => ({ name: `d${score}`, score, distance: 0, seconds: 0, date, deviceId: `device-${score}` });

test('the board keeps the best ten, best first, and says where a new run landed', () => {
  let board: Entry[] = [];
  for (let s = 1; s <= 10; s++) board = addEntry(board, entry(s * 100)).board;
  assert.equal(board.length, 10);
  assert.equal(board[0].score, 1000);
  assert.equal(qualifies(board, 50), false);
  assert.equal(qualifies(board, 150), true);
  const result = addEntry(board, { ...entry(850, 99999), deviceId: 'new-device' });
  assert.equal(result.rank, 2);
  assert.equal(result.board.length, 10);
  assert.equal(result.board.at(-1)!.score, 200, 'the lowest dropped off');
  assert.equal(qualifies([], 0), false, 'an empty run does not go on the board');
});

test('names are tidied, and stages come every so many seconds', () => {
  assert.equal(cleanName('   Road   Runner  '), 'Road Run');
  assert.equal(cleanName(''), '', 'no default name');
  assert.equal(cleanName('Driver'), '', 'the old default is not a name either');
  assert.equal(cleanName('x'.repeat(40)).length, 8);
  assert.equal(stageFor(0), 1);
  assert.equal(stageFor(STAGE_SECONDS - 1), 1);
  assert.equal(stageFor(STAGE_SECONDS * 3), 4);
});
