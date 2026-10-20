// Runs and the leaderboard. A run starts with `HEARTS` hearts; each hard crash costs one, and the last one ends the
// run. Its stats are kept for the run-over card, and the best ten runs (with the driver's name) are kept in the
// browser (the best ten). The game also gets harder through a run: every `STAGE_SECONDS` it moves up a stage (difficulty.ts).
export const HEARTS = 3;
export const STAGE_SECONDS = 35;
// After losing a heart, this long (ms) before another can be lost, so one tussle can't take several.
export const HEART_GRACE_MS = 2000;
export const stageFor = (seconds: number) => 1 + Math.floor(seconds / STAGE_SECONDS);

export type RunStats = { distance: number; drifts: number; nearMisses: number; bestWeave: number; smashes: number; seconds: number };
export const emptyRunStats = (): RunStats => ({ distance: 0, drifts: 0, nearMisses: 0, bestWeave: 0, smashes: 0, seconds: 0 });

export type Entry = { name: string; score: number; distance: number; seconds: number; date: number; deviceId: string };
const SIZE = 10;
const DEVICE_KEY = 'wander.device-id';
let fallbackDeviceId: string | null = null;
export function loadDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = globalThis.crypto?.randomUUID?.() ?? `wander-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    fallbackDeviceId ??= globalThis.crypto?.randomUUID?.() ?? `wander-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return fallbackDeviceId;
  }
}
// Whether a score would make the board.
export function qualifies(board: Entry[], score: number, deviceId = loadDeviceId()) {
  if (score <= 0) return false;
  const personalBest = board.find(entry => entry.deviceId === deviceId);
  if (personalBest) return score > personalBest.score;
  return board.length < SIZE || score > board[board.length - 1].score;
}
// Keeps only a device's best run, then limits the board to the ten highest device records.
export function addEntry(board: Entry[], entry: Entry) {
  const own = board.find(existing => existing.deviceId === entry.deviceId);
  const next = [...board.filter(existing => existing.deviceId !== entry.deviceId), ...(own && own.score >= entry.score ? [own] : [entry])]
    .sort((a, b) => b.score - a.score || a.date - b.date).slice(0, SIZE);
  return { board: next, rank: next.indexOf(entry) };
}
export const sanitizeName = (name: string) => name.replace(/[^a-z ]/gi, '').replace(/\s+/g, ' ').trim().slice(0, 8).trim();
// No default name: an entry without one (an old row that was saved as "Driver", or a blank) shows no name at all.
export const cleanName = (name: string) => { const clean = sanitizeName(name); return clean === 'Driver' ? '' : clean; };

const KEY = 'wander.leaderboard', NAME_KEY = 'wander.name';
export function loadBoard(): Entry[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(saved)) return [];
    const deviceId = loadDeviceId();
    const valid = saved.filter(e => typeof e?.score === 'number' && typeof e?.name === 'string');
    // Older local boards stored every run. They all came from this browser profile, so retain only its best run.
    const best = valid.sort((a, b) => b.score - a.score || a.date - b.date)[0];
    return best ? [{ ...best, name: cleanName(best.name), deviceId }] : [];
  } catch { return []; }
}
export function saveBoard(board: Entry[]) { try { localStorage.setItem(KEY, JSON.stringify(board)); } catch { /* storage unavailable */ } }
// The last name typed on this device, or nothing.
export function loadName() { try { return cleanName(localStorage.getItem(NAME_KEY) ?? ''); } catch { return ''; } }
export function saveName(name: string) { try { localStorage.setItem(NAME_KEY, cleanName(name)); } catch { /* storage unavailable */ } }

// Best score of a run, kept in the browser.
const BEST_KEY = 'wander.best';
export function loadBest() { try { return Math.max(0, Number(localStorage.getItem(BEST_KEY)) || 0); } catch { return 0; } }
export function saveBest(best: number) { try { localStorage.setItem(BEST_KEY, String(Math.round(best))); } catch { /* storage unavailable */ } }
