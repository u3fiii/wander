import * as THREE from 'three';
import { PALETTE } from './palette.ts';

// A small beach prop needs a recognizable silhouette, not the imported model's
// 9,088 triangles. One 240-triangle mesh keeps both rings and their animation.
export function createSimpleSwimRing(diameter: number) {
  const indexed = new THREE.TorusGeometry(0.38, 0.145, 6, 20);
  const geometry = indexed.toNonIndexed();
  indexed.dispose();
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const red = new THREE.Color(PALETTE.carRed), white = new THREE.Color(PALETTE.wallWarmWhite);
  for (let i = 0; i < position.count; i += 3) {
    const x = position.getX(i) + position.getX(i + 1) + position.getX(i + 2);
    const y = position.getY(i) + position.getY(i + 1) + position.getY(i + 2);
    const angle = Math.atan2(y, x) + Math.PI;
    const color = Math.floor(angle / (Math.PI / 2)) % 2 ? red : white;
    for (let vertex = i; vertex < i + 3; vertex++) color.toArray(colors, vertex * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.rotateX(-Math.PI / 2).translate(0, 0.145, 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }));
  mesh.receiveShadow = true;
  const holder = new THREE.Group();
  holder.add(mesh);
  holder.scale.setScalar(diameter / 1.05);
  return holder;
}
