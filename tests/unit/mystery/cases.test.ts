// Consistency of the three case files (public data) against their answer keys (docs/MYSTERY_CASES.md, design §4b).
// Deduction rule for every case: METHOD, OPPORTUNITY and BROKEN ALIBI against the same person; the culprit is named in
// all three clues, each innocent in exactly one — the clue that clears them; two case-file notes support nobody.
import { describe, expect, it } from 'vitest';
import { CASES, caseById, isCaseId, ROOM_LABELS } from '../../../src/mystery/data/cases.ts';
import { caseWorld } from '../../../src/mystery/data/caseWorlds.ts';
import { CASE_SOLUTIONS, caseSolution } from '../../../src/mystery/data/solutions.ts';
import { CASE_IDS, CLUE_IDS, SUSPECT_IDS, type CaseDef, type RoomId, type SuspectId } from '../../../src/mystery/types.ts';

/** How each suspect is named in clue text (surname, given name, initials as written in the clues). */
const NAME_PATTERNS: Record<SuspectId, RegExp> = {
  thornhill: /\bThornhill\b|\bMarilyn\b/,
  isaac: /\bIsaac\b|\bI\. Night\b|\bNight\b(?! guard)|\bI\.N\./,
  barry: /\bBarry\b|\bDort\b/,
};
/**
 * Unambiguous role references (each role belongs to one suspect in every case). Case 03's watchtower_signal refers to
 * Barry only as "the guard" — counted as a mention. Case-file notes may hint at a role on purpose (red herrings).
 */
const ROLE_PATTERNS: Record<SuspectId, RegExp> = {
  thornhill: /\barchivist\b|\bcurator\b/i,
  isaac: /\bgroundskeeper\b/i,
  barry: /\b(night )?guard(['’]s)?\b(?! post)/i,
};
/** Words that would state a verdict before the accusation. */
const VERDICT_WORDS = /\b(culprit|guilty|guilt|killer|murderer|perpetrator|did it|is to blame)\b/i;

function publicStrings(def: CaseDef): [string, string][] {
  const out: [string, string][] = [
    ['title', def.title], ['tagline', def.tagline], ['setting', def.setting],
    ['thing.welcome', def.thing.welcome], ['thing.findEgg', def.thing.findEgg], ['thing.whereHint', def.thing.whereHint],
    ['prologue.death.title', def.prologue.death.title], ['prologue.death.narration', def.prologue.death.narration],
    ['prologue.egg.title', def.prologue.egg.title], ['prologue.egg.narration', def.prologue.egg.narration],
    ['egg.objective', def.egg.objective],
  ];
  for (const c of def.clues) {
    out.push([`${c.id}.title`, c.title], [`${c.id}.text`, c.text], [`${c.id}.deduction`, c.deduction],
      [`${c.id}.thing.found`, c.thing.found], [`${c.id}.thing.vision`, c.thing.vision], [`${c.id}.interactLabel`, c.interactLabel]);
    if (c.short) out.push([`${c.id}.short`, c.short]);
    if (c.meaning) out.push([`${c.id}.meaning`, c.meaning]);
  }
  for (const n of def.notes) out.push([`${n.id}.title`, n.title], [`${n.id}.text`, n.text]);
  for (const s of def.suspects) out.push([`${s.id}.alibi`, s.alibiOrContext]);
  return out;
}

describe('case registry', () => {
  it('exactly the three case ids, numbered 01–03 in order, each its own scene', () => {
    expect(Object.keys(CASES)).toEqual([...CASE_IDS]);
    expect(Object.keys(CASE_SOLUTIONS).sort()).toEqual([...CASE_IDS].sort());
    expect(CASE_IDS.map((id) => CASES[id].number)).toEqual(['01', '02', '03']);
    expect(new Set(CASE_IDS.map((id) => CASES[id].prologue.scene)).size).toBe(3);
    for (const id of CASE_IDS) {
      expect(CASES[id].id).toBe(id);
      expect(caseById(id)).toBe(CASES[id]);
      expect(caseSolution(id)).toBe(CASE_SOLUTIONS[id]);
      expect(isCaseId(id)).toBe(true);
    }
    expect(isCaseId('silent_evidence')).toBe(false);
    expect(isCaseId('toString')).toBe(false);
    expect(isCaseId(undefined)).toBe(false);
  });

  it('clue ids are unique across cases and together are exactly CLUE_IDS', () => {
    const all = CASE_IDS.flatMap((id) => CASES[id].clues.map((c) => c.id));
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...CLUE_IDS].sort());
  });

  it('note ids are unique across cases and never collide with any clue id', () => {
    const notes = CASE_IDS.flatMap((id) => CASES[id].notes.map((n) => n.id));
    expect(new Set(notes).size).toBe(notes.length);
    for (const n of notes) expect(CLUE_IDS as readonly string[]).not.toContain(n);
  });

  it('public case data carries no answer (no culprit / links / supporting evidence fields)', () => {
    const json = JSON.stringify(CASES);
    expect(json).not.toMatch(/"(culprit|supportingEvidence|links|clears|proves|implicates|exonerates|innocents|resolution)"/);
  });
});

