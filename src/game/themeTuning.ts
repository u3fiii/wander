import saved from './themeTuning.json';
import { applyThemeTuning, currentThemeTuning } from './themes';
import type { ThemeTuning } from './themes';

// The saved theme tuning (themeTuning.json, written by the Theme tab's Apply in dev) laid over the themes when the
// game loads. What can be tuned, and how, lives in themes.ts.
export const THEME_TUNING_SAVED = saved as unknown as ThemeTuning;
applyThemeTuning(THEME_TUNING_SAVED);
// The saved version as the Stages tab's Reset and before/after comparison see it: everything, every stage complete
// (the file only holds what was ever tuned), as loaded, and again after each Apply.
export const savedThemeTuning = { current: currentThemeTuning() };
export const markThemeTuningSaved = () => { savedThemeTuning.current = currentThemeTuning(); };
