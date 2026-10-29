import * as THREE from 'three';
import saved from './carLook.json';

// The red classic's look, designed from the Car look tab of the look panel (Apply saves it back to carLook.json, dev
// only): a colour for each of its parts, its paint's finish, its own studio lights (a key, a fill and a rim, lighting
// only the car) and a few overall controls. Presets fill everything in at once as a starting point.
// The lights' directions are taken from the camera, like a photo studio, so they read the same from every angle:
// angle 0 = from the camera, 90 = from the right, -90 = from the left, 180 = from behind; height 0 = level, 90 = above.
// Softness wraps the light round the car (0 = a hard edge between lit and dark, 1 = all soft).
export type CarLook = typeof saved;
export const CAR_LOOK_SAVED: CarLook = { ...saved };
export const carLook: CarLook = { ...saved };

// The car's parts (the classic's colour roles, see PlayerVehicle) and the colour each takes.
const PART_COLOUR = {
  body: 'bodyColour', light: 'bodyColour', lamp: 'lampColour', tire: 'windowColour', chrome: 'chromeColour', trim: 'chromeColour',
  wheel: 'wheelColour', hub: 'hubColour',
} as const;
export type CarPart = keyof typeof PART_COLOUR;
type ColourKey = typeof PART_COLOUR[CarPart] | 'keyColour' | 'fillColour' | 'rimColour';

export const CAR_LOOK_COLOURS: Array<{ key: ColourKey; label: string }> = [
  { key: 'bodyColour', label: 'Body' }, { key: 'lampColour', label: 'Lamps' },
  { key: 'windowColour', label: 'Windows & spare tyre' }, { key: 'chromeColour', label: 'Bumpers & rack' },
  { key: 'wheelColour', label: 'Tyres' }, { key: 'hubColour', label: 'Wheel hubs' },
  { key: 'keyColour', label: 'Key light' }, { key: 'fillColour', label: 'Fill light' }, { key: 'rimColour', label: 'Rim light' },
];
type Slider = { key: Exclude<keyof CarLook, ColourKey>; label: string; min: number; max: number; step: number; group?: string };
const light = (name: 'key' | 'fill' | 'rim', title: string): Slider[] => [
  { key: `${name}Strength`, label: 'Strength', min: 0, max: 3, step: 0.01, group: title },
  { key: `${name}Softness`, label: 'Softness', min: 0, max: 1, step: 0.01 },
  { key: `${name}Angle`, label: 'Angle round (degrees)', min: -180, max: 180, step: 1 },
  { key: `${name}Height`, label: 'Height (degrees)', min: -30, max: 90, step: 1 },
];
export const CAR_LOOK_SLIDERS: Slider[] = [
  { key: 'gloss', label: 'Matte ← → glossy', min: -1, max: 1, step: 0.01, group: 'Paint finish' },
  { key: 'metallic', label: 'Metallic', min: 0, max: 1, step: 0.01 },
  ...light('key', 'Key light'), ...light('fill', 'Fill light'), ...light('rim', 'Rim light'),
  // How much the world's own lights (sun, sky, lamps) still light the car: lower it to let the studio lights lead.
  { key: 'sceneLight', label: 'World light on the car', min: 0, max: 1.5, step: 0.01, group: 'Overall' },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01 },
  { key: 'brightness', label: 'Brightness', min: 0.3, max: 1.8, step: 0.01 },
];

// Starting points: each sets everything, then the sliders take it from there.
const soft = { keyStrength: 0.6, keySoftness: 0.6, keyAngle: -40, keyHeight: 45, fillStrength: 0.35, fillSoftness: 1, fillAngle: 70, fillHeight: 10 };
export const CAR_LOOK_PRESETS: Array<{ name: string; look: Partial<CarLook> }> = [
  { name: 'Original', look: saved },
  { name: 'Toy', look: { ...saved, ...soft, bodyColour: '#ef6f5c', chromeColour: '#fff1d6', windowColour: '#2b3440', wheelColour: '#55606a', lampColour: '#ffd36b', hubColour: '#b9b4a6', gloss: 0.25, rimStrength: 0.5, rimSoftness: 0.5, rimColour: '#fff4dc', sceneLight: 0.85, saturation: 0.9, brightness: 1.05 } },
  { name: 'Showroom', look: { ...saved, bodyColour: '#c8202a', chromeColour: '#f2f2f0', windowColour: '#2b3440', wheelColour: '#24272b', lampColour: '#fff1c2', hubColour: '#7d8084', gloss: -0.55, metallic: 0.35, keyStrength: 0.9, keySoftness: 0.2, rimStrength: 1.2, rimSoftness: 0.2, rimColour: '#ffffff', saturation: 1.1 } },
  { name: 'Retro', look: { ...saved, ...soft, bodyColour: '#e6d3a8', chromeColour: '#8a5a3b', windowColour: '#2b3440', wheelColour: '#3a3a3a', lampColour: '#ffcf6b', hubColour: '#a59c86', gloss: 0.1, saturation: 0.95 } },
  { name: 'Midnight', look: { ...saved, bodyColour: '#273a63', chromeColour: '#e8b64c', windowColour: '#2b3440', wheelColour: '#1d2024', lampColour: '#ffe08a', hubColour: '#5c6470', gloss: -0.35, metallic: 0.3, keyStrength: 0.5, rimStrength: 1, rimSoftness: 0.3, rimColour: '#8fd3ff' } },
  { name: 'Mint', look: { ...saved, ...soft, bodyColour: '#7fcbb0', chromeColour: '#fff3dc', windowColour: '#2b3440', wheelColour: '#4c5459', lampColour: '#ffd36b', hubColour: '#c9c2b0', gloss: 0.15, rimStrength: 0.4, rimColour: '#ffffff', brightness: 1.05 } },
];

