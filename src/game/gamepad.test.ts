import test from 'node:test';
import assert from 'node:assert/strict';
import { PAD, createEdges, createRepeater, nearestInDirection, readPadState } from './gamepad.ts';

const pad = (pressed: number[] = [], axes: number[] = [0, 0], analog: Record<number, number> = {}) => ({
  buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index), value: analog[index] ?? (pressed.includes(index) ? 1 : 0) })),
  axes,
});

test('every driving action has a button', () => {
  const state = readPadState(pad([PAD.A, PAD.X, PAD.LB, PAD.Y, PAD.RS, PAD.VIEW, PAD.MENU], [0.5, 0], { [PAD.RT]: 0.8, [PAD.LT]: 0.3 }));
  assert.equal(state.throttle, 0.8);
  assert.equal(state.brake, 0.3);
  assert.equal(state.steer, 0.5);
  assert.deepEqual([state.handbrake, state.boost, state.gentle, state.recover, state.camera, state.map, state.menu], [true, true, true, true, true, true, true]);
  assert.equal(readPadState(pad([PAD.RB])).boost, true, 'RB boosts too');
  assert.equal(readPadState(pad()).boost, false);
});

test('the d-pad and the left stick both move through menus', () => {
  assert.equal(readPadState(pad([PAD.DOWN])).down, true);
  assert.equal(readPadState(pad([], [0, 0.9])).down, true);
  assert.equal(readPadState(pad([], [-0.9, 0])).left, true);
  assert.equal(readPadState(pad([], [0.3, 0.3])).right, false, 'a light touch is not a move');
});

test('a press registers once, on the frame it goes down', () => {
  const edges = createEdges(['a'] as const);
  assert.equal(edges({ a: false }).a, false);
  assert.equal(edges({ a: true }).a, true);
  assert.equal(edges({ a: true }).a, false, 'held');
  assert.equal(edges({ a: false }).a, false);
  assert.equal(edges({ a: true }).a, true);
});

test('holding a direction repeats after a pause, and letting go starts afresh', () => {
  const repeat = createRepeater(400, 100);
  assert.equal(repeat(true, 0), true);
  assert.equal(repeat(true, 100), false);
  assert.equal(repeat(true, 400), true);
  assert.equal(repeat(true, 450), false);
  assert.equal(repeat(true, 500), true);
  assert.equal(repeat(false, 510), false);
  assert.equal(repeat(true, 520), true);
});

test('menu moves go to the button that lies that way, straighter ahead first', () => {
  const rects = [
    { left: 100, top: 100, width: 100, height: 40 }, // 0 centre
    { left: 100, top: 200, width: 100, height: 40 }, // 1 below
    { left: 300, top: 110, width: 100, height: 40 }, // 2 right
    { left: 380, top: 190, width: 100, height: 40 }, // 3 below, far right
  ];
  assert.equal(nearestInDirection(rects, 0, 'down'), 1);
  assert.equal(nearestInDirection(rects, 0, 'right'), 2);
  assert.equal(nearestInDirection(rects, 0, 'up'), -1);
  assert.equal(nearestInDirection(rects, 0, 'left'), -1);
  assert.equal(nearestInDirection(rects, 2, 'down'), 3);
  assert.equal(nearestInDirection(rects, 3, 'left'), 2, 'the nearer one, though a little higher');
});
