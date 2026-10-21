import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PALETTE } from './palette.ts';
import { THEMES, advanceTheme, applyRetint, setTheme, slotForColour, themeSlotOf, themeState, themeUniforms, themedColour, trackRetint } from './themes.ts';
const FROST = THEMES.findIndex(theme => theme.id === 'frost');


test('a change eases over a few seconds instead of snapping', () => {
  setTheme(0, true);
  const land = new THREE.Color(PALETTE.land);
  const frost = new THREE.Color(THEMES[FROST].colours.land!);
  setTheme(FROST);
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
  setTheme(FROST, true);
  applyRetint(tracked);
  const frost = new THREE.Color(THEMES[FROST].colours.land!);
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

test('theme tuning: strength scales how far a theme departs from the base, and edits show up live', async () => {
  const { applyThemeTuning, currentThemeTuning, themeSettings } = await import('./themes.ts');
  const before = currentThemeTuning();
  setTheme(FROST, true);
  const frost = new THREE.Color(THEMES[FROST].colours.land!);
  const base = new THREE.Color(PALETTE.land);
  applyThemeTuning({ ...before, strength: 0 }, true);
  assert.ok(themedColour('land', new THREE.Color()).equals(base), 'at strength 0 the world keeps its base colours');
  applyThemeTuning({ ...before, strength: 0.5 }, true);
  const half = themedColour('land', new THREE.Color());
  assert.ok(Math.abs(half.r - (base.r + frost.r) / 2) < 1e-6, 'half strength is half way');
  applyThemeTuning({ ...before, themes: { ...before.themes, frost: { ...before.themes.frost, land: '#ff0000' } } }, true);
  assert.ok(themedColour('land', new THREE.Color()).equals(new THREE.Color('#ff0000')), 'an edited colour is what is drawn');
  assert.equal(themeSettings.strength, 1);
  applyThemeTuning(before, true);
  setTheme(0, true);
});

test('a group slider touches only its own colours: the trees\' hue leaves the ground alone', async () => {
  const { applyThemeTuning, currentThemeTuning } = await import('./themes.ts');
  const before = currentThemeTuning();
  setTheme(THEMES.findIndex(theme => theme.id === 'amber'), true);
  const ground = themedColour('land', new THREE.Color()), tree = themedColour('mainTree', new THREE.Color());
  applyThemeTuning({ ...before, themes: { ...before.themes, amber: { ...before.themes.amber, treesHue: 0.3 } } }, true);
  assert.ok(themedColour('land', new THREE.Color()).equals(ground), 'the ground did not move');
  assert.ok(!themedColour('mainTree', new THREE.Color()).equals(tree), 'the trees changed colour');
  applyThemeTuning(before, true);
  setTheme(0, true);
});
