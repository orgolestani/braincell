/**
 * 3-state session activity, derived from transcript file mtime.
 * Pure module (no node imports) so the renderer can use it at runtime —
 * computing at render time keeps the short "live" edge honest between polls.
 */
export type Activity = 'live' | 'recent' | 'stale';

export const LIVE_MS = 15_000;
export const RECENT_MS = 15 * 60_000;

export function activityOf(mtimeMs: number, now = Date.now()): Activity {
  const age = now - mtimeMs;
  if (age <= LIVE_MS) return 'live';
  if (age <= RECENT_MS) return 'recent';
  return 'stale';
}
