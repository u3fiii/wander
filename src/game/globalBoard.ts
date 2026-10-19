import { cleanName, loadDeviceId } from './leaderboard';
import type { Entry } from './leaderboard';

// The shared leaderboard, kept in Supabase (table `scores`, see supabase/leaderboard.sql) and reached through its
// REST API with the project's public key, so every player sees the same top ten. It is only used when
// VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set; without them, or when the network fails, every call
// resolves to null and the game falls back to the board kept in the browser.
const URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '');
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const sharedBoard = Boolean(URL && KEY);

const SIZE = 10;
const TIMEOUT_MS = 6000;
type Row = { id: number; device_id: string; name: string; score: number; distance: number; seconds: number; created_at: string };
const toEntry = (row: Row): Entry & { id: number } => ({ id: row.id, deviceId: row.device_id, name: cleanName(row.name), score: row.score, distance: row.distance, seconds: row.seconds, date: Date.parse(row.created_at) });

async function call(path: string, init: RequestInit = {}) {
  if (!sharedBoard) return null;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${URL}/rest/v1/${path}`, {
      ...init,
      signal: controller.signal,
      headers: { apikey: KEY!, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...init.headers },
    });
    return response.ok ? await response.json() : null;
  } catch { return null; } finally { window.clearTimeout(timer); }
}

// The top ten, best first (ties: the earlier run first).
export async function fetchTop(): Promise<Array<Entry & { id: number }> | null> {
  const rows = await call(`scores?select=id,device_id,name,score,distance,seconds,created_at&order=score.desc,created_at.asc&limit=${SIZE}`) as Row[] | null;
  return Array.isArray(rows) ? rows.map(toEntry) : null;
}

export async function fetchDeviceEntry(deviceId = loadDeviceId()): Promise<(Entry & { id: number }) | null> {
  const rows = await call(`scores?select=id,device_id,name,score,distance,seconds,created_at&device_id=eq.${encodeURIComponent(deviceId)}&limit=1`) as Row[] | null;
  return Array.isArray(rows) && rows[0] ? toEntry(rows[0]) : null;
}

// Upserts this device's personal best, then reads the board back.
export async function submitRun(entry: Omit<Entry, 'date'>) {
  const body = { device_id: entry.deviceId || loadDeviceId(), name: cleanName(entry.name), score: Math.round(entry.score), distance: Math.round(entry.distance), seconds: Math.round(entry.seconds) };
  const saved = await call(`scores?on_conflict=device_id`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(body) }) as Row[] | null;
  if (!Array.isArray(saved) || !saved[0]) return null;
  const board = await fetchTop();
  if (!board) return null;
  return { board, rank: board.findIndex(row => row.id === saved[0].id) };
}
