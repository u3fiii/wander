import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PALETTE } from './palette.ts';
import { MILESTONES, THEMES, advanceTheme, applyRetint, chapterFor, setTheme, slotForColour, themeFor, themeSlotOf, themeState, themeUniforms, themedColour, trackRetint } from './themes.ts';

test('the look changes rarely: only at big score milestones, then round the themes', () => {
  assert.equal(chapterFor(0), 0);
  assert.equal(chapterFor(MILESTONES[0] - 1), 0);
  assert.ok(MILESTONES[0] >= 2500, 'the first change is far into a run');
  assert.equal(chapterFor(MILESTONES[0]), 1);
  assert.equal(themeFor(THEMES.length).id, THEMES[0].id);
});

test('a change eases over a few seconds instead of snapping', () => {
  setTheme(0, true);
  const land = new THREE.Color(PALETTE.land);
  const frost = new THREE.Color(THEMES[3].colours.land!);
  setTheme(3);
  assert.ok(themedColour('land', new THREE.Color()).equals(land), 'nothing has moved yet');
  advanceTheme(1);
  const partway = themedColour('land', new THREE.Color());
  assert.ok(!partway.equals(land) && !partway.equals(frost), 'a second in, it is in between');
  for (let step = 0; step < 10; step++) advanceTheme(0.5);
  assert.equal(themeState.progress, 1);
  assert.ok(themedColour('land', new THREE.Color()).equals(frost), 'and it settles on the new look');
  setTheme(0, true);
});

test('retinting multiplies each tracked colour by its slot factor, and the base look leaves colours untouched', () => {
  setTheme(0, true);
  const slot = themeSlotOf('land');
  assert.ok(themeUniforms.uThemeFactor.value[slot].equals(new THREE.Vector3(1, 1, 1)));
  const material = new THREE.MeshStandardMaterial({ color: PALETTE.land });
  const other = new THREE.MeshStandardMaterial({ color: '#123456' });
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), material), new THREE.Mesh(new THREE.BoxGeometry(), other));
  const tracked = trackRetint(root, () => false);
  assert.equal(tracked.materials.length, 1, 'only colours a theme changes are tracked');
  setTheme(3, true);
  applyRetint(tracked);
  const frost = new THREE.Color(THEMES[3].colours.land!);
  assert.ok(Math.abs(material.color.r - frost.r) < 1e-6 && Math.abs(material.color.b - frost.b) < 1e-6);
  assert.ok(other.color.equals(new THREE.Color('#123456')));
  setTheme(0, true);
  applyRetint(tracked);
  assert.ok(material.color.equals(new THREE.Color(PALETTE.land)));
});

test('only an exact themed colour is matched; a near miss of two colours is left alone', () => {
  assert.equal(slotForColour(new THREE.Color(PALETTE.land)), themeSlotOf('land'));
  assert.equal(slotForColour(new THREE.Color('#000000')), -1);
});
