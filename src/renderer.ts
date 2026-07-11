import './index.css';
import type { SessionInfo } from './sessions';
import { assessSession } from './braincell';
import { renderWatch, renderWatchEmpty, type LidState, type SessionMode } from './ui/watch/Watch';
import { renderFob, renderFobEmpty } from './ui/watch/Fob';
import { mascot } from './ui/watch/mascot';
import { activityOf } from './activity';

interface WiredEntry {
  key: string;
  sessionId: string;
  cwd: string;
  pid: number;
  socket: string;
}

interface ShimStatus {
  installed: boolean;
  wrapperCurrent: boolean;
  shimPath: string;
  rcPaths: string[];
}

declare global {
  interface Window {
    braincell: {
      getSessions: () => Promise<SessionInfo[]>;
      terminal: {
        launch: (opts: { cwd?: string }) => Promise<{ launched: boolean; key: string }>;
        reconnect: (opts: { sessionId: string | null; cwd: string }) => Promise<{
          launched: boolean;
          key: string;
        }>;
      };
      wired: {
        list: () => Promise<WiredEntry[]>;
        send: (key: string, text: string) => Promise<{ ok: boolean }>;
      };
      shim: {
        status: () => Promise<ShimStatus>;
        install: () => Promise<ShimStatus>;
        uninstall: () => Promise<ShimStatus>;
      };
      win: {
        setContentSize: (width: number, height: number) => Promise<void>;
      };
    };
  }
}

const POLL_MS = 3000;
const FOLLOW = '__follow__';
const CLEAR_ARM_MS = 4000;

let sessions: SessionInfo[] = [];
let wired: WiredEntry[] = [];
let selectedId: string | null = null;
let flipped = false; // showing the caseback (sessions/settings)
// Shim status is an fs read of rc files — fetched once before first paint
// (the lid decision), on drawer open and after each toggle, never on the poll.
let shim: ShimStatus | null = null;
let shimBusy = false;
// Hunter-case lid: closed until auto-wire is installed. One-way in a given
// app run — unknown → closed → opening → open; never re-closes (a caseback
// uninstall later must not slam the lid shut mid-session).
let lid: 'unknown' | 'closed' | 'opening' | 'open' = 'unknown';
const LID_OPEN_MS = 800; // 0.6s hinge swing + fade tail (matches .bw-lid)
// Followed hero's model between polls, so an in-session /model switch can flash
// the maker's mark + toast the new window. Keyed by session id so pinning a
// different session isn't mistaken for a model change.
let lastHeroId: string | null = null;
let lastModel: string | null = null;
let modelFlash = false; // one-shot: pulse the maker's mark after the next render
// Watch ↔ fob: the fob is the minimized capsule form. Persisted across runs;
// the closed-lid onboarding always presents as the full watch.
type View = 'watch' | 'fob';
const VIEW_KEY = 'braincell-view';
const VIEW_SIZES: Record<View, { width: number; height: number }> = {
  watch: { width: 280, height: 392 },
  fob: { width: 232, height: 56 },
};
let view: View = 'watch';

function setView(next: View): void {
  view = next;
  try {
    localStorage.setItem(VIEW_KEY, next);
  } catch {
    /* private-mode etc. — view just won't persist */
  }
  document.body.classList.toggle('fob', next === 'fob');
  flipped = false; // returning to the watch always lands on the face
  void window.braincell.win.setContentSize(VIEW_SIZES[next].width, VIEW_SIZES[next].height);
  render();
}
let clearArmed = false;
let clearTimer: number | undefined;
// A reconnect/launch in flight: its forced session id + metadata for a
// placeholder shown until the new session writes its first transcript.
let pendingKey: string | null = null;
let pendingMeta: { project: string; cwd: string } | null = null;
let pendingTimer: number | undefined;
// Command pulled on an unwired session — fires into the fork once its
// wrapper registers (control on WATCHING connects instead of copying).
let queuedCommand: string | null = null;
// Dev-only preview: fake context pressure / activity to demo every mascot
// state. Click the bow ring to cycle real → warn → danger → thinking (or
// W / D / T keys, which need keyboard focus — click any button first; Esc
// clears). Never active in packaged builds (those load from file://, not
// the vite dev server).
const IS_DEV = window.location.protocol === 'http:';
type DevState = 'warn' | 'danger' | 'thinking' | null;
let devState: DevState = null;
const DEV_CYCLE: DevState[] = [null, 'warn', 'danger', 'thinking'];
const DEV_HEAT_PCT: Record<'warn' | 'danger', number> = { warn: 0.72, danger: 0.92 };

