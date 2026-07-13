import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import type { IpcMain } from 'electron';

/**
 * Discovers and talks to wired Claude sessions (launched via the Braincells
 * wrapper). Each live wrapper drops a registry json + control socket under
 * ~/.braincell/wired/. Braincells sends whitelisted commands over the socket —
 * no terminal focus or keyboard automation.
 */
export interface WiredEntry {
  key: string;
  sessionId: string;
  cwd: string;
  pid: number;
  socket: string;
}

const WIRED_DIR = path.join(os.homedir(), '.braincell', 'wired');
const ALLOWED = new Set(['/compact', '/clear', '/model']);

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function listWired(): WiredEntry[] {
  let all: string[];
  try {
    all = fs.readdirSync(WIRED_DIR);
  } catch {
    return [];
  }
  const files = all.filter((f) => f.endsWith('.json'));
  const jsonKeys = new Set(files.map((f) => f.replace(/\.json$/, '')));
  // A socket with no registry means the wrapper died hard (kill -9, terminal
  // closed) — cleanup never ran. Sweep the orphans.
  for (const f of all) {
    if (f.endsWith('.sock') && !jsonKeys.has(f.replace(/\.sock$/, ''))) {
      try {
        fs.unlinkSync(path.join(WIRED_DIR, f));
      } catch {
        /* ignore */
      }
    }
  }
  const out: WiredEntry[] = [];
  for (const f of files) {
    const full = path.join(WIRED_DIR, f);
    try {
      const e = JSON.parse(fs.readFileSync(full, 'utf-8')) as WiredEntry;
      if (e.pid && !pidAlive(e.pid)) {
        // wrapper died without cleanup — drop the stale registry + socket
        for (const stale of [full, path.join(WIRED_DIR, `${f.replace(/\.json$/, '')}.sock`)]) {
          try {
            fs.unlinkSync(stale);
          } catch {
            /* ignore */
          }
        }
        continue;
      }
      if (e.key && e.socket && e.sessionId) out.push(e);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

function sendControl(key: string, text: string): Promise<{ ok: boolean }> {
  const first = String(text).trim().split(/\s+/)[0];
  if (!ALLOWED.has(first)) return Promise.resolve({ ok: false });
  const entry = listWired().find((e) => e.key === key);
  if (!entry) return Promise.resolve({ ok: false });

  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ ok });
    };
    const conn = net.createConnection(entry.socket, () => {
      conn.write(`${JSON.stringify({ type: 'cmd', text })}\n`);
    });
    conn.setTimeout(2000);
    conn.on('data', (d) => {
      try {
        done(Boolean(JSON.parse(d.toString().trim()).ok));
      } catch {
        done(false);
      }
      conn.end();
    });
    conn.on('timeout', () => {
      conn.destroy();
      done(false);
    });
    conn.on('error', () => done(false));
  });
}

export function registerWired(ipcMain: IpcMain): void {
  ipcMain.handle('wired:list', () => listWired());
  ipcMain.handle('wired:send', (_e, arg: { key: string; text: string }) =>
    sendControl(arg.key, arg.text),
  );
}
