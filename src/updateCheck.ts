import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, dialog, shell } from 'electron';

/**
 * Lightweight update checker — compares app.getVersion() against the latest
 * GitHub release tag, at most once every 24h, and offers a dialog that opens
 * the install page. Check-only by design: no downloads, no auto-install, no
 * telemetry. Unreachable GitHub = silent no-op; the app never depends on it.
 *
 * Modularity contract: `promptUpdate()` is the UI and knows nothing about how
 * the newer version was discovered — a later electron-updater swap replaces
 * `fetchLatestVersion()`/`startUpdateChecker()` and keeps the prompt as-is.
 */

const RELEASES_LATEST_URL =
  'https://api.github.com/repos/orgolestani/braincell/releases/latest';
const INSTALL_PAGE_URL = 'https://braincells.net';
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
// Alongside the shim/wired state — one dotdir owns everything Braincells.
const STATE_PATH = path.join(os.homedir(), '.braincell', 'update-check.json');

/** `v1.2.3` / `1.2.3` → [1, 2, 3]; anything unparseable → null (never prompt on garbage). */
export function parseVersion(tag: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(tag.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isNewer(latestTag: string, currentVersion: string): boolean {
  const latest = parseVersion(latestTag);
  const current = parseVersion(currentVersion);
  if (!latest || !current) return false;
  for (let i = 0; i < 3; i++) {
    if (latest[i] !== current[i]) return latest[i] > current[i];
  }
  return false;
}

function lastCheckedAt(): number {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as { lastCheckedAt?: unknown };
    return typeof raw.lastCheckedAt === 'number' ? raw.lastCheckedAt : 0;
  } catch {
    return 0; // missing/corrupt state just means "check now"
  }
}

/** Persisted only on a SUCCESSFUL check — offline launches keep retrying next start. */
function markChecked(): void {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true, mode: 0o700 });
    fs.writeFileSync(STATE_PATH, JSON.stringify({ lastCheckedAt: Date.now() }), { mode: 0o600 });
  } catch {
    /* state write failing is never worth surfacing */
  }
}

/** Latest release tag from GitHub, or null on any failure (offline, rate-limit, bad JSON). */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(RELEASES_LATEST_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        // GitHub's API rejects requests without a User-Agent.
        'User-Agent': 'braincells-update-check',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: unknown };
    return typeof body.tag_name === 'string' ? body.tag_name : null;
  } catch {
    return null;
  }
}

/** The UI half: version-agnostic dialog → "Update" opens the install page. */
async function promptUpdate(latestTag: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    message: 'A new version of Braincells is available.',
    detail: `Braincells ${latestTag.replace(/^v/, '')} is out — you have ${app.getVersion()}.`,
    buttons: ['Update', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) void shell.openExternal(INSTALL_PAGE_URL);
}

async function runCheck(): Promise<void> {
  if (Date.now() - lastCheckedAt() < CHECK_EVERY_MS) return;
  const latestTag = await fetchLatestVersion();
  if (latestTag === null) return; // offline/unreachable — try again next launch
  markChecked();
  if (isNewer(latestTag, app.getVersion())) await promptUpdate(latestTag);
}

/**
 * Kick off the startup check (delayed so it never competes with first paint)
 * plus a daily re-check for long-running instances. Both go through the same
 * persisted 24h throttle, so overlapping timers/instances can't over-check.
 */
export function startUpdateChecker(): void {
  // Dev builds report the electron binary's version, not the app's — skip
  // unless explicitly testing the checker.
  if (!app.isPackaged && process.env.BRAINCELL_FORCE_UPDATE_CHECK !== '1') return;
  setTimeout(() => void runCheck(), 10_000);
  setInterval(() => void runCheck(), CHECK_EVERY_MS);
}
