import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { batchStatic, mergeModel, mergeSameLook, sectorOf } from './staticBatch.ts';

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
  assert.deepEqual(stats, { meshes: 2, trimmed: 0, batches: 1, detached: 2 });
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

test('branches left with nothing to draw leave the scene graph, and come back with undo', () => {
  const root = new THREE.Group();
  const plain = new THREE.MeshStandardMaterial({ color: 0x888888 });
  const glowing = new THREE.MeshStandardMaterial({ color: 0x888888, emissive: 0xffaa00 });
  // A tree (a group around a mesh) merges away entirely; a house keeps its glowing lamp, so it stays.
  const tree = new THREE.Group(); tree.add(box(plain, 0));
  const house = new THREE.Group(); const lamp = box(glowing, 4); house.add(box(plain, 2), lamp);
  // Something hidden by the game for now (shown later) is kept, and so is an empty group (its model still loading).
  const later = new THREE.Group(); later.visible = false; later.add(box(plain, 6));
  const loading = new THREE.Group();
  root.add(tree, house, later, loading);
  const { stats, undo } = batchStatic(root, new THREE.Vector3(0, -100, -60));
  assert.equal(stats.detached, 2, 'the tree, and the house\'s merged wall');
  assert.equal(tree.parent, null);
  assert.equal(house.parent, root);
  assert.deepEqual(house.children, [lamp]);
  assert.equal(later.parent, root);
  assert.equal(loading.parent, root);
  undo();
  assert.deepEqual(root.children, [tree, house, later, loading]);
  assert.equal(house.children.length, 2);
  assert.equal(tree.parent, root);
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
  assert.deepEqual(stats, { meshes: 0, trimmed: 1, batches: 1, detached: 0 });
  assert.equal(house.visible, true);
  assert.deepEqual(house.geometry.groups.map(group => group.materialIndex), [4]);
  assert.equal(house.geometry.getAttribute('position'), geometry.getAttribute('position'), 'buffers are shared, not copied');
  const merged = root.getObjectByName('static-batches')!.children[0] as THREE.Mesh;
  assert.equal(merged.geometry.getAttribute('position').count, 30, 'five faces of two triangles');
  undo();
  assert.equal(house.geometry, geometry);
});

test('a moving model merges into itself, leaving a part marked dynamic alone', () => {
  const model = new THREE.Group();
  model.position.set(5, 0, 0);
  model.scale.setScalar(2);
  const paint = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.9 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x00ff00, roughness: 0.88 });
  const propeller = box(new THREE.MeshStandardMaterial(), 0);
  propeller.userData.dynamic = true;
  model.add(box(paint, 0), box(trim, 2), propeller);
  mergeModel(model);
  const batches = model.getObjectByName('static-batches')!;
  assert.equal(batches.children.length, 1, 'roughness 0.88 and 0.9 draw together');
  assert.equal(propeller.parent, model);
  // Merged in the model's own space: the model's transform still applies once.
  const merged = batches.children[0] as THREE.Mesh;
  merged.geometry.computeBoundingBox();
  assert.ok(Math.abs(merged.geometry.boundingBox!.max.x - 2.5) < 1e-6);
});

test('parts with the same look merge and keep their live material; nothing merges when no look is shared', () => {
  const body = new THREE.Group();
  const chrome = new THREE.MeshStandardMaterial({ color: 0xcccccc });
  chrome.userData.carPart = 'chrome';
  const chromeToo = chrome.clone();
  const paint = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  paint.userData.carPart = 'body';
  body.add(box(chrome, 0), box(chromeToo, 2), box(paint, 4));
  const made = mergeSameLook(body);
  assert.equal(made.length, 2);
  const meshes = body.children as THREE.Mesh[];
  assert.equal(meshes.length, 2);
  const shiny = meshes.find(mesh => (mesh.material as THREE.Material).userData.carPart === 'chrome')!;
  assert.equal(shiny.geometry.getAttribute('position').count, 72);
  assert.ok(shiny.material === chrome || shiny.material === chromeToo, 'the material itself is kept, so its colour can still change');
  assert.ok(shiny.castShadow);

  const lone = new THREE.Group();
  lone.add(box(paint, 0), box(chrome, 2));
  assert.equal(mergeSameLook(lone).length, 0);
  assert.equal(lone.children.length, 2);
});
