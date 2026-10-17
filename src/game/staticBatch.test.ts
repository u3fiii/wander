import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { batchStatic } from './staticBatch.ts';

const box = (material: THREE.Material, x: number) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.position.set(x, 0, 0);
  mesh.castShadow = true;
  return mesh;
};

test('static meshes with different colours but the same surface merge into one, with their colours kept', () => {
  const root = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.9, flatShading: true });
  const blue = new THREE.MeshStandardMaterial({ color: 0x0000ff, roughness: 0.9, flatShading: true });
  const a = box(red, 0), b = box(blue, 2);
  root.add(a, b);
  const { stats, undo } = batchStatic(root, new THREE.Vector3(0, -100, -60));
  assert.deepEqual(stats, { meshes: 2, batches: 1 });
  assert.equal(a.visible, false);
  const merged = root.getObjectByName('static-batches')!.children[0] as THREE.Mesh;
  const colours = merged.geometry.getAttribute('color');
  assert.equal(colours.count, 72);
  assert.equal(colours.getX(0), 1);
  assert.equal(colours.getZ(71), 1);
  // Positions land where the meshes were.
  merged.geometry.computeBoundingBox();
  assert.ok(Math.abs(merged.geometry.boundingBox!.max.x - 2.5) < 1e-6);
  undo();
  assert.equal(a.visible, true);
  assert.equal(root.getObjectByName('static-batches'), undefined);
});

test('glowing, see-through and dynamic things are left alone', () => {
  const root = new THREE.Group();
  const plain = new THREE.MeshStandardMaterial({ color: 0x888888 });
  const glowing = new THREE.MeshStandardMaterial({ color: 0x888888, emissive: 0xffaa00 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x888888, transparent: true, opacity: 0.5 });
  const moving = new THREE.Group();
  moving.userData.dynamic = true;
  const boat = box(plain, 6);
  moving.add(boat);
  const g = box(glowing, 2), t = box(glass, 4);
  root.add(box(plain, 0), g, t, moving);
  const { stats } = batchStatic(root, new THREE.Vector3(0, -100, -60));
  assert.equal(stats.meshes, 1);
  assert.ok(g.visible && t.visible && boat.visible);
});