for (const id of CASE_IDS) {
  const def = CASES[id];
  const sol = CASE_SOLUTIONS[id];
  const clueIds = def.clues.map((c) => c.id);
  const innocents = SUSPECT_IDS.filter((s) => s !== sol.culprit);

  describe(`${def.number} ${def.title}`, () => {
    it('3 clues, each with one candidate-site group in the case world; 2 notes; same three suspects', () => {
      expect(def.clues).toHaveLength(3);
      const world = caseWorld(id);
      expect(world.caseId).toBe(id);
      expect(world.clueSites.map((g) => g.clueId)).toEqual(clueIds);
      for (const g of world.clueSites) {
        expect(g.sites.length, g.clueId).toBeGreaterThanOrEqual(1);
        expect(g.searchS).toBeGreaterThanOrEqual(1.5);
        expect(g.searchS).toBeLessThanOrEqual(4);
      }
      expect(def.egg.objective.length).toBeGreaterThan(5);
      expect(def.notes).toHaveLength(2);
      expect(def.suspects.map((s) => s.id)).toEqual([...SUSPECT_IDS]);
      for (const s of def.suspects) {
        expect(s.name.length).toBeGreaterThan(3);
        expect(s.alibiOrContext.length).toBeGreaterThan(10);
      }
      for (const r of Object.keys(def.roomNames)) expect(Object.keys(ROOM_LABELS)).toContain(r as RoomId);
      expect(def.version).toBeGreaterThanOrEqual(2); // overhaul content version (OVERHAUL_CONTRACT)
    });

    it('TL;DR cards: every clue has `short` (≤ 90 chars) and `meaning` (≤ 60 chars)', () => {
      for (const c of def.clues) {
        expect(c.short, `${c.id}.short`).toBeTruthy();
        expect(c.meaning, `${c.id}.meaning`).toBeTruthy();
        expect(c.short!.length, `${c.id}.short`).toBeLessThanOrEqual(90);
        expect(c.meaning!.length, `${c.id}.meaning`).toBeLessThanOrEqual(60);
      }
    });

    it('answer key belongs to this case: id, version, supporting evidence = the 3 clues', () => {
      expect(sol.caseId).toBe(id);
      expect(sol.version).toBe(def.version);
      expect(SUSPECT_IDS).toContain(sol.culprit);
      expect(sol.supportingEvidence).toHaveLength(3);
      expect([...sol.supportingEvidence].sort()).toEqual([...clueIds].sort());
      for (const n of def.notes) expect(sol.supportingEvidence as string[]).not.toContain(n.id);
    });

    it('links: one per clue, proving method / opportunity / alibi exactly once, clearing only innocents', () => {
      expect(Object.keys(sol.links).sort()).toEqual([...clueIds].sort());
      expect(Object.values(sol.links).map((l) => l.proves).sort()).toEqual(['alibi', 'method', 'opportunity']);
      for (const l of Object.values(sol.links)) {
        expect(l.clears).not.toContain(sol.culprit);
        expect(new Set(l.clears).size).toBe(l.clears.length);
      }
    });

    it('the culprit is named in all 3 clues; each innocent in exactly one — the clue whose link clears them', () => {
      for (const c of def.clues) expect(c.mentions, c.id).toContain(sol.culprit);
      for (const s of innocents) {
        const naming = def.clues.filter((c) => c.mentions.includes(s));
        expect(naming.map((c) => c.id), `${s} named in`).toHaveLength(1);
        expect(sol.links[naming[0].id].clears, `${naming[0].id} clears ${s}`).toContain(s);
        // and no other clue clears them
        expect(def.clues.filter((c) => sol.links[c.id].clears.includes(s))).toHaveLength(1);
      }
    });

    it('`mentions` is exactly the set of suspects named (or referred to by role) in the clue text', () => {
      for (const c of def.clues) {
        const named = SUSPECT_IDS.filter((s) => NAME_PATTERNS[s].test(c.text) || ROLE_PATTERNS[s].test(c.text));
        expect(named, c.id).toEqual(SUSPECT_IDS.filter((s) => c.mentions.includes(s)));
      }
    });

    it('both innocents are explained on the results screen; the resolution names the culprit', () => {
      expect(Object.keys(sol.innocents).sort()).toEqual([...innocents].sort());
      for (const s of innocents) expect(sol.innocents[s]!.length).toBeGreaterThan(20);
      const culprit = def.suspects.find((s) => s.id === sol.culprit)!;
      expect(sol.resolution).toContain(culprit.name.split(' ')[1]);
    });

    it('no public text states a verdict (culprit / guilty / killer / murderer …)', () => {
      for (const [where, text] of publicStrings(def)) expect(text, where).not.toMatch(VERDICT_WORDS);
    });

    it('length budgets: Thing lines ≤ 90, clue text ≤ 300, deduction ≤ 120', () => {
      const thingLines = [def.thing.welcome, def.thing.findEgg, def.thing.whereHint, ...def.clues.flatMap((c) => [c.thing.found, c.thing.vision])];
      for (const l of thingLines) expect(l.length, l).toBeLessThanOrEqual(90);
      for (const c of def.clues) {
        expect(c.text.length, `${c.id} text`).toBeLessThanOrEqual(300);
        expect(c.deduction.length, `${c.id} deduction`).toBeLessThanOrEqual(120);
        expect(c.title.length).toBeGreaterThan(3);
      }
    });

    it('case notes support nobody: they name no suspect', () => {
      for (const n of def.notes) for (const s of SUSPECT_IDS) expect(`${n.title} ${n.text}`, n.id).not.toMatch(NAME_PATTERNS[s]);
    });
  });
}
