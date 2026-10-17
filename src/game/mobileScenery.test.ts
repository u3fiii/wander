import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSimpleSwimRing } from './mobileScenery.ts';

test('mobile swim ring keeps the prop footprint and colours at under 5% of the original triangle count', () => {
  const ring = createSimpleSwimRing(1.05);
  const mesh = ring.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const vertices = mesh.geometry.getAttribute('position');
  assert.ok(vertices.count / 3 < 9088 * 0.05);
  const bounds = new THREE.Box3().setFromObject(ring);
  assert.ok(Math.abs(bounds.max.x - bounds.min.x - 1.05) < 0.001);
  assert.ok(Math.abs(bounds.max.z - bounds.min.z - 1.05) < 0.001);
  assert.ok(bounds.min.y >= 0 && bounds.max.y < 0.3);
  const colors = mesh.geometry.getAttribute('color');
  assert.equal(colors.count, vertices.count);
  const shades = new Set<string>();
  for (let i = 0; i < colors.count; i++) shades.add([colors.getX(i), colors.getY(i), colors.getZ(i)].join(','));
  assert.equal(shades.size, 2);
  assert.equal(mesh.castShadow, false);
  mesh.geometry.dispose();
  mesh.material.dispose();
});
