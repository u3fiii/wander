import test from 'node:test';
import assert from 'node:assert/strict';
import { loopMetric } from './globe.ts';
import { PARTY, bump, createPlayer, catchUp, leftBehind, partyControls, stepFx, lineUp, ranking, pack, roadGap, track } from './party.ts';

const field = (n: number) => Array.from({ length: n }, (_, i) => createPlayer(i, { kind: 'pad', index: i }));

test('a round lines everyone up side by side at the leader\'s spot', () => {
  const players = field(4);
  lineUp(players, 1);
  assert.deepEqual(players.map(p => p.car.z), PARTY.grid);
  assert.ok(players.every(p => p.car.x === 1 && p.car.speed === 0 && !p.out));
});

test('the race is over once the last car is far enough behind the first', () => {
  const players = field(3);
  lineUp(players, 1);
  const move = (i: number, metres: number) => { const before = players[i].car.x; players[i].car.x += metres / loopMetric(players[i].car.x); track(players[i], before); };
  move(0, 20); move(1, 15); move(2, 2);
  assert.ok(roadGap(players) > 15 && !leftBehind(players), 'apart, but still on');
  move(0, PARTY.outDistance);
  assert.ok(leftBehind(players), 'the last one has fallen to the bottom of the globe');
});

test('the ones behind get extra pace and the leader eases off', () => {
  const players = field(2);
  lineUp(players, 1);
  const before = players[0].car.x; players[0].car.x += 8 / loopMetric(1); track(players[0], before);
  players[0].car.speed = 10; players[1].car.speed = 10;
  catchUp(players, 1);
  assert.ok(players[1].car.speed > 10 && players[0].car.speed < 10);
});

test('the result is the order on the road', () => {
  const players = field(3);
  lineUp(players, 1);
  for (const [i, ahead] of [[0, 5], [1, 12], [2, 1]] as const) { const before = players[i].car.x; players[i].car.x += ahead / loopMetric(1); track(players[i], before); }
  assert.deepEqual(ranking(players).map(p => p.id), [1, 0, 2]);
});

test('cars that overlap are pushed apart and trade speed, like bumper cars', () => {
  const players = field(2);
  lineUp(players, 1);
  players[0].car.z = 0; players[1].car.z = 0.5;
  assert.equal(bump(players).length, 1);
  assert.ok(players[1].car.z - players[0].car.z >= 1.3, 'side by side: pushed fully apart');
  // One right behind the other, nose into tail: apart along the road, and the one behind hands speed on.
  players[0].car.z = 0; players[1].car.z = 0; players[1].car.x = players[0].car.x + 2 / loopMetric(1);
  players[0].car.speed = 12; players[1].car.speed = 6;
  const [hit] = bump(players);
  assert.equal(hit.knocked, players[1], 'rammed from behind at 6 m/s: a real knock');
  assert.ok((players[1].car.x - players[0].car.x) * loopMetric(1) >= 2.89, 'no sinking into each other end to end');
  assert.ok(players[0].car.speed < 12 && players[1].fx.knockX > 0, 'the rammer slows, the one in front is shoved on ahead');
  players[1].car.z = 5;
  assert.equal(bump(players).length, 0, 'far apart: nothing');
});

test('the camera\'s pack centre sits halfway between first and last, and grows with their spread', () => {
  const players = field(2);
  lineUp(players, 1);
  const tight = pack(players);
  { const before = players[1].car.x; players[1].car.x += 10 / loopMetric(1); track(players[1], before); }
  const loose = pack(players);
  assert.ok(Math.abs(tight.z - (PARTY.grid[0] + PARTY.grid[1]) / 2) < 0.01, 'between the two');
  assert.ok(loose.spread > tight.spread + 4);
  players[1].out = true;
  assert.equal(pack(players).x, players[0].car.x, 'only the cars still in count');
});

test('a car hit from the side is shoved away, spun and hops, then settles and drives again', () => {
  const players = field(2);
  lineUp(players, 1);
  players[0].car.z = 0; players[1].car.z = 0.9; players[0].car.speed = 10; players[1].car.speed = 0;
  // Side by side but overlapping, the first sliding into the second.
  players[0].car.heading = 0.6;
  const knocked = bump(players)[0]?.knocked;
  assert.equal(knocked, players[1]);
  assert.ok(knocked.fx.knockZ > 0 && knocked.fx.spin !== 0 && knocked.fx.liftV > 0, 'shoved away across the road, spun, hopping');
  const headingBefore = knocked.car.heading, zBefore = knocked.car.z;
  let time = 0;
  while (time < 3) { stepFx(knocked, 1 / 120); time += 1 / 120; }
  assert.ok(knocked.car.z > zBefore + 1 && knocked.car.heading !== headingBefore, 'ended up further over, facing another way');
  assert.equal(knocked.fx.lift, 0);
  assert.ok(Math.abs(knocked.fx.roll) < 0.01, 'back on its wheels');
  assert.equal(partyControls(knocked, { forward: true, back: false, left: false, right: false, brake: false, throttle: 1, steer: 0 }).throttle, 1, 'drives again');
});
