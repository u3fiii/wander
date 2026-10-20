import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cullBehindGlobe, hiddenBehindGlobe } from './horizonCull.ts';

const globe = new THREE.Vector3(0, -30, 0);
const eye = new THREE.Vector3(0, 24, 0); // above the north pole of a radius-30 globe

test('things on the near side and around the horizon stay, the far side is hidden', () => {
  assert.equal(hiddenBehindGlobe(eye, new THREE.Vector3(0, 0, 0), 1, globe, 30), false, 'right below the camera');
  assert.equal(hiddenBehindGlobe(eye, new THREE.Vector3(0, -60, 0), 1, globe, 30), true, 'the opposite pole');
  assert.equal(hiddenBehindGlobe(eye, new THREE.Vector3(30, -30, 0), 1, globe, 30), true, 'on the equator, below this horizon');
  // The horizon from 24 m up is about 56 degrees from the pole: just inside it is seen.
  const near = new THREE.Vector3(Math.sin(0.9) * 30, Math.cos(0.9) * 30 - 30, 0);
  assert.equal(hiddenBehindGlobe(eye, near, 0.5, globe, 30), false);
});

test('a big object sticking up over the horizon is never hidden', () => {
  assert.equal(hiddenBehindGlobe(eye, new THREE.Vector3(30, -30, 0), 30, globe, 30), false);
});

test('culling switches render layers, and brings things back once they are in view again', () => {
  const root = new THREE.Group();
  const far = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  far.position.set(0, -60, 0);
  const near = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  root.add(far, near);
  root.updateMatrixWorld(true);
  assert.equal(cullBehindGlobe(root, eye, globe, 30), 1);
  assert.equal(far.layers.mask, 0);
  assert.equal(near.layers.mask, 1);
  assert.equal(cullBehindGlobe(root, new THREE.Vector3(0, -120, 0), globe, 30), 1);
  assert.equal(far.layers.mask, 1, 'seen from the other side');
  assert.equal(near.layers.mask, 0);
});
