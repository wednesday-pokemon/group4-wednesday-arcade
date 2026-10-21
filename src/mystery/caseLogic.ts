// Verdict truth table for "The Silent Evidence" (pure; shared with Deno). Never random: the same clues + accusation
// always give the same verdict. `case_solved` requires ALL clues of the case AND the case's culprit.
import type { CaseDef, ClueId, SuspectId, Verdict } from './types.ts';

export function hasAllClues(caseDef: CaseDef, cluesFound: readonly ClueId[]): boolean {
  return caseDef.clues.every((c) => cluesFound.includes(c.id));
}

export function isCorrectSuspect(caseDef: CaseDef, accused: SuspectId | null): boolean {
  return accused !== null && accused === caseDef.culprit;
}

/**
 * - no accusation → 'not_accused'
 * - all clues + culprit → 'case_solved'
 * - otherwise (wrong suspect, or the right one guessed without all clues) → 'egg_secured_mystery_unsolved'
 */
export function verdictFor(caseDef: CaseDef, cluesFound: readonly ClueId[], accused: SuspectId | null): Verdict {
  if (accused === null) return 'not_accused';
  return hasAllClues(caseDef, cluesFound) && isCorrectSuspect(caseDef, accused) ? 'case_solved' : 'egg_secured_mystery_unsolved';
}

/** Evidence-to-suspect links from the found clues (for the board): how many found clues implicate / exonerate each. */
export function suspectLinks(caseDef: CaseDef, cluesFound: readonly ClueId[]): Record<SuspectId, { implicated: number; exonerated: number }> {
  const out = {} as Record<SuspectId, { implicated: number; exonerated: number }>;
  for (const s of caseDef.suspects) out[s.id] = { implicated: 0, exonerated: 0 };
  for (const clue of caseDef.clues) {
    if (!cluesFound.includes(clue.id)) continue;
    for (const s of clue.implicates) if (out[s]) out[s].implicated++;
    for (const s of clue.exonerates) if (out[s]) out[s].exonerated++;
  }
  return out;
}
