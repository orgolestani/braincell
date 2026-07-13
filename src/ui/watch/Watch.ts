/**
 * Watch — the whole pocket-watch device: bow + crown at 12, case pushers,
 * and a 3D flip container holding the Face (front) and Caseback (back).
 *
 * Hardware controls (renderer.ts delegation contracts):
 *   - crown        `.bm-compact` — press = /compact
 *   - flip pusher  `.bm-flip`    — turn the watch over (sessions/settings)
 *   - close pusher `.bm-close`   — hover-revealed, closes the window
 * The case itself is the drag region; every control opts out.
 */
import type { SessionInfo } from '../../sessions';
import type { BraincellsAssessment } from '../../braincells';
import { activityOf } from '../../activity';
import { renderFace, renderFaceEmpty } from './Face';
import { renderCaseback, type CasebackShimStatus } from './Caseback';

export type SessionMode = 'watching' | 'reconnecting' | 'wired';

/** Hunter-case lid: covers the face until auto-wire onboarding resolves. */
export type LidState = 'closed' | 'opening' | null;

export interface WatchOptions {
  sessions: SessionInfo[];
  selectedId: string | null;
  flipped: boolean;
  clearArmed: boolean;
  mode: SessionMode;
  wiredIds: Set<string>;
  shim: CasebackShimStatus | null;
  lid: LidState;
}

/**
 * The closed hunter-case lid — the auto-wire onboarding surface. Two explicit
 * choices: wire-and-open (installs the shell shim so new `claude` launches are
 * born WIRED) or just open (read-only watching). Rendered inside .bw-case so
 * the hinge swing inherits the case's perspective. A render that lands during
 * 'opening' paints the lid already at opacity 0 — invisible, harmless.
 */
function renderLid(lid: LidState): string {
  if (!lid) return '';
  return `
    <div class="bw-lid ${lid === 'opening' ? 'opening' : ''}">
      <div class="bw-back-title">Braincells</div>
      <div class="bw-back-engraving">a pocket watch for claude code</div>
      <button class="bm-lidwire bw-lid-primary" type="button"
              title="Adds one line to your shell rc so every new \`claude\` you launch starts WIRED — live Compact/Clear, no fork. Then opens the case.">
        <span class="bw-lid-bolt">⚡</span> Auto-wire &amp; open
      </button>
      <button class="bm-lidopen bw-lid-secondary" type="button"
              title="Open without installing anything — Braincells watches sessions read-only. Auto-wire is available later on the caseback.">just open</button>
      <div class="bw-lid-fine">auto-wire edits your shell rc</div>
    </div>`;
}

function renderShell(
  front: string,
  back: string,
  flipped: boolean,
  lid: LidState,
  attrs = '',
): string {
  // Styled paper-tag tooltips (data-tip, css ::after) replace native titles on
  // the nameless hardware. Lid-aware: a closed case says so instead of
  // advertising controls that won't fire.
  const closed = lid === 'closed';
  // No crown tip while closed — the crown is inert and shouldn't advertise.
  const crownTip = closed ? '' : 'data-tip="Press: compact context (/compact)" data-tip-pos="top"';
  const flipTip = closed ? 'Open the case first' : flipped ? 'Back to the meter' : 'Sessions &amp; settings';
  return `
    <div class="bw" ${attrs}>
      <div class="bw-steam" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
      <div class="bw-bow"></div>
      <button class="bm-compact bw-crown" type="button" ${crownTip} aria-label="Compact context">
        <span class="bw-crown-stem"></span>
        <span class="bw-crown-collar"></span>
        <span class="bw-crown-cap"></span>
      </button>
      <span class="bw-pusher-wrap bw-pw-close" data-tip="Close Braincells" data-tip-align="left">
        <button class="bm-close bw-pusher" type="button" aria-label="Close Braincells"><span>✕</span></button>
      </span>
      <span class="bw-pusher-wrap bw-pw-flip" data-tip="${flipTip}" data-tip-align="right">
        <button class="bm-flip bw-pusher" type="button" aria-label="Sessions and settings"><span>⚙</span></button>
      </span>
      ${
        closed
          ? '' // fob is unreachable until the case opens — don't show the pusher
          : `<span class="bw-pusher-wrap bw-pw-mini" data-tip="Minimize to fob" data-tip-align="right">
        <button class="bm-minify bw-pusher" type="button" aria-label="Minimize to fob"><span>–</span></button>
      </span>`
      }
      <div class="bw-case">
        <div class="bw-flipper ${flipped ? 'flipped' : ''}">
          <div class="bw-side bw-front">${front}</div>
          <div class="bw-side bw-back">${back}</div>
        </div>
        ${renderLid(lid)}
      </div>
    </div>`;
}

export function renderWatch(
  session: SessionInfo,
  assessment: BraincellsAssessment,
  opts: WatchOptions,
): string {
  const pct = Math.min(100, (session.contextTokens / session.contextLimit) * 100);
  const front = renderFace({
    assessment,
    contextPct: pct,
    activity: activityOf(session.mtimeMs),
    errors: session.freshErrors,
    model: session.model,
  });
  const back = renderCaseback({
    hero: session,
    sessions: opts.sessions,
    selectedId: opts.selectedId,
    wiredIds: opts.wiredIds,
    heroWired: opts.mode === 'wired',
    clearArmed: opts.clearArmed,
    shim: opts.shim,
  });
  return renderShell(front, back, opts.flipped, opts.lid,
    `data-heat="${assessment.heat}" data-mode="${opts.mode}"`);
}

export function renderWatchEmpty(lid: LidState = null): string {
  const back = `
    <div class="bw-caseback">
      <div class="bw-back-title">Braincells</div>
      <div class="bw-back-engraving">no sessions detected</div>
      <div class="bw-back-hint">run <code>claude</code> in a terminal</div>
    </div>`;
  return renderShell(renderFaceEmpty(), back, false, lid, 'data-heat="ok" data-mode="watching"');
}
