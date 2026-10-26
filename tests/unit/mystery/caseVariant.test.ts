// Randomized murderer (docs/MYSTERY_CASES.md "Randomized murderer"): the session case is sealed and seeded, clue texts
// are revealed only for found clues, the READ clues decide the provisional verdict, and each of the 9 case × murderer
// scenarios is logically unique (exactly one suspect is named by all three clues).
import { describe, expect, it } from 'vitest';
import {
  CLUE_SEALED_TEXT, isClueSealed, provisionalCulprit, revealClues, sessionCaseDef, suspectOrder, withClueContent,
} from '../../../src/mystery/caseVariant.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { CASE_VARIANTS } from '../../../src/mystery/data/solutions.ts';
import { episodeCase, episodeCulprit } from '../../../src/mystery/episode.ts';
import { CASE_IDS, SUSPECT_IDS, type SuspectId } from '../../../src/mystery/types.ts';

describe('every case × murderer scenario has exactly one answer', () => {
  for (const id of CASE_IDS) {
    for (const murderer of SUSPECT_IDS) {
      it(`${id} / ${murderer}`, () => {
        const def = withClueContent(CASES[id], CASE_VARIANTS[id][murderer].clues);
        const namedByAll = SUSPECT_IDS.filter((s) => def.clues.every((c) => c.mentions.includes(s)));
        expect(namedByAll).toEqual([murderer]);
        expect(provisionalCulprit(def, def.clues.map((c) => c.id), null)).toBe(murderer);
        // each innocent is cleared by a clue the visitor can read
        const links = CASE_VARIANTS[id][murderer].solution.links;
        for (const s of SUSPECT_IDS.filter((x) => x !== murderer)) expect(Object.values(links).some((l) => l.clears.includes(s)), s).toBe(true);
      });
    }
  }
});

describe('session case', () => {
  it('is a sealed copy: revealing into it never touches the shared case data', () => {
    const def = sessionCaseDef(CASES.poisoned_archive, 'seed-a');
    expect(def).not.toBe(CASES.poisoned_archive);
    expect(def.clues.every(isClueSealed)).toBe(true);
    const first = def.clues[0].id;
    expect(revealClues(def, { [first]: CASE_VARIANTS.poisoned_archive.barry.clues[first]! })).toEqual([first]);
    expect(isClueSealed(def.clues[0])).toBe(false);
    expect(def.clues[0].text).toBe(CASE_VARIANTS.poisoned_archive.barry.clues[first]!.text);
    expect(CASES.poisoned_archive.clues[0].text).toBe(CLUE_SEALED_TEXT);
    // a second reveal of the same clue is a no-op
    expect(revealClues(def, { [first]: CASE_VARIANTS.poisoned_archive.galpin.clues[first]! })).toEqual([]);
  });

  it('suspect order is seeded (same seed → same order) and every order occurs across seeds', () => {
    expect(suspectOrder(CASES.crypt_last_witness, 's1')).toEqual(suspectOrder(CASES.crypt_last_witness, 's1'));
    const orders = new Set<string>();
    const firsts = new Map<SuspectId, number>();
    for (let i = 0; i < 600; i++) {
      const o = suspectOrder(CASES.crypt_last_witness, `order-${i}`);
      expect([...o].sort()).toEqual([...SUSPECT_IDS].sort());
      orders.add(o.join(','));
      firsts.set(o[0], (firsts.get(o[0]) ?? 0) + 1);
    }
    expect(orders.size).toBe(6);
    for (const s of SUSPECT_IDS) expect(firsts.get(s)! / 600).toBeGreaterThan(0.25);
    const def = sessionCaseDef(CASES.crypt_last_witness, 'order-1');
    expect(def.suspects.map((s) => s.id)).toEqual(suspectOrder(CASES.crypt_last_witness, 'order-1'));
  });
});

describe('provisional verdict from the READ clues (LIVE accusation before the server verdict)', () => {
  const id = 'midnight_signal';
  for (const murderer of SUSPECT_IDS) {
    it(`murderer ${murderer}: one read clue already rules out a suspect it does not name`, () => {
      const def = sessionCaseDef(CASES[id], 'prov');
      const v = CASE_VARIANTS[id][murderer];
      const onlyOne = def.clues.find((c) => v.clues[c.id]!.mentions.length === 1)!; // the clue naming only the murderer
      revealClues(def, { [onlyOne.id]: v.clues[onlyOne.id]! });
      expect(provisionalCulprit(def, [onlyOne.id], murderer)).toBe(murderer);
      for (const s of SUSPECT_IDS.filter((x) => x !== murderer)) expect(provisionalCulprit(def, [onlyOne.id], s)).toBe(murderer);
    });
  }

  it('a sealed (not yet read) clue gives no information', () => {
    const def = sessionCaseDef(CASES[id], 'prov');
    const c = provisionalCulprit(def, def.clues.map((x) => x.id), 'barry');
    expect(c).not.toBe('barry'); // undecided → the accused is provisionally judged wrong
  });
});

describe('headless episodes', () => {
  it('draw every murderer from the seed, deterministically', () => {
    const seen = new Set<SuspectId>();
    for (let i = 0; i < 60; i++) seen.add(episodeCulprit(`ep-${i}`));
    expect([...seen].sort()).toEqual([...SUSPECT_IDS].sort());
    expect(episodeCulprit('fixed')).toBe(episodeCulprit('fixed'));
    const k = episodeCase('fixed', CASES.crypt_last_witness);
    expect(k.solution.culprit).toBe(episodeCulprit('fixed'));
    expect(k.caseDef.clues.some(isClueSealed)).toBe(false);
  });
});
