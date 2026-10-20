import * as THREE from 'three';
import { PALETTE } from './palette.ts';
import type { PaletteKey } from './palette.ts';

// Flip on to print every mesh and material name of a model when mapping a new asset.
export const LOG_MODEL_MATERIALS = false;

export function logMaterials(label: string, object: THREE.Object3D) {
  if (!LOG_MODEL_MATERIALS) return;
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    console.log(`[palette] ${label}: mesh "${child.name}" materials ${materials.map(material => `"${material.name}"`).join(', ')}`);
  });
}

export const jitterAmount = (random: () => number, range: number) => (random() * 2 - 1) * range;

export function paletteColor(key: PaletteKey, jitter = 0, hueJitter = 0) {
  return new THREE.Color(PALETTE[key]).offsetHSL(hueJitter, 0, jitter);
}

export function paletteMaterial(key: PaletteKey, options: { jitter?: number; hueJitter?: number; roughness?: number; vertexColors?: boolean; side?: THREE.Side } = {}) {
  const material = new THREE.MeshStandardMaterial({
    color: paletteColor(key, options.jitter ?? 0, options.hueJitter ?? 0),
    roughness: options.roughness ?? 0.9,
    metalness: 0,
    flatShading: true,
    vertexColors: options.vertexColors ?? false,
    side: options.side ?? THREE.FrontSide,
  });
  // Which palette colour it is, for the themes (themes.ts).
  material.userData.paletteKey = key;
  return material;
}

type Sampler = (u: number, v: number, out: THREE.Color) => void;
const samplers = new WeakMap<THREE.Texture, Sampler>();

export function textureSampler(texture: THREE.Texture): Sampler {
  const cached = samplers.get(texture);
  if (cached) return cached;
  const image = texture.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  const wrap = (n: number) => n - Math.floor(n);
  const sampler: Sampler = (u, v, out) => {
    const x = Math.min(width - 1, Math.floor(wrap(u) * width));
    const y = Math.min(height - 1, Math.floor((texture.flipY ? 1 - wrap(v) : wrap(v)) * height));
    const index = (y * width + x) * 4;
    out.setRGB(data[index] / 255, data[index + 1] / 255, data[index + 2] / 255, THREE.SRGBColorSpace);
  };
  samplers.set(texture, sampler);
  return sampler;
}

export type FaceSample = { hue: number; saturation: number; lightness: number; height: number; normalY: number };
export type BakedRoles = { geometry: THREE.BufferGeometry; roles: string[] };
const bakeCache = new WeakMap<THREE.BufferGeometry, BakedRoles>();

// Splits a textured geometry into one group per palette role, judged from the texture color under each face.
// A grey vertex color keeps the source's relative shading (±14%) so flat palette colors still read as detail.
export function bakeRoles(
  source: THREE.BufferGeometry,
  sample: Sampler,
  classify: (face: FaceSample) => string,
  resolve: (counts: Map<string, number>) => (key: string) => string = () => key => key,
): BakedRoles {
  const cached = bakeCache.get(source);
  if (cached) return cached;
  const geometry = source.index ? source.toNonIndexed() : source;
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const span = box.max.y - box.min.y || 1;
  const triangles = position.count / 3;
  const keys: string[] = [];
  const lightness = new Float32Array(triangles);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const color = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };
  for (let t = 0; t < triangles; t++) {
    a.fromBufferAttribute(position, t * 3);
    b.fromBufferAttribute(position, t * 3 + 1);
    c.fromBufferAttribute(position, t * 3 + 2);
    const u = uv ? (uv.getX(t * 3) + uv.getX(t * 3 + 1) + uv.getX(t * 3 + 2)) / 3 : 0;
    const v = uv ? (uv.getY(t * 3) + uv.getY(t * 3 + 1) + uv.getY(t * 3 + 2)) / 3 : 0;
    sample(u, v, color);
    color.getHSL(hsl, THREE.SRGBColorSpace);
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    keys.push(classify({
      hue: hsl.h * 360, saturation: hsl.s, lightness: hsl.l,
      height: ((a.y + b.y + c.y) / 3 - box.min.y) / span, normalY: normal.y,
    }));
    lightness[t] = hsl.l;
  }
  const counts = new Map<string, number>();
  keys.forEach(key => counts.set(key, (counts.get(key) ?? 0) + 1));
  const toRole = resolve(counts);
  const roleOf = keys.map(toRole);
  const roles = [...new Set(roleOf)];
  const average = new Map<string, number>();
  roles.forEach(role => {
    let sum = 0, n = 0;
    roleOf.forEach((r, t) => { if (r === role) { sum += lightness[t]; n++; } });
    average.set(role, sum / Math.max(n, 1) || 1);
  });
  const names = ['position', 'normal'].filter(name => geometry.getAttribute(name));
  const arrays = names.map(name => new Float32Array(position.count * 3));
  const colors = new Float32Array(position.count * 3);
  const out = new THREE.BufferGeometry();
  let cursor = 0;
  roles.forEach((role, roleIndex) => {
    const start = cursor;
    roleOf.forEach((r, t) => {
      if (r !== role) return;
      const factor = THREE.MathUtils.clamp(lightness[t] / average.get(role)!, 0.86, 1.14);
      for (let k = 0; k < 3; k++) {
        names.forEach((name, i) => {
          const attribute = geometry.getAttribute(name);
          arrays[i].set([attribute.getX(t * 3 + k), attribute.getY(t * 3 + k), attribute.getZ(t * 3 + k)], cursor * 3);
        });
        colors.set([factor, factor, factor], cursor * 3);
        cursor++;
      }
    });
    out.addGroup(start, cursor - start, roleIndex);
  });
  names.forEach((name, i) => out.setAttribute(name, new THREE.Float32BufferAttribute(arrays[i], 3)));
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  if (geometry !== source) geometry.dispose();
  const baked = { geometry: out, roles };
  bakeCache.set(source, baked);
  return baked;
}

