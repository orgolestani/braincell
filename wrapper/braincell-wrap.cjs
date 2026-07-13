#!/usr/bin/env node
/**
 * Braincells wired wrapper — runs in the USER'S terminal (plain Node, not
 * Electron). Owns Claude's PTY and exposes a Unix-domain control socket so
 * Braincells can inject whitelisted slash commands without any terminal focus
 * or keyboard automation. The user types normally: terminal → this → PTY.
 *
 * Usage:  node braincell-wrap.cjs [<extra claude args>]
 * For plain launches and forks it appends `--session-id <key>` so the session
 * id is deterministic; user resumes/continues keep their own id (confirmed
 * from the project dir when it isn't knowable up front).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
let pty;
try {
  pty = require('node-pty'); // dev: resolved from the project's node_modules
} catch {
  // Packaged app: node-pty ships beside the wrapper in Contents/Resources/
  // (forge extraResource flattens node_modules/node-pty → ../node-pty).
  pty = require(path.join(__dirname, '..', 'node-pty'));
}

const ALLOWED = new Set(['/compact', '/clear', '/model']);
const baseArgs = process.argv.slice(2);
// Braincells passes the key via env so it can track this session deterministically.
const key = process.env.BC_KEY || crypto.randomUUID();
const cwd = process.cwd();
const dir = path.join(os.homedir(), '.braincell', 'wired');
const sockPath = path.join(dir, `${key}.sock`);
const regPath = path.join(dir, `${key}.json`);

fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

function projectDir() {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(configDir, 'projects', cwd.replace(/[/.]/g, '-'));
}
/** Map of transcript name → mtimeMs, so we can spot both new and touched files. */
function snapshotJsonl() {
  const out = new Map();
  try {
    for (const f of fs.readdirSync(projectDir())) {
      if (!f.endsWith('.jsonl')) continue;
      try {
        out.set(f, fs.statSync(path.join(projectDir(), f)).mtimeMs);
      } catch {
        /* raced away */
      }
    }
  } catch {
    /* no project dir yet */
  }
  return out;
}
function writeReg(sessionId) {
  fs.writeFileSync(
    regPath,
    JSON.stringify({ key, socket: sockPath, cwd, pid: process.pid, sessionId, startedAt: Date.now() }),
    { mode: 0o600 },
  );
}

// Only force our deterministic id when it can't conflict: a plain launch, or
// a fork (Braincells reconnect passes --resume old --fork-session and a fresh
// id names the fork). A user resume/continue keeps its own session id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const explicitIdAt = baseArgs.indexOf('--session-id');
const explicitId =
  explicitIdAt >= 0
    ? baseArgs[explicitIdAt + 1]
    : (baseArgs.find((a) => a.startsWith('--session-id=')) || '').slice('--session-id='.length) || null;
const resumeAt = baseArgs.findIndex((a) => a === '-r' || a === '--resume');
const resumeArg = resumeAt >= 0 ? baseArgs[resumeAt + 1] : null;
const resumeish = resumeAt >= 0 || baseArgs.includes('-c') || baseArgs.includes('--continue');
const forks = baseArgs.includes('--fork-session');
const appendId = !explicitId && (!resumeish || forks);

const before = snapshotJsonl();

const term = pty.spawn('claude', appendId ? [...baseArgs, '--session-id', key] : baseArgs, {
  name: 'xterm-256color',
  cwd,
  cols: process.stdout.columns || 80,
  rows: process.stdout.rows || 24,
  env: process.env,
});

// Register with the best id we know up front; confirm below when uncertain.
// A non-fork resume of a literal uuid keeps that id; an explicit --session-id
// is authoritative; otherwise start with our (optimistic) key.
const knownId =
  explicitId || (appendId ? key : !forks && resumeArg && UUID_RE.test(resumeArg) ? resumeArg : null);
writeReg(knownId || key);

// Confirm the real session id when it isn't knowable up front (-c, --resume
// picker/search-term, fork without our id). Detection is scoped to THIS
// project dir only — a new transcript file, or an existing one whose mtime
// advanced (resume appends to an existing file). Not global mtime guessing.
// The id only materializes after the user's first message, so poll patiently.
// Known race: two sessions started concurrently in the same cwd can grab each
// other's transcript; accepted for v1.
let tries = 0;
const idTimer = knownId
  ? null
  : setInterval(() => {
      tries += 1;
      const now = snapshotJsonl();
      const changed = [...now.entries()].filter(
        ([f, mtime]) => !before.has(f) || mtime > before.get(f),
      );
      if (changed.length === 1) {
        writeReg(changed[0][0].replace(/\.jsonl$/, ''));
        clearInterval(idTimer);
        return;
      }
      if (tries > 150) clearInterval(idTimer); // ~5 min; keep the optimistic key
    }, 2000);

// ---- terminal passthrough ----
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('data', (d) => term.write(d));
term.onData((d) => process.stdout.write(d));
process.stdout.on('resize', () => term.resize(process.stdout.columns || 80, process.stdout.rows || 24));

// ---- control socket ----
function allowed(text) {
  const first = String(text).trim().split(/\s+/)[0];
  return ALLOWED.has(first);
}
const server = net.createServer((conn) => {
  let buf = '';
  conn.on('data', (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let ok = false;
      try {
        const msg = JSON.parse(line);
        if (msg && msg.type === 'cmd' && typeof msg.text === 'string' && allowed(msg.text)) {
          term.write(`${msg.text}\r`);
          ok = true;
        }
      } catch {
        ok = false;
      }
      conn.write(`${JSON.stringify({ ok })}\n`);
    }
  });
});
try {
  fs.unlinkSync(sockPath);
} catch {
  /* no stale socket */
}
server.listen(sockPath, () => {
  try {
    fs.chmodSync(sockPath, 0o600);
  } catch {
    /* best effort */
  }
});

// ---- cleanup ----
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (idTimer) clearInterval(idTimer);
  try {
    server.close();
  } catch {
    /* ignore */
  }
  for (const f of [sockPath, regPath]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
}
term.onExit(({ exitCode }) => {
  cleanup();
  process.exit(exitCode || 0);
});
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});
process.on('exit', cleanup);
