import type { SessionInfo } from './sessions';

export type Heat = 'ok' | 'warn' | 'danger';

export interface BraincellsAssessment {
  score: number; // 0–10, 10 = fresh brain
  label: string;
  heat: Heat;
  reasons: string[];
}

const WARN_PCT = 0.6;
const DANGER_PCT = 0.85;
const IDLE_THRESHOLD_MS = 30 * 60 * 1000;
const STANDARD_CONTEXT_LIMIT = 200_000;

const LABELS: { min: number; label: string }[] = [
  { min: 9, label: 'Galaxy Brain' },
  { min: 7, label: 'Big Brain' },
  { min: 5, label: 'Cooking' },
  { min: 3, label: 'Sweating' },
  { min: 1, label: 'Smoking' },
  { min: 0, label: 'Fried' },
];

/**
 * Scoring heuristic — intentionally simple and tweakable:
 * base score is the fraction of context still free, scaled to 0–10,
 * with a -1 penalty in the danger zone (auto-compact imminent).
 */
export function assessSession(session: SessionInfo): BraincellsAssessment {
  const pct = Math.min(1, session.contextTokens / session.contextLimit);
  const pctDisplay = Math.round(pct * 100);

  let score = Math.round((1 - pct) * 10);
  if (pct >= DANGER_PCT) score -= 1;
  score = Math.max(0, Math.min(10, score));

  const heat: Heat = pct >= DANGER_PCT ? 'danger' : pct >= WARN_PCT ? 'warn' : 'ok';

  const reasons: string[] = [];
  if (pct < 0.25) {
    reasons.push(`Fresh context — only ${pctDisplay}% used`);
  } else {
    reasons.push(`Context ${pctDisplay}% full`);
  }
  if (pct >= DANGER_PCT) {
    reasons.push('Auto-compact imminent');
  }
  if (session.contextLimit > STANDARD_CONTEXT_LIMIT) {
    reasons.push('Extended 1M-token window');
  }
  const idleMs = Date.now() - new Date(session.lastActivity).getTime();
  if (idleMs > IDLE_THRESHOLD_MS) {
    const idleMin = Math.floor(idleMs / 60000);
    reasons.push(idleMin >= 60 ? `Idle ${Math.floor(idleMin / 60)}h` : `Idle ${idleMin}m`);
  }

  const label = LABELS.find((l) => score >= l.min)?.label ?? 'Fried';

  return { score, label, heat, reasons };
}
