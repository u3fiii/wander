import saved from './cameraTuning.json';
import { CAR_CONFIG, JUICE_CONFIG } from './config';

// Camera and lens, tuned live from the Camera tab of the look panel and saved back to cameraTuning.json by Apply (dev
// only). Field of view, distance, height and smoothing are laid over CAR_CONFIG; the depth-of-field values are read
// by the depth-of-field pass every frame (the two blur values multiply its built-in strengths, 1 = as designed).
export type CameraTuning = typeof saved;
export const CAMERA_TUNING_SAVED: CameraTuning = { ...saved };
export const cameraTuning: CameraTuning = { ...saved };

export function applyCameraTuning(values: CameraTuning) {
  Object.assign(cameraTuning, values);
  CAR_CONFIG.baseFov = values.baseFov;
  CAR_CONFIG.speedFovBoost = values.speedFovBoost;
  CAR_CONFIG.cameraDistance = values.cameraDistance;
  CAR_CONFIG.cameraHeight = values.cameraHeight;
  CAR_CONFIG.cameraSmoothing = values.cameraSmoothing;
  CAR_CONFIG.cameraHeightPerSpeed = values.cameraHeightPerSpeed;
  CAR_CONFIG.cameraLookAhead = values.cameraLookAhead;
  JUICE_CONFIG.cameraLag = values.cameraLag;
  JUICE_CONFIG.cameraLagMax = values.cameraLagMax;
  JUICE_CONFIG.cameraLagStiffness = values.cameraLagStiffness;
}
applyCameraTuning(saved);

export const CAMERA_TUNING_SLIDERS: Array<{ key: keyof CameraTuning; label: string; min: number; max: number; step: number; group?: string }> = [
  { group: 'Chase camera', key: 'baseFov', label: 'Field of view', min: 30, max: 80, step: 0.5 },
  { key: 'speedFovBoost', label: 'Widen with speed', min: 0, max: 25, step: 0.5 },
  { key: 'cameraDistance', label: 'Camera distance', min: 5, max: 24, step: 0.1 },
  { key: 'cameraHeight', label: 'Camera height', min: 4, max: 28, step: 0.1 },
  { key: 'cameraSmoothing', label: 'Follow smoothness', min: 1, max: 12, step: 0.1 },
  { key: 'cameraLookAhead', label: 'Look ahead of the car (m)', min: 0, max: 14, step: 0.2 },
  { group: 'With speed and throttle', key: 'cameraHeightPerSpeed', label: 'Rise with speed (m per m/s)', min: 0, max: 0.3, step: 0.005 },
  { key: 'cameraLag', label: 'Fall back on acceleration', min: 0, max: 0.6, step: 0.01 },
  { key: 'cameraLagMax', label: 'Furthest it falls back (m)', min: 0, max: 8, step: 0.1 },
  { key: 'cameraLagStiffness', label: 'How fast it falls back / catches up', min: 1, max: 20, step: 0.5 },
  { group: 'Depth of field', key: 'focusRange', label: 'Focus band (driving)', min: 2, max: 30, step: 0.5 },
  { key: 'blurDriving', label: 'Blur (driving)', min: 0, max: 4, step: 0.05 },
  { key: 'blurOverview', label: 'Blur (globe view)', min: 0, max: 4, step: 0.05 },
];