function setDevState(next: DevState): void {
  devState = next;
  toast(devState ? `Dev: faking ${devState}` : 'Dev: real state');
  render();
}

/** Synthetic session for the RECONNECTING placeholder (no transcript yet). */
function placeholderSession(): SessionInfo {
  return {
    sessionId: pendingKey as string,
    title: null,
    project: pendingMeta?.project ?? 'session',
    cwd: pendingMeta?.cwd ?? '',
    gitBranch: null,
    model: null,
    contextTokens: 0,
    contextLimit: 200_000,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    lastActivity: new Date().toISOString(),
    mtimeMs: Date.now(),
    active: true,
    freshErrors: 0,
  };
}

/** A session worth auto-following: has real content (model or usage). */
function isReal(s: SessionInfo): boolean {
  return s.model !== null || s.contextTokens > 0;
}

function isWiredSession(s: SessionInfo): boolean {
  return wired.some((e) => e.sessionId === s.sessionId);
}

/**
 * Follow-latest target. `sessions` is already newest-first by lastActivity, but
 * empty/aborted transcripts (no model, 0 tokens) can be the freshest file on
 * disk — never make one the hero. A live wired session wins (the user
 * deliberately wired it), but a stale wired one never outranks an active
 * unwired one. Then newest active real, newest real, whatever is newest.
 */
function pickFollow(): SessionInfo | undefined {
  return (
    sessions.find((s) => isWiredSession(s) && s.active && isReal(s)) ??
    sessions.find((s) => s.active && isReal(s)) ??
    sessions.find(isReal) ??
    sessions[0]
  );
}

function heroSession(): SessionInfo | undefined {
  if (selectedId) {
    const found = sessions.find((s) => s.sessionId === selectedId);
    if (found) return found;
    if (pendingKey && selectedId === pendingKey) return placeholderSession();
    selectedId = null;
  }
  return pickFollow();
}

function wiredFor(sessionId: string): WiredEntry | undefined {
  return wired.find((e) => e.sessionId === sessionId);
}

function modeOf(session: SessionInfo): SessionMode {
  if (pendingKey && session.sessionId === pendingKey) return 'reconnecting';
  if (wiredFor(session.sessionId)) return 'wired';
  return 'watching';
}

function clearPending(): void {
  pendingKey = null;
  pendingMeta = null;
  if (pendingTimer) window.clearTimeout(pendingTimer);
  pendingTimer = undefined;
}

function toast(msg: string): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  window.setTimeout(() => el.classList.remove('show'), 2200);
}

// render() rebuilds the DOM, which would snap the flip to its end state —
// hold renders while the rotation plays, then re-render once.
let renderHoldUntil = 0;

function animateFlip(): void {
  const flipper = document.querySelector('.bw-flipper');
  if (!flipper) {
    render();
    return;
  }
  flipper.classList.toggle('flipped', flipped);
  renderHoldUntil = Date.now() + 600;
  window.setTimeout(render, 620);
}

// Last HTML written to #hero: identical output skips the DOM write, so the
// 3s poll doesn't wipe hover state (flickering tooltips) or churn the mascot
// remount when nothing actually changed.
let lastHtml = '';

