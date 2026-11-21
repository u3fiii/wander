import { emptyRunStats, type RunStats } from './leaderboard.ts';

const key = 'wander.interrupted-solo-run';
export function readCheckpoint(): { score: number; stats: RunStats } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (!value || !Number.isSafeInteger(value.score) || value.score <= 0 ||
      !Object.keys(emptyRunStats()).every(field => Number.isFinite(value.stats?.[field]))) return null;
    return value;
  } catch { return null; }
}
export function writeCheckpoint(score: number, stats: RunStats) {
  try {
    if (score > 0) sessionStorage.setItem(key, JSON.stringify({ score, stats }));
    else sessionStorage.removeItem(key);
  } catch { /* Storage may be disabled. */ }
}
