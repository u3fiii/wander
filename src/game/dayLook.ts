import saved from './dayLook.json';

// The daytime look, tuned live from the Day look panel and saved back to dayLook.json by its Apply button (dev only).
// The scene and the output pass read this object every frame; night is unaffected.
export type DayLook = typeof saved;
export const DAY_LOOK_SAVED: DayLook = { ...saved };
export const dayLook: DayLook = { ...saved };

// What each slider does, its range and step, in the order the panel shows them.
export const DAY_LOOK_SLIDERS: Array<{ key: Exclude<keyof DayLook, 'skyTop' | 'skyHorizon'>; label: string; min: number; max: number; step: number }> = [
  { key: 'sunWarmth', label: 'Sun warmth', min: 0, max: 1, step: 0.01 },
  { key: 'sunStrength', label: 'Sun strength', min: 0.4, max: 1.6, step: 0.01 },
  { key: 'skyLight', label: 'Sky light', min: 0.4, max: 1.8, step: 0.01 },
  { key: 'haze', label: 'Haze', min: 0, max: 1, step: 0.01 },
  { key: 'warmFilter', label: 'Warm filter', min: 0, max: 1.5, step: 0.01 },
  { key: 'saturation', label: 'Saturation', min: 0.5, max: 1.5, step: 0.01 },
  { key: 'exposure', label: 'Brightness', min: 0.7, max: 1.4, step: 0.01 },
  { key: 'glow', label: 'Globe halo', min: 0, max: 2, step: 0.01 },
];
