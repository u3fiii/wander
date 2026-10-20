import saved from './carTuning.json';
import { CAR_CONFIG } from './config';

// Car handling, tuned live from the Car tab of the look panel and saved back to carTuning.json by Apply (dev only).
// The saved values are laid over CAR_CONFIG when the game loads; the panel then edits CAR_CONFIG directly.
export type CarTuning = typeof saved;
export const CAR_TUNING_SAVED: CarTuning = { ...saved };
Object.assign(CAR_CONFIG, saved);

export const CAR_TUNING_SLIDERS: Array<{ key: keyof CarTuning; label: string; min: number; max: number; step: number }> = [
  { key: 'maxSpeed', label: 'Top speed', min: 12, max: 36, step: 0.5 },
  { key: 'acceleration', label: 'Acceleration', min: 3, max: 18, step: 0.1 },
  { key: 'brakeDecel', label: 'Brakes', min: 5, max: 30, step: 0.5 },
  { key: 'maxTurnRate', label: 'Steering', min: 1.5, max: 7, step: 0.05 },
  { key: 'steerResponse', label: 'Steering response', min: 1, max: 14, step: 0.1 },
  { key: 'lateralGrip', label: 'Grip', min: 5, max: 26, step: 0.1 },
  { key: 'roadAssist', label: 'Road assist', min: 0, max: 3, step: 0.05 },
  { key: 'rollStiffness', label: 'Suspension stiffness', min: 12, max: 110, step: 1 },
  { key: 'maxRoll', label: 'Body roll', min: 0, max: 0.35, step: 0.005 },
  { key: 'cruiseSpeed', label: 'Auto-cruise speed (m/s, 0 = off)', min: 0, max: 14, step: 0.1 },
  { key: 'cruiseDelay', label: 'Auto-cruise starts after (s)', min: 0, max: 4, step: 0.1 },
  { key: 'cruiseRamp', label: 'Auto-cruise builds up over (s)', min: 0.5, max: 8, step: 0.1 },
  { key: 'cruiseFollowGap', label: 'Gap kept behind a car (m)', min: 2, max: 12, step: 0.1 },
];
