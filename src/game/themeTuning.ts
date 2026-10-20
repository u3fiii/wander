import saved from './themeTuning.json';
import { applyThemeTuning } from './themes';
import type { ThemeTuning } from './themes';

// The saved theme tuning (themeTuning.json, written by the Theme tab's Apply in dev) laid over the themes when the
// game loads. What can be tuned, and how, lives in themes.ts.
export const THEME_TUNING_SAVED = saved as unknown as ThemeTuning;
applyThemeTuning(THEME_TUNING_SAVED);
