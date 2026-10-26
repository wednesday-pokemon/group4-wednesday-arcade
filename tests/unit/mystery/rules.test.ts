import { describe, expect, it } from 'vitest';
import {
  citableEvidence, evidenceSupports, mentionCounts, sanitizeEvidence, solutionMatches, suspectLinks, verdictFor,
} from '../../../src/mystery/caseLogic.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { CASE_SOLUTIONS } from '../../../src/mystery/data/solutions.ts';
import { compareResults, round1, scoreFor, type RankEntry } from '../../../src/mystery/scoring.ts';
import { CASE_IDS, SUSPECT_IDS, type ClueId, type Verdict } from '../../../src/mystery/types.ts';

function subsets<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let m = 0; m < 1 << xs.length; m++) out.push(xs.filter((_, i) => m & (1 << i)));
  return out;
}

for (const caseId of CASE_IDS) {
  const def = CASES[caseId];
  const sol = CASE_SOLUTIONS[caseId];
  const clues = def.clues.map((c) => c.id);
  const notes = def.notes.map((n) => n.id);
  // evidence variants a visitor can cite; only `exact` (any order, duplicates ignored) supports the culprit
  const evidenceVariants: [string, string[], boolean][] = [
    ['exact', [...sol.supportingEvidence], true],
    ['exact reversed + duplicate', [...sol.supportingEvidence].reverse().concat(sol.supportingEvidence[0]), true],
    ['missing one', sol.supportingEvidence.slice(1), false],
    ['exact + a note', [...sol.supportingEvidence, notes[0]], false],
    ['notes only', [...notes], false],
    ['none', [], false],
  ];

  describe(`${def.number} ${def.title}: verdict truth table (8 clue subsets × 3 suspects × 6 evidence sets + no accusation)`, () => {
    for (const found of subsets(clues)) {
      const label = found.join('+') || 'none';
      it(`${label} found`, () => {
        for (const s of SUSPECT_IDS) {
          for (const [, evidence, supports] of evidenceVariants) {
            const expected: Verdict = found.length === 3 && s === sol.culprit && supports ? 'case_solved' : 'egg_secured_mystery_unsolved';
            const acc = { suspectId: s, evidence };
            expect(verdictFor(def, sol, found, acc), `${s} citing ${evidence.join(',')}`).toBe(expected);
            // order of discovery never matters, and repeated evaluation never changes (no randomness)
            expect(verdictFor(def, sol, [...found].reverse(), acc)).toBe(expected);
          }
          expect(verdictFor(def, sol, found, { suspectId: null, evidence: [...sol.supportingEvidence] })).toBe('not_accused');
        }
      });
    }

    it('evidenceSupports: exactly the supporting set, order/duplicates ignored', () => {
      for (const [name, evidence, supports] of evidenceVariants) expect(evidenceSupports(sol, evidence), name).toBe(supports);
    });

    it('citable / sanitised evidence: found clues + case notes only, unknown and unfound ids dropped', () => {
      const found: ClueId[] = [clues[1]];
      expect(citableEvidence(def, found)).toEqual([clues[1], ...notes]);
      expect(sanitizeEvidence(def, found, [clues[0], clues[1], clues[1], 'bogus', notes[1], 'transfer_note'])).toEqual([clues[1], notes[1]]);
      expect(sanitizeEvidence(def, clues, [...clues].reverse())).toEqual([...clues].reverse());
      // another case's clue is never citable here
      const foreign = CASE_IDS.filter((c) => c !== caseId).flatMap((c) => CASES[c].clues.map((x) => x.id));
      expect(sanitizeEvidence(def, clues, foreign)).toEqual([]);
    });

    it('solutionMatches: same id AND version only', () => {
      expect(solutionMatches(def, sol)).toBe(true);
      expect(solutionMatches(def, { ...sol, version: sol.version + 1 })).toBe(false);
      for (const other of CASE_IDS.filter((c) => c !== caseId)) expect(solutionMatches(def, CASE_SOLUTIONS[other])).toBe(false);
    });

    it('all three clues implicate the culprit and clear both innocents; no single clue clears both', () => {
      const all = suspectLinks(def, sol, clues);
      expect(all[sol.culprit]).toEqual({ implicated: 3, exonerated: 0 });
      for (const s of SUSPECT_IDS.filter((x) => x !== sol.culprit)) expect(all[s]).toEqual({ implicated: 0, exonerated: 1 });
      for (const c of clues) expect(sol.links[c].clears.length).toBeLessThanOrEqual(1);
      // with only two clues the method / opportunity / alibi chain is always incomplete
      for (const pair of subsets(clues).filter((x) => x.length === 2)) {
        expect(new Set(pair.map((c) => sol.links[c].proves)).size, pair.join('+')).toBe(2);
        expect(suspectLinks(def, sol, pair)[sol.culprit].implicated).toBe(2);
      }
    });

    it('mentionCounts (answer-free): the culprit leads only once every clue is in', () => {
      const all = mentionCounts(def, clues);
      expect(all[sol.culprit]).toBe(3);
      for (const s of SUSPECT_IDS.filter((x) => x !== sol.culprit)) expect(all[s]).toBe(1);
      expect(mentionCounts(def, [])).toEqual({ thornhill: 0, galpin: 0, barry: 0 });
    });
  });
}

describe('scoring', () => {
  it('round1 rounds half away from zero, robust to float error', () => {
    expect(round1(0.05)).toBe(0.1);
    expect(round1(1.25)).toBe(1.3);
    expect(round1(-2.25)).toBe(-2.3);
    expect(round1(123.44999)).toBe(123.4);
    expect(Object.is(round1(-0.04), -0)).toBe(false);
  });

  it('score = round1(points × 100 − activeTimeS), negative allowed', () => {
    expect(scoreFor(3, 200)).toBe(100);
    expect(scoreFor(1, 200.04)).toBe(-100);
    expect(scoreFor(6, 245.36)).toBe(354.6);
    expect(scoreFor(1, 431.2)).toBe(-331.2);
  });

  it('ranking: finishers by score desc then time asc, ALL above DNFs (even negative scores)', () => {
    const rows: (RankEntry & { id: string })[] = [
      { id: 'dnf-long', outcome: 'dnf', score: null, activeTimeS: 300 },
      { id: 'neg', outcome: 'finished', score: -150.5, activeTimeS: 250.5 },
      { id: 'top', outcome: 'finished', score: 400, activeTimeS: 200 },
      { id: 'dnf-short', outcome: 'dnf', score: null, activeTimeS: 40 },
      { id: 'tie-fast', outcome: 'finished', score: 100, activeTimeS: 200 },
      { id: 'tie-slow', outcome: 'finished', score: 100, activeTimeS: 500 },
    ];
    expect([...rows].sort(compareResults).map((r) => r.id)).toEqual(['top', 'tie-fast', 'tie-slow', 'neg', 'dnf-long', 'dnf-short']);
  });
});