function render(): void {
  if (lid === 'unknown') return; // first paint waits for the lid decision
  if (Date.now() < renderHoldUntil) return;
  const heroEl = document.getElementById('hero');
  if (!heroEl) return;
  const lidOpt: LidState = lid === 'closed' || lid === 'opening' ? lid : null;
  // The onboarding lid always presents as the full watch — no fob until open.
  const asFob = view === 'fob' && lidOpt === null;
  let hero = heroSession();
  if (!hero) {
    const html = asFob ? renderFobEmpty() : renderWatchEmpty(lidOpt);
    if (html === lastHtml) return;
    lastHtml = html;
    heroEl.innerHTML = html;
    return;
  }
  // Fake the inputs, not the styling — score/label/arc/steam/jewel/mascot
  // all follow: heat states fake the tokens, thinking fakes a live mtime.
  if (devState === 'warn' || devState === 'danger') {
    hero = { ...hero, contextTokens: Math.round(hero.contextLimit * DEV_HEAT_PCT[devState]) };
  } else if (devState === 'thinking') {
    hero = { ...hero, mtimeMs: Date.now() };
  }
  const assessment = assessSession(hero);
  const html = asFob
    ? renderFob(hero, assessment)
    : renderWatch(hero, assessment, {
        sessions,
        selectedId,
        flipped,
        clearArmed,
        mode: modeOf(hero),
        wiredIds: new Set(wired.map((e) => e.sessionId)),
        shim: shim ? { installed: shim.installed, wrapperCurrent: shim.wrapperCurrent } : null,
        lid: lidOpt,
      });
  if (html === lastHtml) return;
  lastHtml = html;
  heroEl.innerHTML = html;
  // innerHTML wiped the slot — re-attach the persistent mascot videos.
  const slot = heroEl.querySelector<HTMLElement>('[data-mascot-slot]');
  if (slot) {
    const m = mascot();
    m.mount(slot);
    m.setState(assessment.heat, activityOf(hero.mtimeMs));
  }
}

async function refreshShim(): Promise<void> {
  try {
    shim = await window.braincell.shim.status();
    render();
  } catch {
    /* leave stale status */
  }
}

/** Toggle the auto-wire shell shim (install / uninstall / reinstall). */
async function toggleShim(): Promise<void> {
  if (shimBusy) return;
  shimBusy = true;
  try {
    if (shim && shim.installed && shim.wrapperCurrent) {
      shim = await window.braincell.shim.uninstall();
      toast('Shim removed — new terminals launch claude bare');
    } else {
      shim = await window.braincell.shim.install();
      toast('Shim installed — takes effect in new terminals');
    }
  } catch {
    toast('Auto-wire toggle failed');
  } finally {
    shimBusy = false;
    render();
  }
}

/**
 * Notice an in-session model switch (same followed session, different model
 * than last poll) and arm a one-shot maker's-mark pulse — enough to catch the
 * eye without narrating what the dial already shows. Skips the first sight of
 * a session and pin-driven hero changes.
 */
function detectModelSwitch(hero: SessionInfo | undefined): void {
  const idNow = hero?.sessionId ?? null;
  const modelNow = hero?.model ?? null;
  if (idNow && idNow === lastHeroId && modelNow && lastModel && modelNow !== lastModel) {
    modelFlash = true;
  }
  lastHeroId = idNow;
  lastModel = modelNow;
}

/** Swing the hunter-case lid open, then drop it from the DOM entirely. */
function openLid(): void {
  if (lid !== 'closed') return;
  lid = 'opening';
  const el = document.querySelector('.bw-lid');
  if (!el) {
    lid = 'open';
    render();
    return;
  }
  el.classList.add('opening'); // CSS: 0.6s hinge swing, fade from 0.45s
  renderHoldUntil = Date.now() + LID_OPEN_MS; // don't let the 3s poll snap it
  window.setTimeout(() => {
    lid = 'open';
    render();
  }, LID_OPEN_MS + 20);
}

