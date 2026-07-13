/**
 * Caseback — the engraved brass back of the watch, shown when flipped.
 * Holds everything that isn't the meter: session switcher, CLEAR (arm →
 * confirm), the auto-wire shim toggle and the fork escape hatch.
 *
 * Action contracts shared with renderer.ts delegation (do not rename):
 * `[data-session-id]`, `.bm-clear`, `.bm-reconnect`, `.bm-shimtoggle`.
 */
import type { SessionInfo } from '../../sessions';
import { activityOf } from '../../activity';
import { escapeHtml, prettyModel, timeAgo } from '../format';

const FOLLOW = '__follow__';

export interface CasebackShimStatus {
  installed: boolean;
  wrapperCurrent: boolean;
}

export interface CasebackProps {
  hero: SessionInfo;
  sessions: SessionInfo[];
  selectedId: string | null;
  wiredIds: Set<string>;
  heroWired: boolean;
  clearArmed: boolean;
  shim: CasebackShimStatus | null; // null = status not loaded yet
}

function renderSlot(s: SessionInfo, selectedId: string | null, wiredIds: Set<string>): string {
  const pct = Math.min(100, (s.contextTokens / s.contextLimit) * 100);
  const activity = activityOf(s.mtimeMs);
  const label = s.title ?? s.project;
  return `
    <button class="bw-slot ${s.sessionId === selectedId ? 'selected' : ''}" type="button"
            data-session-id="${escapeHtml(s.sessionId)}"
            title="${escapeHtml(label)} — tap to track on the meter">
      <span class="bw-dot" data-activity="${activity}"></span>
      <span class="bw-slot-name">${escapeHtml(label)}</span>
      ${wiredIds.has(s.sessionId) ? '<span class="bw-slot-chip">wired</span>' : ''}
      <span class="bw-slot-ago">${timeAgo(s.lastActivity)}</span>
      <span class="bw-slot-bar"><span style="width:${pct.toFixed(0)}%"></span></span>
    </button>`;
}

/** Auto-wire plate: lamp + state, toggles the shell shim. */
function renderShimPlate(shim: CasebackShimStatus | null): string {
  const state = !shim ? 'unknown' : !shim.installed ? 'off' : shim.wrapperCurrent ? 'on' : 'repair';
  const stateLabel = { unknown: '…', off: 'OFF', on: 'ON', repair: 'FIX' }[state];
  const title = {
    unknown: 'Checking auto-wire status…',
    off: 'Install the shell shim — every new claude launch is born wired',
    on: 'Auto-wire installed — new claude launches are born wired',
    repair: 'Shim points at an old Braincells location — click to reinstall',
  }[state];
  return `
    <button class="bm-shimtoggle bw-shim" type="button" data-state="${state}" title="${title}">
      <span class="bw-shim-lamp"></span>
      <span class="bw-shim-label">Auto-wire</span>
      <span class="bw-shim-state">${stateLabel}</span>
    </button>`;
}

export function renderCaseback(props: CasebackProps): string {
  const following = props.selectedId === null;
  const followSlot = `
    <button class="bw-slot bw-slot-follow ${following ? 'selected' : ''}" type="button"
            data-session-id="${FOLLOW}"
            title="Automatically track whichever session is newest and active">
      <span class="bw-slot-name">▶ Follow latest</span>
      <span class="bw-slot-ago">auto</span>
    </button>`;

  // Fork is the escape hatch for sessions Braincells didn't launch — hidden
  // when the hero is already wired.
  const forkButton = props.heroWired
    ? ''
    : `<button class="bm-reconnect bw-fork" type="button"
               title="Opens a NEW terminal with a wired fork of this session — the original keeps running">⑂ wire this session</button>`;

  return `
    <div class="bw-caseback">
      <div class="bw-back-title">Braincells</div>
      <div class="bw-back-engraving">${escapeHtml(prettyModel(props.hero.model))}${props.hero.gitBranch ? ` · ${escapeHtml(props.hero.gitBranch)}` : ''}</div>
      <div class="bw-back-section">✦ sessions — tap to track ✦</div>
      <div class="bw-slots">${followSlot}${props.sessions.map((s) => renderSlot(s, props.selectedId, props.wiredIds)).join('')}</div>
      ${forkButton}
      <div class="bw-back-row">
        <button class="bm-clear bw-clearbtn ${props.clearArmed ? 'armed' : ''}" type="button"
                title="${props.clearArmed ? 'Armed — click to run /clear' : 'Click twice to run /clear'}">
          ${props.clearArmed ? 'sure?' : 'clear'}
        </button>
        ${renderShimPlate(props.shim)}
      </div>
    </div>`;
}
