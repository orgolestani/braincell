/**
 * Fob — the minimized form: a small always-on-top brass capsule, like the
 * chain fob of the pocket watch. Shows just what matters at a glance —
 * activity jewel, linear Context gauge with heat-colored fill, %, a one-click
 * compact crown — plus the expand control back to the full watch.
 *
 * Action contracts shared with renderer.ts delegation: `.bm-compact` (same
 * hook as the watch crown — WIRED sends /compact, WATCHING forks) and
 * `.bm-expand` (return to watch view). Native title tooltips only: the fob
 * window is too short for the paper-tag tips.
 */
import type { SessionInfo } from '../../sessions';
import type { BraincellsAssessment } from '../../braincells';
import { MODE_TITLES, type SessionMode } from '../../mode';
import { escapeHtml, prettyModel } from '../format';

export function renderFob(session: SessionInfo, assessment: BraincellsAssessment, mode: SessionMode): string {
  const pct = Math.min(100, (session.contextTokens / session.contextLimit) * 100);
  const meterTitle = `${Math.round(pct)}% context · ${escapeHtml(prettyModel(session.model))}`;
  return `
    <div class="bf" data-heat="${assessment.heat}">
      <span class="bw-dot" data-mode="${mode}" title="${MODE_TITLES[mode]}"></span>
      <div class="bf-gauge" title="${meterTitle}">
        <span class="bf-fill" style="width:${pct.toFixed(0)}%"></span>
      </div>
      <span class="bf-pct">${Math.round(pct)}%</span>
      <button class="bm-compact bf-crown" type="button" title="Compact context"
              aria-label="Compact context"></button>
      <button class="bm-expand bf-expand" type="button" title="Expand to the watch"
              aria-label="Expand to the watch">⤢</button>
    </div>`;
}

/** Fob for the no-sessions state — same capsule, dark gauge. */
export function renderFobEmpty(): string {
  return `
    <div class="bf" data-heat="ok">
      <span class="bw-dot" data-mode="watching" title="No sessions detected"></span>
      <div class="bf-gauge" title="No sessions detected"><span class="bf-fill" style="width:0%"></span></div>
      <span class="bf-pct">—</span>
      <button class="bm-expand bf-expand" type="button" title="Expand to the watch"
              aria-label="Expand to the watch">⤢</button>
    </div>`;
}
