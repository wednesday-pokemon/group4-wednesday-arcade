// Verdict truth table for the three cases (pure; shared with Deno). Never random: the same clues + accusation always
// give the same verdict. The answer key (CaseSolution) is a PARAMETER — this module never imports data/solutions.ts,
// so browser code can use it without shipping the answer.
//
// `case_solved` requires ALL clues of the case, the culprit, AND citing exactly the supporting evidence.
import type { Accusation, CaseDef, CaseSolution, ClueId, SuspectId, Verdict } from './types.ts';

export function hasAllClues(caseDef: CaseDef, cluesFound: readonly ClueId[]): boolean {
  return caseDef.clues.every((c) => cluesFound.includes(c.id));
}

export function isCorrectSuspect(solution: CaseSolution, accused: SuspectId | null): boolean {
  return accused !== null && accused === solution.culprit;
}

/** The cited evidence is exactly the supporting set (order and duplicates ignored). */
export function evidenceSupports(solution: CaseSolution, evidence: readonly string[]): boolean {
  const cited = new Set(evidence);
  return cited.size === solution.supportingEvidence.length && solution.supportingEvidence.every((id) => cited.has(id));
}

/** Evidence ids a visitor may cite in this case: the clues they found plus the case-file notes. */
export function citableEvidence(caseDef: CaseDef, cluesFound: readonly ClueId[]): string[] {
  return [...caseDef.clues.filter((c) => cluesFound.includes(c.id)).map((c) => c.id), ...caseDef.notes.map((n) => n.id)];
}

/** Drops anything not citable (unknown ids, clues not found) and duplicates, keeping the visitor's order. */
export function sanitizeEvidence(caseDef: CaseDef, cluesFound: readonly ClueId[], evidence: readonly string[]): string[] {
  const ok = new Set(citableEvidence(caseDef, cluesFound));
  return [...new Set(evidence)].filter((id) => ok.has(id));
}

/** The solution belongs to this case (same id AND version) — guards against a stale answer key. */
export function solutionMatches(caseDef: CaseDef, solution: CaseSolution): boolean {
  return solution.caseId === caseDef.id && solution.version === caseDef.version;
}

/**
 * - no accusation → 'not_accused'
 * - all clues + culprit + exactly the supporting evidence → 'case_solved'
 * - otherwise (wrong suspect, weak evidence, or the right one guessed without all clues) → 'egg_secured_mystery_unsolved'
 */
export function verdictFor(caseDef: CaseDef, solution: CaseSolution, cluesFound: readonly ClueId[], accusation: Accusation): Verdict {
  if (accusation.suspectId === null) return 'not_accused';
  return hasAllClues(caseDef, cluesFound) && isCorrectSuspect(solution, accusation.suspectId) && evidenceSupports(solution, accusation.evidence)
    ? 'case_solved'
    : 'egg_secured_mystery_unsolved';
}

/** Post-accusation board/results view: how many found clues implicate / clear each suspect (needs the answer key). */
export function suspectLinks(caseDef: CaseDef, solution: CaseSolution, cluesFound: readonly ClueId[]): Record<SuspectId, { implicated: number; exonerated: number }> {
  const out = {} as Record<SuspectId, { implicated: number; exonerated: number }>;
  for (const s of caseDef.suspects) out[s.id] = { implicated: 0, exonerated: 0 };
  for (const clue of caseDef.clues) {
    if (!cluesFound.includes(clue.id)) continue;
    if (solution.supportingEvidence.includes(clue.id) && out[solution.culprit]) out[solution.culprit].implicated++;
    for (const s of solution.links[clue.id]?.clears ?? []) if (out[s]) out[s].exonerated++;
  }
  return out;
}

/**
 * Pre-accusation, answer-free deduction aid (bot + hints): how many FOUND clues name each suspect. By design the
 * culprit is named in all three clues and each innocent in one, so this is information the visitor also has.
 */
export function mentionCounts(caseDef: CaseDef, cluesFound: readonly ClueId[]): Record<SuspectId, number> {
  const out = {} as Record<SuspectId, number>;
  for (const s of caseDef.suspects) out[s.id] = 0;
  for (const clue of caseDef.clues) if (cluesFound.includes(clue.id)) for (const s of clue.mentions) if (s in out) out[s]++;
  return out;
}
