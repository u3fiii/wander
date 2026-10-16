import saved from './nightLook.json';

// The night look, tuned live from the Night tab of the look panel and saved back to nightLook.json by Apply (dev only).
// The scene, the output pass and the town's lights read this object every frame; daytime is unaffected.
export type NightLook = typeof saved;
export const NIGHT_LOOK_SAVED: NightLook = { ...saved };
export const nightLook: NightLook = { ...saved };

export const NIGHT_LOOK_SLIDERS: Array<{ key: Exclude<keyof NightLook, 'skyTop' | 'skyHorizon'>; label: string; min: number; max: number; step: number }> = [
  { key: 'moonCool', label: 'Moonlight coolness', min: 0, max: 1, step: 0.01 },
  { key: 'moonStrength', label: 'Moonlight strength', min: 0.3, max: 2, step: 0.01 },
  { key: 'skyLight', label: 'Sky light', min: 0.3, max: 2, step: 0.01 },
  { key: 'haze', label: 'Haze', min: 0, max: 1, step: 0.01 },
  { key: 'cityLights', label: 'City lights', min: 0, max: 2.5, step: 0.01 },
  { key: 'saturation', label: 'Saturation', min: 0.5, max: 1.5, step: 0.01 },
  { key: 'exposure', label: 'Brightness', min: 0.5, max: 1.2, step: 0.01 },
  { key: 'glow', label: 'Globe halo', min: 0, max: 3, step: 0.01 },
  { key: 'aurora', label: 'Aurora', min: 0, max: 0.8, step: 0.01 },
];
