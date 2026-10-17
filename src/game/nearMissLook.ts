import saved from './nearMissLook.json';

// The near-miss grade (the slow-motion "close call" look), tuned live from the Near miss tab of the look panel and
// saved back to nearMissLook.json by Apply (dev only). By day it is the faded, bleached look; at night, where
// draining the colour left a muddy grey, it brightens the frame into a cool moonlit tint with lifted shadows and
// glowing lights. The output pass reads this object every frame and blends the two with the time of day.
export type NearMissLook = typeof saved;
export const NEAR_MISS_LOOK_SAVED: NearMissLook = { ...saved };
export const nearMissLook: NearMissLook = { ...saved };

export const NEAR_MISS_LOOK_COLOURS: Array<{ key: keyof NearMissLook; label: string }> = [
  { key: 'nightTint', label: 'Night tint' },
];

export const NEAR_MISS_LOOK_SLIDERS: Array<{ key: keyof NearMissLook; label: string; min: number; max: number; step: number; group?: string }> = [
  { key: 'nightTintMix', label: 'Tint strength', min: 0, max: 1, step: 0.01, group: 'Night' },
  { key: 'nightExposure', label: 'Brightness', min: 0.6, max: 2.5, step: 0.01 },
  { key: 'nightContrast', label: 'Contrast', min: 0.5, max: 1.8, step: 0.01 },
  { key: 'nightLift', label: 'Shadow lift', min: 0, max: 0.4, step: 0.01 },
  { key: 'nightGlow', label: 'Light glow', min: 0, max: 1.5, step: 0.01 },
  { key: 'dayStrength', label: 'Day look strength', min: 0, max: 1, step: 0.01, group: 'Day' },
];
