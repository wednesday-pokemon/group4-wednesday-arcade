// Case awareness for the analytics layer: which case a record / run played, the case's PUBLIC clue list (titles,
// locations) and how the one-shot accusation ended. Only public case data (data/cases.ts) is used here — never the
// answer key: the accusation outcome is read from what the run already recorded AFTER the accusation (the
// `accusation` event's `correct` / `deductionCorrect`, the verdict, or the result row).
import { CASES, isCaseId } from '../data/cases.ts';
import type { CaseDef, CaseId, StampedEvent } from '../types.ts';
import type { AccusationKind, SessionRecord } from './types.ts';

export { isCaseId };

/** The case-free clue count used for legacy records (the single pre-three-cases case also had three clues). */
export const LEGACY_CLUE_COUNT = 3;

/** The public case-file bits analytics needs (clue ids / titles / locations, number, title, egg objective). */
export type CaseInfo = Pick<CaseDef, 'id' | 'version' | 'number' | 'title' | 'clues' | 'egg'>;

export function caseInfo(id: CaseId): CaseInfo {
  return CASES[id];
}

/** Clue count of a case (legacy / unknown → LEGACY_CLUE_COUNT). */
export function clueCountFor(caseId: CaseId | null | undefined): number {
  return caseId && isCaseId(caseId) ? CASES[caseId].clues.length : LEGACY_CLUE_COUNT;
}

/** "Case 01 · The Poisoned Archive" (legacy → "Legacy case"). */
export function caseLabel(caseId: CaseId | null | undefined): string {
  if (!caseId || !isCaseId(caseId)) return 'Legacy case';
  const c = CASES[caseId];
  return `Case ${c.number} · ${c.title}`;
}

/** The case a record played, or null for a legacy record (no / unknown case id). */
export function recordCaseId(r: Pick<SessionRecord, 'caseId' | 'result'>): CaseId | null {
  const c = r.caseId ?? r.result?.caseId ?? null;
  return isCaseId(c) ? c : null;
}

/** Which case a clue id belongs to (null = not a clue of the three cases, e.g. a legacy id). */
export function caseOfClue(clueId: string): CaseId | null {
  for (const c of Object.values(CASES)) if (c.clues.some((x) => x.id === clueId)) return c.id;
  return null;
}

type AccusationEvent = Extract<StampedEvent, { type: 'accusation' }>;

export interface AccusationInput {
  events: readonly StampedEvent[];
  result?: SessionRecord['result'];
}

/**
 * How the accusation ended, from the record alone (no answer key):
 *   1. DNF → 'dnf'; no terminal event / result → 'pending';
 *   2. verdict case_solved → 'solved'; verdict not_accused on a finished run → 'not_accused';
 *   3. verdict egg_secured_mystery_unsolved → the culprit was named ('right_suspect_wrong_evidence') or not
 *      ('wrong_suspect'), from `result.correct` or the accusation event's `correct`; 'unsolved' if neither is known.
 */
export function accusationKind(r: AccusationInput): AccusationKind {
  const ev = r.events;
  const terminal = [...ev].reverse().find((e) => e.type === 'finish' || e.type === 'dnf');
  const outcome = r.result?.outcome ?? (terminal ? (terminal.type === 'finish' ? 'finished' : 'dnf') : null);
  if (outcome === null) return 'pending';
  if (outcome === 'dnf') return 'dnf';
  const verdict = r.result?.verdict ?? (terminal?.type === 'finish' ? terminal.verdict : null);
  if (verdict === 'case_solved') return 'solved';
  if (verdict === 'not_accused') return 'not_accused';
  const acc = lastAccusation(ev);
  const correct = typeof r.result?.correct === 'boolean' ? r.result.correct : acc && typeof acc.correct === 'boolean' ? acc.correct : null;
  if (correct === null) return 'unsolved';
  return correct ? 'right_suspect_wrong_evidence' : 'wrong_suspect';
}

export function lastAccusation(events: readonly StampedEvent[]): AccusationEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'accusation') return e;
  }
  return null;
}

export const ACCUSATION_TEXT: Record<AccusationKind, string> = {
  solved: 'Solved',
  right_suspect_wrong_evidence: 'Right suspect, weak evidence',
  wrong_suspect: 'Wrong suspect',
  not_accused: 'Not accused',
  unsolved: 'Unsolved (detail unknown)',
  dnf: 'DNF before accusing',
  pending: 'In progress',
};
