import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applySuspension, buildCarRig, createSuspension } from './carRig.ts';

function rigWithBody() {
  const chassis = new THREE.Group();
  chassis.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 2)));
  return buildCarRig(chassis);
}
const worldOf = (object: THREE.Object3D) => { object.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(object.matrixWorld); };

test('the body hangs on its springs beside the wheels, pivoting at their height', () => {
  const rig = rigWithBody();
  for (const wheel of Object.values(rig.spin)) {
    let inside = false;
    wheel.traverseAncestors(ancestor => { if (ancestor === rig.sprung) inside = true; });
    assert.equal(inside, false, 'no wheel rides on the body');
  }
  assert.ok(Math.abs(rig.pivot - rig.rest.FL) < 1e-6, 'pivot at the wheels\' centre height');
});

test('leaning, dipping and lifting move the body, while the wheels stay where they are', () => {
  const rig = rigWithBody();
  const before = Object.fromEntries(Object.entries(rig.spin).map(([key, wheel]) => [key, worldOf(wheel)]));
  const body = worldOf(rig.sprung);
  const pose = { ...createSuspension(), pitch: 0.08, roll: 0.12, lift: 0.05 };
  applySuspension(rig, pose);
  for (const [key, wheel] of Object.entries(rig.spin)) assert.ok(worldOf(wheel).distanceTo(before[key]) < 1e-6, `${key} wheel stays put`);
  assert.ok(worldOf(rig.sprung).y > body.y, 'the body rises');
  assert.notEqual(rig.sprung.rotation.x, 0);
  assert.ok(pose.pivot > 0, 'the pivot height is reported for the lamps');
});

test('each wheel can move on its own (bumps, hanging in the air)', () => {
  const rig = rigWithBody();
  const front = worldOf(rig.spin.FL).y, rear = worldOf(rig.spin.RL).y;
  applySuspension(rig, { ...createSuspension(), wheels: { FL: 0.04, FR: 0, RL: -0.03, RR: 0 } });
  assert.ok(worldOf(rig.spin.FL).y > front, 'front left up over a bump');
  assert.ok(worldOf(rig.spin.RL).y < rear, 'rear left down');
  assert.ok(Math.abs(worldOf(rig.spin.FR).y - front) < 1e-6, 'the others untouched');
});
