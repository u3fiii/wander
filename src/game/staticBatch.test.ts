import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { batchStatic, sectorOf } from './staticBatch.ts';

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
  assert.deepEqual(stats, { meshes: 2, trimmed: 0, batches: 1 });
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

test('lightweight batching shades the merged mesh with Lambert, colours still baked in', () => {
  const root = new THREE.Group();
  root.add(box(new THREE.MeshStandardMaterial({ color: 0xff0000, flatShading: true }), 0));
  batchStatic(root, new THREE.Vector3(0, -100, -60), { lightweight: true });
  const merged = root.getObjectByName('static-batches')!.children[0] as THREE.Mesh;
  const material = merged.material as THREE.MeshLambertMaterial;
  assert.ok(material.isMeshLambertMaterial);
  assert.equal(material.flatShading, true);
  assert.equal(material.vertexColors, true);
  assert.equal(merged.geometry.getAttribute('color').getX(0), 1);
});

test('sectors are small enough to cull: nearby points share one, far ones do not', () => {
  const at = (latitude: number, longitude: number) => new THREE.Vector3(Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude), Math.cos(latitude) * Math.cos(longitude));
  assert.equal(sectorOf(at(0.05, 0.05)), sectorOf(at(0.1, 0.1)));
  assert.notEqual(sectorOf(at(0.1, 0.1)), sectorOf(at(0.1, 0.9)));
  assert.notEqual(sectorOf(at(0.1, 0.1)), sectorOf(at(0.9, 0.1)));
});

test('a mesh with one glowing material merges the rest and keeps drawing only the glowing part', () => {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1); // six groups, one per face
  const wall = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const glass = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffaa00 });
  const house = new THREE.Mesh(geometry, [wall, wall, wall, wall, glass, wall]);
  root.add(house);
  const { stats, undo } = batchStatic(root, new THREE.Vector3(0, -100, -60));
  assert.deepEqual(stats, { meshes: 0, trimmed: 1, batches: 1 });
  assert.equal(house.visible, true);
  assert.deepEqual(house.geometry.groups.map(group => group.materialIndex), [4]);
  assert.equal(house.geometry.getAttribute('position'), geometry.getAttribute('position'), 'buffers are shared, not copied');
  const merged = root.getObjectByName('static-batches')!.children[0] as THREE.Mesh;
  assert.equal(merged.geometry.getAttribute('position').count, 30, 'five faces of two triangles');
  undo();
  assert.equal(house.geometry, geometry);
});
