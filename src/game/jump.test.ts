import test from 'node:test';
import assert from 'node:assert/strict';
import { createJump, stepJump } from './jump.ts';
import { roadSurfaceElevation, WORLD_SETTINGS } from './worldMap.ts';
import { GLOBE_RADIUS, loopLatitude } from './globe.ts';

// Over the bridge's hump at a steady speed: the longest time in the air (s) and the highest above the road (m).
function overTheBridge(speed: number) {
  const state = createJump(), dt = 1 / 60;
  let x = WORLD_SETTINGS.roads.bridgeLongitude - 0.3, air = 0, longest = 0, highest = 0, landings = 0;
  for (let t = 0; t < 3; t += dt) {
    x += speed * dt / (GLOBE_RADIUS * Math.cos(loopLatitude(x)));
    const ground = roadSurfaceElevation(loopLatitude(x), x);
    if (stepJump(state, ground, speed, dt, true) > 0) landings++;
    air = state.flying ? air + dt : 0;
    longest = Math.max(longest, air);
    highest = Math.max(highest, state.height - ground);
  }
  return { longest, highest, landings };
}

test('slow over the bridge the car stays on the road; fast it flies, further the faster it goes', () => {
  const slow = overTheBridge(12), fast = overTheBridge(22), boost = overTheBridge(30);
  assert.equal(slow.longest, 0, 'no jump at 12 m/s');
  assert.ok(fast.longest > 0.3, `a real jump at top speed (${fast.longest.toFixed(2)} s, ${fast.highest.toFixed(2)} m)`);
  assert.ok(boost.longest > fast.longest && boost.highest > fast.highest, `further under boost (${boost.longest.toFixed(2)} s, ${boost.highest.toFixed(2)} m)`);
  assert.ok(boost.highest < 3, 'but never absurdly high');
  assert.equal(fast.landings, 1, 'and it lands once');
});

test('off the road it never leaves the ground', () => {
  const state = createJump();
  stepJump(state, 0, 30, 1 / 60, false);
  stepJump(state, 0.5, 30, 1 / 60, false);
  stepJump(state, -0.5, 30, 1 / 60, false);
  assert.equal(state.flying, false);
});
