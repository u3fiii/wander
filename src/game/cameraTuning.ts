import saved from './cameraTuning.json';
import { CAR_CONFIG } from './config';

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
}
applyCameraTuning(saved);

export const CAMERA_TUNING_SLIDERS: Array<{ key: keyof CameraTuning; label: string; min: number; max: number; step: number }> = [
  { key: 'baseFov', label: 'Field of view', min: 30, max: 80, step: 0.5 },
  { key: 'speedFovBoost', label: 'Widen with speed', min: 0, max: 25, step: 0.5 },
  { key: 'cameraDistance', label: 'Camera distance', min: 5, max: 24, step: 0.1 },
  { key: 'cameraHeight', label: 'Camera height', min: 4, max: 28, step: 0.1 },
  { key: 'cameraSmoothing', label: 'Follow smoothness', min: 1, max: 12, step: 0.1 },
  { key: 'focusRange', label: 'Focus band (driving)', min: 2, max: 30, step: 0.5 },
  { key: 'blurDriving', label: 'Blur (driving)', min: 0, max: 4, step: 0.05 },
  { key: 'blurOverview', label: 'Blur (globe view)', min: 0, max: 4, step: 0.05 },
];
