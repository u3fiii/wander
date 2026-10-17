import saved from './warmLight.json';

// A big warm light hanging just off the globe in one corner of the view, washing a soft gradient across it. Tuned
// live from the Warm light tab of the look panel and saved back to warmLight.json by Apply (dev only).
export type WarmLight = typeof saved;
export const WARM_LIGHT_SAVED: WarmLight = { ...saved };
export const warmLight: WarmLight = { ...saved };

export const WARM_LIGHT_COLOURS = [{ key: 'colour', label: 'Colour' }];
export const WARM_LIGHT_SLIDERS: Array<{ key: Exclude<keyof WarmLight, 'colour'>; label: string; min: number; max: number; step: number; group?: string }> = [
  { key: 'strength', label: 'Strength (day)', min: 0, max: 4, step: 0.01, group: 'Light' },
  { key: 'nightStrength', label: 'Strength (night)', min: 0, max: 4, step: 0.01 },
  // Where on screen it sits: the angle round the view (0 = right, 90 = top, 180 = left, 270 = bottom).
  { key: 'angle', label: 'Corner (degrees)', min: 0, max: 360, step: 1, group: 'Place' },
  // How far round toward the camera it hangs: 0 = level with the globe's edge, 1 = straight in front of it.
  { key: 'front', label: 'Toward the camera', min: -0.5, max: 1, step: 0.01 },
  // Distance from the globe's centre, in globe radii (1 = on the surface).
  { key: 'distance', label: 'Distance', min: 1.05, max: 3, step: 0.01 },
  // How far the light carries, in globe radii: small = a tight hot spot, big = a broad wash.
  { key: 'reach', label: 'Softness', min: 0.5, max: 5, step: 0.01, group: 'Falloff' },
  // While driving, the colour wanders slowly to its neighbours on the colour wheel and back: how far (degrees of hue,
  // either way) and how long one full swing takes (seconds).
  { key: 'hueDrift', label: 'Colour wander (degrees)', min: 0, max: 60, step: 1, group: 'While driving' },
  { key: 'driftPeriod', label: 'Wander time (s)', min: 8, max: 120, step: 1 },
];