/** Primary lid button: install the auto-wire shim, then open the case. */
async function wireAndOpen(): Promise<void> {
  if (shimBusy || lid !== 'closed') return;
  shimBusy = true;
  try {
    shim = await window.braincell.shim.install();
    toast('Auto-wire on — new claude launches start wired');
    openLid();
  } catch {
    toast('Auto-wire install failed — try the caseback toggle');
    // stay closed; the lid is still the right prompt
  } finally {
    shimBusy = false;
  }
}

async function refresh(): Promise<void> {
  try {
    const [nextSessions, nextWired] = await Promise.all([
      window.braincell.getSessions(),
      window.braincell.wired.list(),
    ]);
    sessions = nextSessions;
    wired = nextWired;
    flushQueuedCommand();
    // The reconnected session wrote its first transcript → it's now a real,
    // fully-monitored WIRED session; drop the placeholder.
    if (pendingKey && sessions.some((s) => s.sessionId === pendingKey)) {
      selectedId = pendingKey;
      clearPending();
      toast('Wired — live controls available');
    }
    detectModelSwitch(heroSession());
    render();
    if (modelFlash) {
      modelFlash = false;
      // The fresh render just rebuilt the mark — pulse it now. Class is wiped
      // on the next render (3s away), long after the 0.9s animation finishes.
      document.querySelector('.bw-model')?.classList.add('bw-model-flash');
    }
  } catch (err) {
    const heroEl = document.getElementById('hero');
    if (heroEl) heroEl.innerHTML = `<div class="empty">Failed to read sessions: ${String(err)}</div>`;
    lastHtml = ''; // wrote past the cache — force the next render to repaint
  }
}

function disarmClear(): void {
  clearArmed = false;
  if (clearTimer) window.clearTimeout(clearTimer);
  clearTimer = undefined;
}

/**
 * Run a control command. Wired → send over the socket. Not wired → we can't
 * inject into a session we didn't launch, so actively connect: fork it into
 * a wired terminal and fire the command there once the wrapper is up.
 */
async function control(session: SessionInfo, command: string): Promise<void> {
  const entry = wiredFor(session.sessionId);
  if (entry) {
    const res = await window.braincell.wired.send(entry.key, command);
    toast(res.ok ? `Sent ${command}` : `Failed to send ${command}`);
    return;
  }
  if (pendingKey) {
    toast('Still connecting — hold on…');
    return;
  }
  queuedCommand = command;
  toast(`Not wired — opening a controlled fork to run ${command}`);
  await reconnectHero(session);
}

/** Fire the queued command once the fork's wrapper registers its socket. */
function flushQueuedCommand(): void {
  if (!pendingKey || !queuedCommand) return;
  const entry = wired.find((e) => e.key === pendingKey);
  if (!entry) return;
  const cmd = queuedCommand;
  queuedCommand = null;
  // Give the freshly-launched TUI a beat to mount before injecting.
  window.setTimeout(async () => {
    const res = await window.braincell.wired.send(entry.key, cmd);
    toast(res.ok ? `Sent ${cmd} to the forked session` : `Fork is up but ${cmd} didn't send — pull again`);
  }, 2500);
}

/** Fork/resume `hero` into a wired terminal (WATCHING → RECONNECTING → WIRED). */
async function reconnectHero(hero: SessionInfo): Promise<void> {
  const project = hero.project;
  const cwd = hero.cwd;
  const res = await window.braincell.terminal.reconnect({
    sessionId: hero.sessionId,
    cwd,
  });
  pendingKey = res.key;
  pendingMeta = { project, cwd };
  selectedId = res.key; // optimistic: show the reconnecting placeholder
  if (pendingTimer) window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(() => {
    if (pendingKey) {
      clearPending();
      queuedCommand = null;
      selectedId = null;
      toast('Reconnect timed out');
      render();
    }
  }, 45000);
  if (!queuedCommand) toast('Reconnecting — send a message in the terminal to begin');
  render();
}

