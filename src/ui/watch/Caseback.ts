/**
 * Caseback — the engraved brass back of the watch, shown when flipped.
 * Holds everything that isn't the meter: session switcher, CLEAR (arm →
 * confirm) and the auto-wire shim toggle. (No explicit wire/fork button:
 * pulling Compact/Clear on an unwired session forks it automatically.)
 *
 * Action contracts shared with renderer.ts delegation (do not rename):
 * `[data-session-id]`, `.bm-clear`, `.bm-shimtoggle`.
 */
import type { SessionInfo } from '../../sessions';
import { activityOf } from '../../activity';
import { escapeHtml, prettyModel, timeAgo } from '../format';

const FOLLOW = '__follow__';

/** "Braincells" engraved along a shallow arc, following the caseback's curve. */
export const TITLE_ARC = `
    <svg class="bw-title-arc" viewBox="0 0 240 32" aria-hidden="true">
      <path id="bwTitleArc" d="M 40 24 A 325 325 0 0 1 200 24" fill="none"/>
      <text class="bw-title-arc-text"><textPath href="#bwTitleArc" startOffset="50%" text-anchor="middle">Braincells</textPath></text>
    </svg>`;

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
  const wired = wiredIds.has(s.sessionId);
  return `
    <button class="bw-slot ${s.sessionId === selectedId ? 'selected' : ''}" type="button"
            data-session-id="${escapeHtml(s.sessionId)}"
            data-tip="${wired ? 'Wired — tap to track' : 'Tap to track'}">
      <span class="bw-dot" data-activity="${activity}"></span>
      <span class="bw-slot-name">${escapeHtml(label)}</span>
      ${wired ? '<span class="bw-slot-chip">wired</span>' : ''}
      <span class="bw-slot-ago">${timeAgo(s.lastActivity)}</span>
      <span class="bw-slot-bar"><span style="width:${pct.toFixed(0)}%"></span></span>
    </button>`;
}

/** Auto-wire plate: lamp + state, toggles the shell shim. */
function renderShimPlate(shim: CasebackShimStatus | null): string {
  const state = !shim ? 'unknown' : !shim.installed ? 'off' : shim.wrapperCurrent ? 'on' : 'repair';
  const stateLabel = { unknown: '…', off: 'OFF', on: 'ON', repair: 'FIX' }[state];
  const tip = {
    unknown: 'Checking…',
    off: 'Enables auto-wire',
    on: 'Auto-wire is on',
    repair: 'Needs repair',
  }[state];
  return `
    <button class="bm-shimtoggle bw-shim" type="button" data-state="${state}" data-tip="${tip}" data-tip-pos="top">
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
            data-tip="Auto-track newest">
      <span class="bw-slot-name">▶ Follow latest</span>
      <span class="bw-slot-ago">auto</span>
    </button>`;

  return `
    <div class="bw-caseback">
      ${TITLE_ARC}
      <div class="bw-back-engraving" data-tip="${escapeHtml(prettyModel(props.hero.model))}${props.hero.gitBranch ? ` · ${escapeHtml(props.hero.gitBranch)}` : ''}">${escapeHtml(prettyModel(props.hero.model))}${props.hero.gitBranch ? ` · ${escapeHtml(props.hero.gitBranch)}` : ''}</div>
      <div class="bw-back-section">✦ sessions — tap to track ✦</div>
      <div class="bw-slots">${followSlot}${props.sessions.map((s) => renderSlot(s, props.selectedId, props.wiredIds)).join('')}</div>
      <div class="bw-back-row">
        <button class="bm-clear bw-clearbtn ${props.clearArmed ? 'armed' : ''}" type="button"
                data-live="${props.heroWired}"
                data-tip="${props.clearArmed ? 'Clears now' : 'Clear session'}" data-tip-pos="top">
          <span class="bw-dot bw-clear-lamp" data-activity="${props.heroWired ? 'live' : 'stale'}"></span>
          ${props.clearArmed ? 'sure?' : 'clear'}
        </button>
        ${renderShimPlate(props.shim)}
      </div>
    </div>`;
}
