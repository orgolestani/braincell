/**
 * Mascot — WebM loops in the porthole, one per state (CLAUDE.md asset
 * strategy: video for the mascot, not vector). All loops are created once and
 * stacked; switching toggles visibility + play/pause, so a state change never
 * flashes a reload. Videos are deduped by URL, so fallback states sharing a
 * clip cost nothing extra.
 *
 * States and clips:
 *   ok       → smart-brain.webm
 *   warn     → effort-brain.webm  (sweating under pressure)
 *   danger   → stupid-brain.webm
 *   thinking → smart-brain.webm   (TODO: thinking-brain.webm when it lands)
 *
 * "thinking" = Claude is generating right now (transcript written within the
 * last LIVE_MS — Claude Code appends entries as it streams). It overrides
 * ok/warn but NOT danger: imminent auto-compact is the app's core alert and
 * outranks charm.
 *
 * Lifecycle: singleton. renderer.ts rebuilds the watch DOM on changed polls,
 * so mount() just re-appends the persistent wrapper into the fresh
 * `[data-mascot-slot]`.
 */
import type { Heat } from '../../braincell';
import type { Activity } from '../../activity';
import smartBrainUrl from '../../assets/smart-brain.webm';
import stupidBrainUrl from '../../assets/stupid-brain.webm';
import effortBrainUrl from '../../assets/effort-brain.webm';

type MascotState = Heat | 'thinking';

const SOURCES: Record<MascotState, string> = {
  ok: smartBrainUrl,
  warn: effortBrainUrl,
  danger: stupidBrainUrl,
  thinking: smartBrainUrl, // placeholder — swap for thinking-brain.webm
};

export interface Mascot {
  mount(slot: HTMLElement): void;
  setState(heat: Heat, activity: Activity): void;
}

let instance: Mascot | null = null;

export function mascot(): Mascot {
  if (instance) return instance;

  const wrap = document.createElement('div');
  wrap.className = 'ms-wrap';

  const byUrl = new Map<string, HTMLVideoElement>();
  for (const url of new Set(Object.values(SOURCES))) {
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.className = 'ms-video';
    byUrl.set(url, video);
    wrap.appendChild(video);
  }

  let current: HTMLVideoElement | null = null;

  function show(url: string): void {
    const next = byUrl.get(url);
    if (!next || next === current) return;
    if (current) {
      current.classList.remove('on');
      current.pause();
    }
    next.classList.add('on');
    void next.play().catch(() => {
      /* muted autoplay is allowed; ignore transient rejections */
    });
    current = next;
  }

  show(SOURCES.ok);

  instance = {
    /** (Re-)attach the persistent mascot into a freshly rendered slot. */
    mount(slot: HTMLElement): void {
      if (wrap.parentElement !== slot) slot.replaceChildren(wrap);
    },
    setState(heat: Heat, activity: Activity): void {
      const state: MascotState = heat !== 'danger' && activity === 'live' ? 'thinking' : heat;
      show(SOURCES[state]);
    },
  };
  return instance;
}