document.getElementById('hero')?.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const hero = heroSession();

  // Dev state preview: the bow ring cycles real → warn → danger → thinking.
  if (IS_DEV && target.closest('.bw-bow')) {
    setDevState(DEV_CYCLE[(DEV_CYCLE.indexOf(devState) + 1) % DEV_CYCLE.length]);
    return;
  }

  if (target.closest('.bm-close')) {
    window.close();
    return;
  }
  if (target.closest('.bm-lidopen')) {
    openLid();
    return;
  }
  if (target.closest('.bm-lidwire')) {
    void wireAndOpen();
    return;
  }
  // Closed case: only the lid buttons, ✕ and drag work — the brass swallows
  // crown/flip/etc so hidden controls can't fire through it.
  if (lid === 'closed') return;
  if (target.closest('.bm-minify')) {
    setView('fob');
    return;
  }
  if (target.closest('.bm-expand')) {
    setView('watch');
    return;
  }
  if (target.closest('.bm-flip')) {
    flipped = !flipped;
    if (flipped) void refreshShim();
    animateFlip();
    return;
  }
  if (target.closest('.bm-shimtoggle')) {
    void toggleShim();
    return;
  }

  const compact = target.closest('.bm-compact');
  if (compact && hero) {
    compact.classList.add('pulling');
    window.setTimeout(() => compact.classList.remove('pulling'), 600);
    void control(hero, '/compact');
    return;
  }

  const clear = target.closest('.bm-clear');
  if (clear && hero) {
    if (!clearArmed) {
      clearArmed = true;
      clearTimer = window.setTimeout(() => {
        disarmClear();
        render();
      }, CLEAR_ARM_MS);
      render();
    } else {
      void control(hero, '/clear');
      disarmClear();
      render();
    }
    return;
  }

  if (clearArmed) {
    disarmClear();
    render();
  }

  // Explicit "Reconnect with controls" — the only thing that forks/wires.
  // Plain session selection just watches; it must never launch a terminal.
  if (target.closest('.bm-reconnect')) {
    const picked = hero;
    if (picked && !wiredFor(picked.sessionId) && picked.sessionId !== pendingKey) {
      flipped = false;
      animateFlip();
      void reconnectHero(picked);
    }
    return;
  }

  const slot = target.closest<HTMLElement>('[data-session-id]');
  if (slot) {
    const id = slot.dataset.sessionId ?? null;
    flipped = false;
    // Selection is watch-only: show the picked session's real context.
    selectedId = id === FOLLOW ? null : id;
    animateFlip(); // face content refreshes right after the turn completes
  }
});

if (IS_DEV) {
  const DEV_KEYS: Record<string, Exclude<DevState, null>> = {
    w: 'warn',
    d: 'danger',
    t: 'thinking',
  };
  window.addEventListener('keydown', (event) => {
    const next = DEV_KEYS[event.key.toLowerCase()];
    if (next) {
      setDevState(devState === next ? null : next);
    } else if (event.key === 'Escape' && devState) {
      setDevState(null);
    }
  });
}

async function init(): Promise<void> {
  // Decide lid-closed vs open BEFORE the first paint — otherwise the face
  // would flash and the lid slam shut over it. The window is transparent, so
  // the extra ~tens of ms of blank is invisible.
  try {
    shim = await window.braincell.shim.status();
    lid = shim.installed ? 'open' : 'closed';
  } catch {
    lid = 'open'; // fail open — never brick the watch on an fs hiccup
  }
  // Restore the persisted view; size the window to match before first paint.
  // (The lid still forces the watch PRESENTATION while closed, but the saved
  // preference survives for after onboarding.)
  try {
    if (localStorage.getItem(VIEW_KEY) === 'fob' && lid === 'open') {
      view = 'fob';
      document.body.classList.add('fob');
      await window.braincell.win.setContentSize(VIEW_SIZES.fob.width, VIEW_SIZES.fob.height);
    }
  } catch {
    /* keep the watch view */
  }
  await refresh(); // first paint happens here, lid already decided
  setInterval(refresh, POLL_MS);
}
void init();
