import saved from './nightLook.json';

// The night look, tuned live from the Night tab of the look panel and saved back to nightLook.json by Apply (dev only).
// The scene, the output pass and the town's lights read this object every frame; daytime is unaffected.
// Older open tuning panels may save without the newly added colour field.
const settings = { ...{ carLightColour: '#ffd6a0' }, ...saved };
export type NightLook = typeof settings;
export const NIGHT_LOOK_SAVED: NightLook = { ...settings };
export const nightLook: NightLook = { ...settings };

export const NIGHT_LOOK_COLOURS = [{ key: 'carLightColour', label: 'Car light colour' }];

export const NIGHT_LOOK_SLIDERS: Array<{ key: Exclude<keyof NightLook, 'skyTop' | 'skyHorizon' | 'carLightColour'>; label: string; min: number; max: number; step: number; group?: string }> = [
  { key: 'moonCool', label: 'Moonlight coolness', min: 0, max: 1, step: 0.01 },
  { key: 'moonStrength', label: 'Moonlight strength', min: 0.3, max: 2, step: 0.01 },
  { key: 'skyLight', label: 'Sky light', min: 0.3, max: 2, step: 0.01 },
  { key: 'haze', label: 'Haze', min: 0, max: 1, step: 0.01 },
  { key: 'cityLights', label: 'City lights', min: 0, max: 2.5, step: 0.01 },
  { key: 'saturation', label: 'Saturation', min: 0.5, max: 1.5, step: 0.01 },
  { key: 'exposure', label: 'Brightness', min: 0.5, max: 1.2, step: 0.01 },
  { key: 'glow', label: 'Globe halo', min: 0, max: 3, step: 0.01 },
  { key: 'aurora', label: 'Aurora', min: 0, max: 0.8, step: 0.01 },
  { key: 'carLightIntensity', label: 'Intensity', min: 0, max: 8, step: 0.05, group: 'Car light' },
  { key: 'carLightHeight', label: 'Height', min: 1.5, max: 10, step: 0.1 },
  { key: 'carLightSpread', label: 'Beam width', min: 20, max: 70, step: 1 },
  { key: 'carLightSoftness', label: 'Soft edge', min: 0, max: 1, step: 0.01 },
];
