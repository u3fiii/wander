import saved from './boostTuning.json';
import { CAR_CONFIG, JUICE_CONFIG } from './config';

// Boost (Shift), tuned live from the Boost tab of the look panel and saved back to boostTuning.json by Apply (dev
// only): its colour (the screen grade, the soft screen tint and the exhaust flame), how it drives, the camera move
// and the blur. The grade, flame and blur read `boostTuning` every frame; the rest is laid over the configs here.

// Holding a boost: the camera eases up and back (on a smooth in-out curve) and stays there for the whole burst,
// with a fine hum and a quick nodding tilt, as if the car is shaking with rage and power (the depth of field and
// warm grade are handled elsewhere).
export const BOOST_FEEL = { pullBack: 5.2, rise: 3.2, attack: 2.2, release: 1.6, vibration: 0.035, tilt: 0.0016, tiltRate: 115, tiltFine: 0.0007, tiltFineRate: 180 };

export type BoostTuning = typeof saved;
export const BOOST_TUNING_SAVED: BoostTuning = { ...saved };
export const boostTuning: BoostTuning = { ...saved };

export function applyBoostTuning(values: BoostTuning) {
  Object.assign(boostTuning, values);
  CAR_CONFIG.boostDuration = values.duration;
  CAR_CONFIG.boostCooldown = values.cooldown;
  CAR_CONFIG.boostSpeedFactor = values.speedFactor;
  CAR_CONFIG.boostAccelFactor = values.accelFactor;
  BOOST_FEEL.pullBack = values.pullBack;
  BOOST_FEEL.rise = values.rise;
  BOOST_FEEL.vibration = values.shake;
  JUICE_CONFIG.boostFovKick = values.fovKick;
  JUICE_CONFIG.flameLength = values.flameLength;
}
applyBoostTuning(saved);

export const BOOST_TUNING_COLOURS: Array<{ key: keyof BoostTuning; label: string }> = [
  { key: 'gradeColour', label: 'Screen' },
  { key: 'tintColour', label: 'Edge tint' },
  { key: 'flameColour', label: 'Flame' },
];

export const BOOST_TUNING_SLIDERS: Array<{ key: keyof BoostTuning; label: string; min: number; max: number; step: number; group?: string }> = [
  { key: 'gradeStrength', label: 'Colour strength', min: 0, max: 1, step: 0.01, group: 'Colour' },
  { key: 'gradeSaturation', label: 'Saturation', min: 0.5, max: 2, step: 0.01 },
  { key: 'tintOpacity', label: 'Edge tint strength', min: 0, max: 1, step: 0.01 },
  { key: 'flameLength', label: 'Flame length', min: 0, max: 3, step: 0.05 },
  { key: 'duration', label: 'Boost length (s)', min: 1, max: 12, step: 0.1, group: 'Drive' },
  { key: 'cooldown', label: 'Cooldown (s)', min: 0, max: 15, step: 0.1 },
  { key: 'speedFactor', label: 'Top speed ×', min: 1, max: 2, step: 0.01 },
  { key: 'accelFactor', label: 'Acceleration ×', min: 1, max: 4, step: 0.05 },
  { key: 'pullBack', label: 'Camera pull back', min: 0, max: 12, step: 0.1, group: 'Camera' },
  { key: 'rise', label: 'Camera rise', min: 0, max: 8, step: 0.1 },
  { key: 'shake', label: 'Hum (shake)', min: 0, max: 0.12, step: 0.005 },
  { key: 'fovKick', label: 'Lens kick', min: 0, max: 20, step: 0.5 },
  { key: 'blur', label: 'Background blur', min: 0, max: 3, step: 0.05 },
];
