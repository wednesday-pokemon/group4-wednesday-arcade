// mystery-v4 scoring (FINAL_CONTRACT §1): scoreV4(parts) is pure and shared with the server; every component is
// tracked in the breakdown and the total is clamped at 0. compareResults keeps finishers above DNFs.
import { describe, expect, it } from 'vitest';
import { MYSTERY_TUNING } from '../../../src/mystery/data/tuning.ts';
import { compareResults, scoreV4, SCORE_V4 } from '../../../src/mystery/scoring.ts';

const base = { delivered: true, correct: true, cluesFound: 3, detections: 0, hintsUsed: 0, hits: 0, activeTimeS: 120.4 };

describe('scoreV4', () => {
  it('a perfect run: 1000 + 300 + 300 + 150 + 150 + (300 − 120)', () => {
    const b = scoreV4(base);
    expect(b).toEqual({
      delivery: 1000, accusation: 300, clues: 300, noDetection: 150, noHints: 150, timeBonus: 180, hintPenalty: 0, hitPenalty: 0,
      total: 2080,
    });
  });

  it('clues are capped at 3; a wrong culprit gets no accusation bonus', () => {
    expect(scoreV4({ ...base, cluesFound: 5 }).clues).toBe(300);
    expect(scoreV4({ ...base, cluesFound: 1 }).clues).toBe(100);
    expect(scoreV4({ ...base, correct: false }).accusation).toBe(0);
  });

  it('detections remove the no-detection bonus; hints cost 50 each and remove the no-hint bonus; hits cost 75 each', () => {
    const b = scoreV4({ ...base, detections: 2, hintsUsed: 3, hits: 2 });
    expect(b.noDetection).toBe(0);
    expect(b.noHints).toBe(0);
    expect(b.hintPenalty).toBe(-150);
    expect(b.hitPenalty).toBe(-150);
    expect(b.total).toBe(1000 + 300 + 300 + 0 + 0 + 180 - 150 - 150);
  });

  it('time bonus = max(0, 300 − floor(activeTimeS))', () => {
    expect(scoreV4({ ...base, activeTimeS: 0 }).timeBonus).toBe(300);
    expect(scoreV4({ ...base, activeTimeS: 299.9 }).timeBonus).toBe(1);
    expect(scoreV4({ ...base, activeTimeS: 300 }).timeBonus).toBe(0);
    expect(scoreV4({ ...base, activeTimeS: 999 }).timeBonus).toBe(0);
  });

  it('the total is clamped at 0 and every part is an integer', () => {
    const b = scoreV4({ delivered: false, correct: false, cluesFound: 0, detections: 9, hintsUsed: 20, hits: 20, activeTimeS: 600 });
    expect(b.total).toBe(0);
    for (const v of Object.values(b)) expect(Number.isInteger(v)).toBe(true);
    // negative / non-finite inputs are treated as 0 (never a bonus)
    const odd = scoreV4({ ...base, hintsUsed: -2, hits: Number.NaN, cluesFound: -1, activeTimeS: Number.NaN });
    expect(odd.hintPenalty).toBe(0);
    expect(odd.hitPenalty).toBe(0);
    expect(odd.clues).toBe(0);
    expect(odd.timeBonus).toBe(0);
  });

  it('the designer tuning `scoring` block matches the shared constants (one source of numbers)', () => {
    const t = (MYSTERY_TUNING as unknown as { scoring: Record<string, number> }).scoring;
    expect({
      delivery: t.delivery, accusation: t.accusation, perClue: t.perClue, maxClues: t.maxClues, noDetection: t.noDetection,
      noHints: t.noHints, timeBonusS: t.timeBonusMax, perHint: t.hintPenalty, perHit: t.hitPenalty,
    }).toEqual({ ...SCORE_V4 });
  });

  it('exports the contract constants', () => {
    expect(SCORE_V4).toMatchObject({ delivery: 1000, accusation: 300, perClue: 100, maxClues: 3, noDetection: 150, noHints: 150, timeBonusS: 300, perHint: 50, perHit: 75 });
  });
});

describe('compareResults (unchanged ordering)', () => {
  it('finishers (score desc, then time asc) above every DNF', () => {
    const rows = [
      { outcome: 'dnf' as const, score: null, activeTimeS: 200 },
      { outcome: 'finished' as const, score: 100, activeTimeS: 90 },
      { outcome: 'finished' as const, score: 1900, activeTimeS: 150 },
      { outcome: 'finished' as const, score: 1900, activeTimeS: 140 },
    ].sort(compareResults);
    expect(rows.map((r) => [r.outcome, r.score, r.activeTimeS])).toEqual([
      ['finished', 1900, 140], ['finished', 1900, 150], ['finished', 100, 90], ['dnf', null, 200],
    ]);
  });
});
