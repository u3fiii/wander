import test from 'node:test';
import assert from 'node:assert/strict';
import { FULL_TURN, GLOBE_RADIUS, loopLatitude } from './globe.ts';
import { ROAD_LAYOUT, bendProfile, layoutIsDrivable, roadLayoutFor } from './roadLayouts.ts';

const sample = () => Array.from({ length: 360 }, (_, index) => loopLatitude((index / 360) * FULL_TURN));

test('the first road is the original; later ones each bend it their own way', () => {
  roadLayoutFor(0);
  const original = sample();
  const sharpest = Math.max(...bendProfile());
  const shapes: number[][] = [];
  for (let chapter = 1; chapter <= 10; chapter++) {
    const waves = roadLayoutFor(chapter);
    assert.ok(waves.length > 0, `chapter ${chapter} found a layout`);
    assert.ok(layoutIsDrivable(sharpest * ROAD_LAYOUT.maxBendRatio + 1e-9), `chapter ${chapter} is drivable`);
    const shape = sample();
    const shift = Math.max(...shape.map((latitude, index) => Math.abs(latitude - original[index]))) * GLOBE_RADIUS;
    assert.ok(shift > 1.5, `chapter ${chapter} visibly moves the road (${shift.toFixed(1)} m)`);
    shapes.push(shape);
  }
  assert.notDeepEqual(shapes[0], shapes[1]);
  roadLayoutFor(0);
  assert.deepEqual(sample(), original, 'back to the original road');
});

test('the road never moves at the bridge, where it has to meet the deck and the channel', () => {
  roadLayoutFor(0);
  const before = loopLatitude(1.56);
  for (let chapter = 1; chapter <= 6; chapter++) {
    roadLayoutFor(chapter);
    assert.ok(Math.abs(loopLatitude(1.56) - before) * GLOBE_RADIUS < 0.05);
  }
  roadLayoutFor(0);
});

test('a layout number always gets the same road', () => {
  const first = roadLayoutFor(3);
  roadLayoutFor(5);
  assert.deepEqual(roadLayoutFor(3), first);
  roadLayoutFor(0);
});