// The car's coloured parts in use (each tagged with its part), repainted from the values every frame.
const parts = new Set<THREE.MeshStandardMaterial>();
export const forgetCarLook = (material: THREE.Material) => parts.delete(material as THREE.MeshStandardMaterial);

const uniforms = {
  uKeyDir: { value: new THREE.Vector3() }, uKeyColour: { value: new THREE.Color() }, uKeySoft: { value: 0 },
  uFillDir: { value: new THREE.Vector3() }, uFillColour: { value: new THREE.Color() }, uFillSoft: { value: 0 },
  uRimDir: { value: new THREE.Vector3() }, uRimColour: { value: new THREE.Color() }, uRimSoft: { value: 0 },
  uSceneLight: { value: 1 }, uGloss: { value: 0 }, uMetallic: { value: 0 }, uSaturation: { value: 1 }, uBrightness: { value: 1 },
};
const direction = (target: THREE.Vector3, angle: number, height: number) => {
  const a = THREE.MathUtils.degToRad(angle), h = THREE.MathUtils.degToRad(height);
  return target.set(Math.sin(a) * Math.cos(h), Math.sin(h), Math.cos(a) * Math.cos(h)).normalize();
};
// Copies the current values into the shader and the parts' colours (cheap; called every frame by the car).
export function syncCarLook() {
  const v = carLook;
  direction(uniforms.uKeyDir.value, v.keyAngle, v.keyHeight);
  direction(uniforms.uFillDir.value, v.fillAngle, v.fillHeight);
  direction(uniforms.uRimDir.value, v.rimAngle, v.rimHeight);
  uniforms.uKeyColour.value.set(v.keyColour).multiplyScalar(v.keyStrength);
  uniforms.uFillColour.value.set(v.fillColour).multiplyScalar(v.fillStrength);
  uniforms.uRimColour.value.set(v.rimColour).multiplyScalar(v.rimStrength);
  uniforms.uKeySoft.value = v.keySoftness;
  uniforms.uFillSoft.value = v.fillSoftness;
  uniforms.uRimSoft.value = v.rimSoftness;
  uniforms.uSceneLight.value = v.sceneLight;
  uniforms.uGloss.value = v.gloss;
  uniforms.uMetallic.value = v.metallic;
  uniforms.uSaturation.value = v.saturation;
  uniforms.uBrightness.value = v.brightness;
  for (const material of parts) material.color.set(v[PART_COLOUR[material.userData.carPart as CarPart]]);
}

// Lays the studio lights, the paint finish and the overall controls into one of the car's standard materials; a
// material tagged with a part (`userData.carPart`) also takes that part's colour.
export function applyCarLook(material: THREE.MeshStandardMaterial) {
  if (material.userData.carPart in PART_COLOUR) parts.add(material);
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uKeyDir, uKeyColour, uFillDir, uFillColour, uRimDir, uRimColour;
uniform float uKeySoft, uFillSoft, uRimSoft, uSceneLight, uGloss, uMetallic, uSaturation, uBrightness;
// Light that wraps round the surface as it softens: hard at 0, all the way round at 1.
float studioLight(vec3 n, vec3 l, float soft) { return clamp((dot(n, l) + soft) / (1.0 + soft), 0.0, 1.0); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))), diffuseColor.rgb, uSaturation) * uBrightness;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor - uGloss, 0.04, 1.0);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = clamp(metalnessFactor + uMetallic, 0.0, 1.0);`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
reflectedLight.directDiffuse *= uSceneLight; reflectedLight.indirectDiffuse *= uSceneLight;
reflectedLight.directSpecular *= uSceneLight; reflectedLight.indirectSpecular *= uSceneLight;
vec3 studio = studioLight(normal, uKeyDir, uKeySoft) * uKeyColour + studioLight(normal, uFillDir, uFillSoft) * uFillColour;
// The rim: light round the edges, on the side it comes from; softer spreads it further in from the edge.
float edge = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), mix(5.0, 1.2, uRimSoft));
studio += edge * clamp(dot(normal, uRimDir) * 0.5 + 0.5, 0.0, 1.0) * uRimColour;
reflectedLight.directDiffuse += studio * diffuseColor.rgb;`);
  };
  material.customProgramCacheKey = () => 'car-look';
  material.needsUpdate = true;
}
