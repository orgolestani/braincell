/**
 * Mascot — WebM loops in the porthole, one per state (CLAUDE.md asset
 * strategy: video for the mascot, not vector). All loops are created once and
 * stacked; switching cross-fades opacity (CSS transition on .ms-video) while
 * both clips play, then pauses the outgoing one — so a state change never
 * flashes a reload or a frozen frame. Videos are deduped by URL, so fallback
 * states sharing a clip cost nothing extra.
 *
 * States and clips:
 *   ok       → smart-brain.webm
 *   warn     → effort-brain.webm  (sweating under pressure)
 *   danger   → stupid-brain.webm
 *   thinking → thinking-brain.webm
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
import thinkingBrainUrl from '../../assets/thinking-brain.webm';

type MascotState = Heat | 'thinking';

const SOURCES: Record<MascotState, string> = {
  ok: smartBrainUrl,
  warn: effortBrainUrl,
  danger: stupidBrainUrl,
  thinking: thinkingBrainUrl,
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
  let fading: HTMLVideoElement | null = null;
  let fadeTimer: number | undefined;

  // Must cover the .ms-video opacity transition in index.css (0.28s) so the
  // outgoing clip keeps moving until it is fully transparent.
  const FADE_MS = 350;

  function show(url: string): void {
    const next = byUrl.get(url);
    if (!next) return;
    if (next !== current) {
      // A swap arriving mid-fade: settle the previous fade-out immediately.
      if (fadeTimer !== undefined) {
        window.clearTimeout(fadeTimer);
        fadeTimer = undefined;
      }
      if (fading && fading !== next) fading.pause();
      fading = null;

      // State swaps ride along renderer rebuilds, so the videos were often
      // just re-attached and have no prior computed style — without a layout
      // flush the class change below snaps instead of cross-fading.
      void next.offsetWidth;

      if (current) {
        current.classList.remove('on');
        fading = current;
        fadeTimer = window.setTimeout(() => {
          fadeTimer = undefined;
          if (fading && fading !== current) fading.pause();
          fading = null;
        }, FADE_MS);
      }
      next.classList.add('on');
      current = next;
    }
    // Re-play even when the state is unchanged: renderer rebuilds detach the
    // wrapper, and Chromium pauses a <video> removed from the document.
    if (next.paused) {
      void next.play().catch(() => {
        /* muted autoplay is allowed; ignore transient rejections */
      });
    }
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
