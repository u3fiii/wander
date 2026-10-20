import saved from './driftTuning.json';
import { applyDriftTuning } from './driftNumbers';
import type { DriftTuning } from './driftNumbers';

// The saved drift tuning (driftTuning.json, written by the Drift tab's Apply in dev) laid over the drift numbers
// when the game loads. The numbers, their sliders and the live-apply live in driftNumbers.ts.
export * from './driftNumbers';
export const DRIFT_TUNING_SAVED: DriftTuning = { ...saved };
applyDriftTuning(saved);
