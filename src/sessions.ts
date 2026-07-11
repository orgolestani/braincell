import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface SessionInfo {
  sessionId: string;
  /** Human title derived from the first real user prompt; null → use project. */
  title: string | null;
  project: string;
  cwd: string;
  gitBranch: string | null;
  model: string | null;
  contextTokens: number;
  contextLimit: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  lastActivity: string;
  mtimeMs: number;
  active: boolean;
  freshErrors: number; // tool errors since the last genuine user prompt
}

/** Shape of a Claude Code transcript JSONL entry (only the fields we read). */
interface TranscriptEntry {
  type?: string;
  subtype?: string;
  compactMetadata?: { postTokens?: number };
  isSidechain?: boolean;
  customTitle?: string; // user-set session title (Claude Code)
  aiTitle?: string; // auto-generated session title (Claude Code)
  lastPrompt?: string; // most recent user prompt (Claude Code)
  content?: string; // system entries (e.g. /context command output) carry a raw string
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  timestamp?: string;
  entrypoint?: string;
  message?: {
    model?: string;
    content?: string | { type?: string }[];
    usage?: {
      input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      output_tokens?: number;
    };
  };
}

function configDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}
function projectsDir(): string {
  return path.join(configDir(), 'projects');
}

const TAIL_BYTES = 512 * 1024;
const MAX_SESSIONS = 10;
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_CONTEXT_LIMIT = 200_000;
const EXTENDED_CONTEXT_LIMIT = 1_000_000;
// ESC[…m color codes; built from char 27 so no control literal sits in source.
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;:]*m`, 'g');

/**
 * Model→window map — the authoritative denominator when the transcript has no
 * `/context` reading to borrow from. Default is 200k; entries below get 1M.
 *
 * The 1M *beta* variants carry a `[1m]` id suffix (e.g. `claude-sonnet-5[1m]`),
 * which the first pattern catches. Models whose *native* window is 1M have no
 * suffix and are listed explicitly. Verified against /context:
 *   - fable-5     121.2k/1m (2026-07-05)
 *   - opus-4-8     75.6k/1m (2026-07-11)
 */
const MODEL_WINDOWS: { pattern: RegExp; limit: number }[] = [
  { pattern: /\[1m\]|-1m(?![a-z0-9])|\b1m\b/, limit: EXTENDED_CONTEXT_LIMIT },
  { pattern: /fable-5/, limit: EXTENDED_CONTEXT_LIMIT },
  { pattern: /opus-4-8/, limit: EXTENDED_CONTEXT_LIMIT },
];

/**
 * The real context window straight from Claude Code. Running `/context` writes
 * its output (…`**Tokens:** 75.6k / 1m (8%)`…) into the transcript as a system
 * entry, and that denominator is authoritative — the one thing that resolves
 * the 200k-vs-1M ambiguity a bare model id can't. The window is stable for a
 * session, so the most recent `/context` wins; we only trust it when the block
 * names the same model we're on (guards a mid-session `/model` switch to a
 * different-window model). Returns null when `/context` was never run.
 */
function windowFromContext(lines: string[], model: string | null): number | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('Context Usage')) continue;
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const text = (entry.content ?? '').replace(ANSI_ESCAPE, ''); // strip terminal color codes
    const win = /Tokens:?\**\s*[\d.]+[km]?\s*\/\s*([\d.]+)\s*([km])?/i.exec(text);
    if (!win) continue;
    const printed = /Model:?\**\s*([\w.-]+)/i.exec(text)?.[1]?.toLowerCase();
    if (printed && model && printed !== model.toLowerCase()) continue; // stale after /model switch
    const n = parseFloat(win[1]);
    const unit = (win[2] ?? '').toLowerCase();
    const value = unit === 'm' ? n * 1_000_000 : unit === 'k' ? n * 1000 : n;
    if (value > 0) return Math.round(value);
  }
  return null;
}

/**
 * Context window for a session. Prefer the exact window Claude Code printed via
 * `/context` (`explicitWindow`); otherwise fall back to the model→window map.
 * The token count only ever *corrects upward* as a last resort — a session
 * provably past its assumed limit must be on a bigger window (never read
 * >100%). It no longer inflates the denominator for sessions merely approaching
 * 200k.
 */
function contextLimitFor(
  model: string | null | undefined,
  contextTokens: number,
  explicitWindow?: number | null,
): number {
  const m = (model ?? '').toLowerCase();
  const limit =
    explicitWindow && explicitWindow > 0
      ? explicitWindow
      : (MODEL_WINDOWS.find((w) => w.pattern.test(m))?.limit ?? DEFAULT_CONTEXT_LIMIT);
  return contextTokens > limit ? EXTENDED_CONTEXT_LIMIT : limit;
}

/**
 * A genuine user prompt (not a tool_result carrier, not a sidechain): content
 * is a plain string, or an array with a text block and no tool_result blocks.
 */
function isUserPrompt(entry: TranscriptEntry): boolean {
  if (entry.type !== 'user' || entry.isSidechain) return false;
  const content = entry.message?.content;
  if (typeof content === 'string') return true;
  if (!Array.isArray(content)) return false;
  return content.some((b) => b.type === 'text') && !content.some((b) => b.type === 'tool_result');
}

/**
 * Tool errors since the last genuine user prompt — resets when the user sends
 * a new message, so recovered mishaps stop haunting the counter. Substring
 * pre-checks keep JSON.parse off the hot path.
 */
function countFreshErrors(lines: string[]): number {
  let errors = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.includes('"is_error":true')) errors += 1;
    if (line.includes('"type":"user"')) {
      try {
        if (isUserPrompt(JSON.parse(line))) return errors;
      } catch {
        /* truncated first line etc. */
      }
    }
  }
  return errors;
}

/** Read the last chunk of a file as UTF-8 text. */
function readTail(filePath: string): string {
  const fd = fs.openSync(filePath, 'r');
  try {
    const { size } = fs.fstatSync(fd);
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    return buffer.toString('utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Session title, preferring what Claude Code itself records. It appends
 * `custom-title` (user-set), `ai-title` (auto-generated) and `last-prompt`
 * entries on every turn, so the freshest ones live in the tail we already
 * hold. Priority: user's own title → AI title → latest prompt (truncated).
 * `lines` is scanned newest-first so the most recent value wins.
 */
function titleFromLines(lines: string[]): string | null {
  let aiTitle: string | null = null;
  let lastPrompt: string | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('title"') && !line.includes('last-prompt')) continue;
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === 'custom-title' && entry.customTitle) return clip(entry.customTitle);
    if (entry.type === 'ai-title' && entry.aiTitle && !aiTitle) aiTitle = entry.aiTitle;
    if (entry.type === 'last-prompt' && entry.lastPrompt && !lastPrompt)
      lastPrompt = entry.lastPrompt;
  }
  return aiTitle ? clip(aiTitle) : lastPrompt ? clip(lastPrompt) : null;
}

/** Collapse whitespace and truncate a title to a slot-friendly length. */
function clip(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 42 ? `${t.slice(0, 41)}…` : t;
}

function parseSession(filePath: string, mtimeMs: number): SessionInfo | null {
  let tail: string;
  try {
    tail = readTail(filePath);
  } catch {
    return null;
  }

  const lines = tail.split('\n').filter((l) => l.trim().length > 0);
  const freshErrors = countFreshErrors(lines);
  const title = titleFromLines(lines);
  // Fallback metadata from the newest parseable entry, so a just-started
  // session (no billed assistant turn yet) still surfaces at 0 tokens.
  let meta: TranscriptEntry | null = null;
  // A compact boundary newer than the last billed assistant turn means the
  // pre-compact usage is dead — the boundary's postTokens is the real context
  // until the next reply lands. Without this the meter sits at the old %.
  let compactTokens: number | null = null;
  // The first line may be truncated by the tail read; drop it if it doesn't parse.
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    // Any transcript with a cwd is a real Claude Code session — watch it
    // regardless of entrypoint (cli / claude-desktop / IDE). entrypoint only
    // affects controllability (WIRED needs a CLI PTY), never visibility.
    if (!meta && entry.sessionId) meta = entry;
    if (compactTokens === null && entry.type === 'system' && entry.subtype === 'compact_boundary') {
      compactTokens = entry.compactMetadata?.postTokens ?? 0;
    }
    if (entry.type !== 'assistant' || entry.isSidechain || !entry.message?.usage) {
      continue;
    }
    const usage = entry.message.usage;
    const compacted = compactTokens !== null;
    const inputTokens = compacted ? (compactTokens as number) : (usage.input_tokens ?? 0);
    const cacheReadTokens = compacted ? 0 : (usage.cache_read_input_tokens ?? 0);
    const cacheCreationTokens = compacted ? 0 : (usage.cache_creation_input_tokens ?? 0);
    const contextTokens = inputTokens + cacheReadTokens + cacheCreationTokens;
    return {
      sessionId: entry.sessionId ?? path.basename(filePath, '.jsonl'),
      title,
      project: entry.cwd ? path.basename(entry.cwd) : path.basename(path.dirname(filePath)),
      cwd: entry.cwd ?? '',
      gitBranch: entry.gitBranch ?? null,
      model: entry.message.model ?? null,
      contextTokens,
      contextLimit: contextLimitFor(
        entry.message.model,
        contextTokens,
        windowFromContext(lines, entry.message.model ?? null),
      ),
      inputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      outputTokens: compacted ? 0 : (usage.output_tokens ?? 0),
      lastActivity: entry.timestamp ?? new Date(mtimeMs).toISOString(),
      mtimeMs,
      active: Date.now() - mtimeMs < ACTIVE_WINDOW_MS,
      freshErrors,
    };
  }

  // No billed assistant turn yet — emit a zero-token entry from metadata.
  if (meta) {
    return {
      sessionId: meta.sessionId ?? path.basename(filePath, '.jsonl'),
      title,
      project: meta.cwd ? path.basename(meta.cwd) : path.basename(path.dirname(filePath)),
      cwd: meta.cwd ?? '',
      gitBranch: meta.gitBranch ?? null,
      model: meta.message?.model ?? null,
      contextTokens: compactTokens ?? 0,
      contextLimit: contextLimitFor(
        meta.message?.model,
        compactTokens ?? 0,
        windowFromContext(lines, meta.message?.model ?? null),
      ),
      inputTokens: compactTokens ?? 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      lastActivity: meta.timestamp ?? new Date(mtimeMs).toISOString(),
      mtimeMs,
      active: Date.now() - mtimeMs < ACTIVE_WINDOW_MS,
      freshErrors,
    };
  }
  return null;
}

export function getSessions(): SessionInfo[] {
  let projectDirs: string[];
  try {
    projectDirs = fs.readdirSync(projectsDir());
  } catch {
    return [];
  }

  const files: { filePath: string; mtimeMs: number }[] = [];
  for (const dir of projectDirs) {
    const dirPath = path.join(projectsDir(), dir);
    let entries: string[];
    try {
      entries = fs.readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const filePath = path.join(dirPath, entry);
      try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) files.push({ filePath, mtimeMs: stat.mtimeMs });
      } catch {
        continue;
      }
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);

  // Always include sessions Braincell is wired to, even if they've gone idle
  // and fallen out of the most-recent window.
  const chosen = files.slice(0, MAX_SESSIONS);
  const chosenPaths = new Set(chosen.map((f) => f.filePath));
  for (const wf of wiredFiles()) {
    if (!chosenPaths.has(wf.filePath)) {
      chosen.push(wf);
      chosenPaths.add(wf.filePath);
    }
  }

  const sessions: SessionInfo[] = [];
  for (const { filePath, mtimeMs } of chosen) {
    const session = parseSession(filePath, mtimeMs);
    if (session) sessions.push(session);
  }
  sessions.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());
  return sessions;
}

/** Transcript files for currently-wired sessions (from the wrapper registry). */
function wiredFiles(): { filePath: string; mtimeMs: number }[] {
  const dir = path.join(os.homedir(), '.braincell', 'wired');
  let regs: string[];
  try {
    regs = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out: { filePath: string; mtimeMs: number }[] = [];
  for (const r of regs) {
    try {
      const { sessionId, cwd } = JSON.parse(fs.readFileSync(path.join(dir, r), 'utf-8'));
      if (!sessionId || !cwd) continue;
      const filePath = path.join(projectsDir(), String(cwd).replace(/[/.]/g, '-'), `${sessionId}.jsonl`);
      const stat = fs.statSync(filePath);
      if (stat.isFile()) out.push({ filePath, mtimeMs: stat.mtimeMs });
    } catch {
      /* skip */
    }
  }
  return out;
}
