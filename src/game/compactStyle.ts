import * as THREE from 'three';
import { PALETTE } from './palette.ts';

// The imported compact uses pale, almost transparent materials. Give it a coherent little city-car identity
// in model space, before the wheel rig is built, so these details follow the body in both garage and game.
export function styleCompact(model: THREE.Object3D, materials: Set<THREE.Material>, geometries: Set<THREE.BufferGeometry>, textures: Set<THREE.Texture>) {
  const paint = new THREE.Color(PALETTE.compactBody);
  const roof = new THREE.Color(PALETTE.compactRoof);
  const trim = new THREE.Color(PALETTE.compactTrim);
  const shared = new Map<string, THREE.MeshStandardMaterial>();
  const make = (name: string, color: string, roughness = 0.7, metalness = 0) => {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness, side: THREE.DoubleSide });
    material.name = `Compact_${name}`;
    materials.add(material);
    shared.set(name, material);
    return material;
  };
  const body = make('Chassis', '#ffffff', 0.5, 0.12);
  body.vertexColors = true;
  make('Tire', PALETTE.tires, 1);
  make('material', PALETTE.compactRoof, 0.6, 0.15); // Rim material in the source GLTF.
  make('Handler', PALETTE.compactChrome, 0.45, 0.35);
  make('Bumpers', PALETTE.compactTrim, 0.9);
  make('Windows', PALETTE.compactWindows, 0.28, 0.12);
  make('Mirror', PALETTE.compactWindows, 0.22, 0.2);
  make('InteriorPanel', PALETTE.compactRoof);
  make('InteriorPanel_0', PALETTE.compactTrim);
  make('Turn_lights', PALETTE.compactAccent).emissive.set(PALETTE.compactAccent).multiplyScalar(0.15);
  make('Front_lights', PALETTE.carCream, 0.35).emissive.set(PALETTE.compactRoof).multiplyScalar(0.25);
  make('Brake_lights', PALETTE.carRed, 0.4).emissive.set(PALETTE.carRed).multiplyScalar(0.18);
  model.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  model.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const source = child.material as THREE.MeshStandardMaterial;
    const name = source.name;
    child.material = shared.get(name) ?? source;
    if (name !== 'Chassis') return;
    const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
    const positions = geometry.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i += 3) {
      let height = 0;
      for (let vertex = 0; vertex < 3; vertex++) height += point.fromBufferAttribute(positions, i + vertex).applyMatrix4(child.matrixWorld).y / 3;
      const color = height > 1.12 ? roof : height < 0.28 ? trim : paint;
      for (let vertex = 0; vertex < 3; vertex++) color.toArray(colors, (i + vertex) * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometries.add(geometry);
    child.geometry = geometry;
  });

  // A narrow warm belt line and two small Wander badges: readable detail without extra model downloads.
  const accents = new THREE.Group(); accents.name = 'Compact_Wander_details';
  const stripeGeometry = new THREE.BoxGeometry(0.016, 0.035, 1.56);
  geometries.add(stripeGeometry);
  const accent = shared.get('Turn_lights')!;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = PALETTE.compactRoof; ctx.beginPath(); ctx.arc(64, 64, 60, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = PALETTE.compactTrim; ctx.lineWidth = 12; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(29, 43); ctx.lineTo(44, 86); ctx.lineTo(64, 54); ctx.lineTo(84, 86); ctx.lineTo(99, 43); ctx.stroke();
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.add(texture);
    const badgeMaterial = new THREE.MeshStandardMaterial({ map: texture, transparent: true, alphaTest: 0.3, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2 });
    materials.add(badgeMaterial);
    const badgeGeometry = new THREE.PlaneGeometry(0.21, 0.21); geometries.add(badgeGeometry);
    for (const side of [-1, 1]) {
      const badge = new THREE.Mesh(badgeGeometry, badgeMaterial);
      badge.rotation.y = side * Math.PI / 2;
      badge.position.set(side * 0.53, 0.68, 0.36);
      accents.add(badge);
    }
  }
  for (const side of [-1, 1]) {
    const stripe = new THREE.Mesh(stripeGeometry, accent);
    stripe.position.set(side * 0.529, 0.5, 0.02);
    accents.add(stripe);
  }
  // Attach in normalized coordinates, not underneath the source model's import transforms.
  model.updateMatrixWorld(true);
  model.attach(accents);
}
