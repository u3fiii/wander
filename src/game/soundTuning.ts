import saved from './soundTuning.json';
import { AUDIO_CONFIG } from './audio';

// The sound, tuned live from the Sound tab of the look panel and saved back to soundTuning.json by Apply (dev only):
// the engine's character and the main volumes. Laid over AUDIO_CONFIG (audio.ts), which the audio reads every frame.
export type SoundTuning = typeof saved;
export const SOUND_TUNING_SAVED: SoundTuning = { ...saved };
export const soundTuning: SoundTuning = { ...saved };
export function applySoundTuning(values: SoundTuning) {
  Object.assign(soundTuning, values);
  Object.assign(AUDIO_CONFIG, values);
}
applySoundTuning(saved);

export const SOUND_TUNING_SLIDERS: Array<{ key: keyof SoundTuning; label: string; min: number; max: number; step: number; group?: string }> = [
  { key: 'synthVolume', label: 'Volume', min: 0, max: 0.2, step: 0.005, group: 'Engine' },
  { key: 'engineBody', label: 'Thickness', min: 0, max: 1, step: 0.01 },
  { key: 'engineRumble', label: 'Putter', min: 0, max: 1, step: 0.01 },
  { key: 'enginePitch', label: 'Pitch', min: 0.5, max: 1.5, step: 0.01 },
  { key: 'engineGrit', label: 'Grit', min: 0, max: 1, step: 0.01 },
  { key: 'master', label: 'Everything', min: 0, max: 1, step: 0.01, group: 'Volumes' },
  { key: 'slowMoWhooshVolume', label: 'Near-miss whoosh', min: 0, max: 1, step: 0.01 },
  { key: 'impactVolume', label: 'Boost hit boom', min: 0, max: 1.5, step: 0.01 },
  { key: 'ambienceVolume', label: 'Wind in the background', min: 0, max: 0.4, step: 0.005 },
];
