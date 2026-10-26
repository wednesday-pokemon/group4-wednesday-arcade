// Per-session case scenario (docs/MYSTERY_CASES.md "Randomized murderer"). PURE and answer-free: the public CaseDef
// ships with every clue SEALED (CLUE_SEALED_TEXT, no mentions); the culprit-specific ClueContent of the session's
// variant is merged in only for clues the visitor has found (LIVE: from the server's append ack; local demo: from the
// variant loaded at run start). Shared with Deno (the server builds its session CaseDef the same way).
import { CLUE_SEALED_TEXT } from './data/cases.ts';
import { prfUniform } from './prf.ts';
import type { CaseDef, ClueContent, ClueDef, ClueId, SuspectId } from './types.ts';

export { CLUE_SEALED_TEXT };

export function isClueSealed(clue: ClueDef): boolean {
  return clue.text === CLUE_SEALED_TEXT;
}

export function applyClueContent(clue: ClueDef, c: ClueContent): ClueDef {
  return {
    ...clue, text: c.text, short: c.short, meaning: c.meaning, mentions: [...c.mentions], deduction: c.deduction,
    thing: { ...clue.thing, found: c.found },
  };
}

/** A copy of `def` with the given clue contents merged in (other clues stay as they are). */
export function withClueContent(def: CaseDef, contents: Partial<Record<ClueId, ClueContent>>): CaseDef {
  return { ...def, clues: def.clues.map((c) => (contents[c.id] ? applyClueContent(c, contents[c.id]!) : c)) };
}

/**
 * Merges contents into `def` IN PLACE (the running sim's own session copy, read every frame by the HUD). Returns the
 * ids that were sealed before and are now readable.
 */
export function revealClues(def: CaseDef, contents: Partial<Record<ClueId, ClueContent>>): ClueId[] {
  const out: ClueId[] = [];
  def.clues.forEach((c, i) => {
    const next = contents[c.id];
    if (!next || !isClueSealed(c)) return;
    def.clues[i] = applyClueContent(c, next);
    out.push(c.id);
  });
  return out;
}

/** Session display order of the suspects (seeded, so a refresh shows the same order; carries no answer). */
export function suspectOrder(def: CaseDef, seed: string): SuspectId[] {
  return def.suspects
    .map((s) => ({ id: s.id, k: prfUniform(seed, `suspect-order:${s.id}`) }))
    .sort((a, b) => a.k - b.k)
    .map((s) => s.id);
}

/** The session's case: a fresh copy (safe to reveal into) with the suspects in the session's order. */
export function sessionCaseDef(def: CaseDef, seed: string, contents: Partial<Record<ClueId, ClueContent>> = {}): CaseDef {
  const order = suspectOrder(def, seed);
  const base = withClueContent(def, contents);
  return { ...base, clues: [...base.clues], suspects: order.map((id) => def.suspects.find((s) => s.id === id)!) };
}

/**
 * LIVE accusation without the answer key in hand: the murderer the READ clues imply, used only to judge the accusation
 * locally until the server's verified result replaces it. Exact once all clues are read; with fewer, an accused suspect
 * the clues have not yet narrowed to is provisionally judged wrong.
 */
export function provisionalCulprit(def: CaseDef, cluesFound: readonly ClueId[], accused: SuspectId | null): SuspectId {
  const read = def.clues.filter((c) => cluesFound.includes(c.id) && !isClueSealed(c));
  const candidates = def.suspects.map((s) => s.id).filter((id) => read.every((c) => c.mentions.includes(id)));
  if (candidates.length === 1) return candidates[0];
  return candidates.find((id) => id !== accused) ?? candidates[0] ?? def.suspects[0].id;
}
