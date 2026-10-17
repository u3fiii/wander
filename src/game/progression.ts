// Driver levels. XP only ever grows: every positive note (a clip, a near miss, a boost hit) and every driving
// streak adds to it, while crashes cost score but never XP, so a level is never lost. Each level needs a little
// more than the last (120, 180, 240, … XP), so the first few come quickly and later ones take a good drive.
export const LEVEL_TITLES = ['Learner', 'Sunday Driver', 'Commuter', 'Road Tripper', 'Wanderer', 'Drifter', 'Night Rider', 'Road Legend'];
const FIRST_LEVEL_XP = 120;
const XP_STEP = 60;

export const xpForNextLevel = (level: number) => FIRST_LEVEL_XP + XP_STEP * (level - 1);
export const titleFor = (level: number) => LEVEL_TITLES[Math.min(level, LEVEL_TITLES.length) - 1];

// Level (from 1), XP into it, XP it needs, and the title.
export function levelFor(xp: number) {
  let level = 1, rest = Math.max(0, Math.floor(xp));
  while (rest >= xpForNextLevel(level)) { rest -= xpForNextLevel(level); level++; }
  return { level, into: rest, need: xpForNextLevel(level), title: titleFor(level) };
}

// XP for reaching a driving-streak level.
export const streakXp = (streakLevel: number) => 8 * streakLevel;

// Saved per browser; private windows and blocked storage just start from zero.
const KEY = 'wander.xp';
export function loadXp() {
  try { return Math.max(0, Number(localStorage.getItem(KEY)) || 0); } catch { return 0; }
}
export function saveXp(xp: number) {
  try { localStorage.setItem(KEY, String(Math.round(xp))); } catch { /* storage unavailable */ }
}