// One material per role; `pick` returns the palette key (and optional roughness) for each role.
export function roleMaterials(roles: string[], pick: (role: string) => { key: PaletteKey; roughness?: number }, jitter = 0) {
  return roles.map(role => {
    const { key, roughness } = pick(role);
    return paletteMaterial(key, { jitter, roughness, vertexColors: true });
  });
}

// Role tables for the texture-atlas models, judged by hue/saturation/lightness of the atlas swatch.
export function houseRole(face: FaceSample) {
  const { hue, saturation, lightness, height } = face;
  if (hue >= 195 && hue <= 230 && saturation > 0.45) return 'window';
  if (hue >= 125 && hue <= 175 && saturation > 0.3) return height < 0.2 ? 'bush' : 'roof';
  if (lightness > 0.72) return 'wall';
  if (lightness < 0.33) return 'door';
  return 'trim';
}

export function planterRole(face: FaceSample) {
  if (face.hue >= 125 && face.hue <= 175 && face.saturation > 0.3) return 'bush';
  if (face.hue < 40 && face.saturation > 0.4) return 'soil';
  return 'pot';
}

export function kenneyCarKey(face: FaceSample) {
  const { hue, saturation, lightness, height } = face;
  if (lightness < 0.3 && saturation < 0.15) return height < 0.22 ? 'tire' : 'window';
  if (hue >= 195 && hue <= 230 && lightness > 0.8) return 'window';
  if (saturation < 0.22 && lightness < 0.62) return 'trim';
  if (lightness > 0.75 && saturation < 0.35) return 'paint-white';
  if (saturation > 0.5 && (hue < 15 || hue >= 345)) return 'paint-red';
  return `paint-${Math.round(hue / 30) % 12}`;
}

// The most common paint becomes the body; small red paint is lights; other paint is a cream accent.
export function resolveKenneyCar(counts: Map<string, number>) {
  let body = '';
  let best = 0;
  counts.forEach((n, key) => { if (key.startsWith('paint-') && n > best) { best = n; body = key; } });
  return (key: string) => {
    if (!key.startsWith('paint-')) return key;
    if (key === body) return 'body';
    return key === 'paint-red' ? 'light' : 'accent';
  };
}

export function playerCarRole(face: FaceSample) {
  const { hue, saturation, lightness } = face;
  if (saturation > 0.35 && hue >= 15 && hue < 65) return 'lamp';
  if (saturation > 0.35 && (hue < 15 || hue >= 330)) return 'light';
  if (saturation > 0.04 && hue >= 65 && hue < 190 && lightness > 0.15) return 'body';
  if (lightness >= 0.62) return 'chrome';
  if (lightness < 0.45) return 'tire';
  return 'trim';
}

export function treeRole(face: FaceSample) {
  const { hue, saturation, lightness, height } = face;
  if (hue >= 60 && hue <= 175 && saturation > 0.2) {
    if (height > 0.65) return 'leaves-upper';
    if (height < 0.42) return 'leaves-lower';
    return 'leaves';
  }
  if (lightness > 0.7 && saturation < 0.25) return 'birch';
  return 'trunk';
}

export function planeRole(face: FaceSample) {
  const { hue, saturation, lightness } = face;
  if (saturation > 0.4 && (hue < 15 || hue >= 345)) return 'light';
  if (saturation > 0.3 && hue >= 190 && hue <= 230) return 'accent';
  if (lightness < 0.25) return 'tire';
  if (lightness > 0.8) return 'body';
  return 'trim';
}
