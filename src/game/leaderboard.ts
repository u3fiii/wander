// Runs and the leaderboard. A run starts with `HEARTS` hearts; each hard crash costs one, and the last one ends the
// run. Its stats are kept for the run-over card, and the best ten runs (with the driver's name) are kept in the
// browser (the best five). The game also gets harder through a run: every `STAGE_SECONDS` it moves up a stage (difficulty.ts).
export const HEARTS = 3;
export const STAGE_SECONDS = 35;
// After losing a heart, this long (ms) before another can be lost, so one tussle can't take several.
export const HEART_GRACE_MS = 2000;
export const stageFor = (seconds: number) => 1 + Math.floor(seconds / STAGE_SECONDS);

export type RunStats = { distance: number; drifts: number; nearMisses: number; bestWeave: number; smashes: number; seconds: number };
export const emptyRunStats = (): RunStats => ({ distance: 0, drifts: 0, nearMisses: 0, bestWeave: 0, smashes: 0, seconds: 0 });

export type Entry = { name: string; score: number; distance: number; seconds: number; date: number };
const SIZE = 5;
// Whether a score would make the board.
export function qualifies(board: Entry[], score: number) {
  return score > 0 && (board.length < SIZE || score > board[board.length - 1].score);
}
// Adds an entry, best first, keeping the top five; returns the new board and where the entry landed (or -1).
export function addEntry(board: Entry[], entry: Entry) {
  const next = [...board, entry].sort((a, b) => b.score - a.score || a.date - b.date).slice(0, SIZE);
  return { board: next, rank: next.indexOf(entry) };
}
export const cleanName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, 16) || 'Driver';

const KEY = 'wander.leaderboard', NAME_KEY = 'wander.name';
export function loadBoard(): Entry[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter(e => typeof e?.score === 'number' && typeof e?.name === 'string').slice(0, SIZE) : [];
  } catch { return []; }
}
export function saveBoard(board: Entry[]) { try { localStorage.setItem(KEY, JSON.stringify(board)); } catch { /* storage unavailable */ } }
export function loadName() { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } }
export function saveName(name: string) { try { localStorage.setItem(NAME_KEY, name); } catch { /* storage unavailable */ } }

// Best score of a run, kept in the browser.
const BEST_KEY = 'wander.best';
export function loadBest() { try { return Math.max(0, Number(localStorage.getItem(BEST_KEY)) || 0); } catch { return 0; } }
export function saveBest(best: number) { try { localStorage.setItem(BEST_KEY, String(Math.round(best))); } catch { /* storage unavailable */ } }
