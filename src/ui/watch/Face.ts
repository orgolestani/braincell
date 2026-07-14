/**
 * Face — the front of the pocket watch.
 *
 * The bezel chapter ring IS the Context Meter: an SVG arc sweeping 300°
 * (gap at 6 o'clock) that fills with context %, colored by heat. The center
 * porthole is reserved for the mascot.
 *
 * Mascot contract: the 3D brain (ui/watch/mascot.ts) is a persistent canvas
 * that renderer.ts re-mounts into `[data-mascot-slot]` after every render —
 * this module only renders the empty slot.
 */
import { escapeHtml, prettyModel } from '../format';
import type { BraincellsAssessment } from '../../braincells';
import { MODE_TITLES, type SessionMode } from '../../mode';

export interface FaceProps {
  assessment: BraincellsAssessment;
  contextPct: number; // 0–100
  mode: SessionMode;
  errors: number; // tool errors since the last user prompt
  model: string | null; // session model id — printed as the maker's mark
}

// Dial geometry (viewBox units == css px at 240 dial).
const DIAL = 240;
const CENTER = DIAL / 2;
const RING_R = 106;
const SWEEP = 300; // degrees of meter travel
const START = 120; // gap centered at 6 o'clock (90° ± 30° in y-down coords)

function polar(angleDeg: number, r: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: CENTER + r * Math.cos(a), y: CENTER + r * Math.sin(a) };
}

function arcPath(fromDeg: number, sweepDeg: number, r: number): string {
  const p0 = polar(fromDeg, r);
  const p1 = polar(fromDeg + sweepDeg, r);
  const large = sweepDeg > 180 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

/** Minute-style tick marks along the meter travel (skipping the gap). */
function ticks(): string {
  const out: string[] = [];
  for (let i = 0; i <= 30; i++) {
    const angle = START + (SWEEP * i) / 30;
    const major = i % 5 === 0;
    const p0 = polar(angle, RING_R - (major ? 9 : 6));
    const p1 = polar(angle, RING_R - 2);
    out.push(
      `<line class="bw-tick ${major ? 'major' : ''}" x1="${p0.x.toFixed(2)}" y1="${p0.y.toFixed(2)}" x2="${p1.x.toFixed(2)}" y2="${p1.y.toFixed(2)}"/>`,
    );
  }
  return out.join('');
}

/** The bezel Context Meter: track + heat-colored fill arc. */
function renderBezel(contextPct: number): string {
  const pct = Math.max(0, Math.min(100, contextPct));
  const fillSweep = (SWEEP * pct) / 100;
  const fill =
    fillSweep > 0.5
      ? `<path class="bw-meter-fill" d="${arcPath(START, fillSweep, RING_R)}"/>`
      : '';
  return `
    <svg class="bw-bezel" viewBox="0 0 ${DIAL} ${DIAL}" aria-hidden="true">
      <path class="bw-meter-track" d="${arcPath(START, SWEEP, RING_R)}"/>
      ${fill}
      ${ticks()}
    </svg>`;
}

export function renderFace(props: FaceProps): string {
  const errTip = `${props.errors} tool error${props.errors === 1 ? '' : 's'}`;

  return `
    <div class="bw-face" data-heat="${props.assessment.heat}">
      ${renderBezel(props.contextPct)}
      <div class="bw-jewel" data-mode="${props.mode}" data-tip="${MODE_TITLES[props.mode]}"></div>
      <div class="bw-porthole">
        <div class="bw-mascot" data-mascot-slot></div>
      </div>
      <div class="bw-aperture" data-tip="Context used" data-tip-pos="top">
        <span class="bw-aperture-label">Context</span>
        <span class="bw-aperture-value">${Math.round(props.contextPct)}%</span>
      </div>
      <div class="bw-errjewel" data-lit="${props.errors > 0}" data-tip="${errTip}" data-tip-pos="top">${props.errors > 0 ? props.errors : ''}</div>
      ${
        props.model
          ? `<div class="bw-model" data-tip="${escapeHtml(props.model)}" data-tip-pos="top">${escapeHtml(prettyModel(props.model))}</div>`
          : ''
      }
    </div>`;
}

/** Front face for the no-sessions state — same chrome, sleeping porthole. */
export function renderFaceEmpty(): string {
  return `
    <div class="bw-face" data-heat="ok">
      ${renderBezel(0)}
      <div class="bw-jewel" data-mode="watching" data-tip="No sessions detected"></div>
      <div class="bw-porthole">
        <div class="bw-mascot bw-mascot-empty" data-mascot-slot>zzz</div>
      </div>
      <div class="bw-aperture">
        <span class="bw-aperture-label">Context</span>
        <span class="bw-aperture-value">—</span>
      </div>
      <div class="bw-errjewel" data-lit="false" data-tip="0 tool errors"></div>
    </div>`;
}
