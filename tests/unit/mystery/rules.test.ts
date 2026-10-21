import { describe, expect, it } from 'vitest';
import { suspectLinks, verdictFor } from '../../../src/mystery/caseLogic.ts';
import { SILENT_EVIDENCE } from '../../../src/mystery/data/case.ts';
import { compareResults, round1, scoreFor, type RankEntry } from '../../../src/mystery/scoring.ts';
import type { ClueId, SuspectId } from '../../../src/mystery/types.ts';

const CLUES: ClueId[] = ['transfer_note', 'master_key', 'greenhouse_trace'];
const SUSPECTS: SuspectId[] = ['thornhill', 'isaac', 'barry'];

function subsets<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let m = 0; m < 1 << xs.length; m++) out.push(xs.filter((_, i) => m & (1 << i)));
  return out;
}

describe('verdict truth table (8 clue subsets × 3 suspects + no accusation)', () => {
  for (const found of subsets(CLUES)) {
    for (const s of SUSPECTS) {
      const expected = found.length === 3 && s === 'thornhill' ? 'case_solved' : 'egg_secured_mystery_unsolved';
      it(`${found.join('+') || 'none'} → accuse ${s} = ${expected}`, () => {
        expect(verdictFor(SILENT_EVIDENCE, found, s)).toBe(expected);
        // order of discovery never matters, and repeated evaluation never changes (no randomness)
        expect(verdictFor(SILENT_EVIDENCE, [...found].reverse(), s)).toBe(expected);
      });
    }
    it(`${found.join('+') || 'none'} → leave unsolved = not_accused`, () => {
      expect(verdictFor(SILENT_EVIDENCE, found, null)).toBe('not_accused');
    });
  }

  it('the culprit is fixed and every clue implicates only them; no single clue clears both innocents', () => {
    expect(SILENT_EVIDENCE.culprit).toBe('thornhill');
    for (const c of SILENT_EVIDENCE.clues) {
      expect(c.implicates).toEqual(['thornhill']);
      expect(c.exonerates.length).toBeLessThanOrEqual(1);
    }
    const all = suspectLinks(SILENT_EVIDENCE, CLUES);
    expect(all.thornhill.implicated).toBe(3);
    expect(all.isaac.exonerated + all.barry.exonerated).toBe(2);
  });
});

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
