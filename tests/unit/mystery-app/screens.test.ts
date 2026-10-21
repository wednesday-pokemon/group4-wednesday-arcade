// Pure view logic behind the duo cards, evidence board and results (UX_MYSTERY §2, §5, §6).
import { describe, expect, it } from 'vitest';
import { linksFor } from '../../../src/ui/mystery/EvidenceBoard.tsx';
import { fmtScore, verdictView } from '../../../src/ui/mystery/MysteryResults.tsx';
import { MAX_ADVANTAGES, MAX_DISADVANTAGES, offerViews, STAT_ROWS } from '../../../src/ui/mystery/duoView.ts';
import { SILENT_EVIDENCE } from '../../../src/mystery/data/case.ts';
import { allPairs, buildCard, draftOffer } from '../../../src/mystery/draft.ts';
import type { RunResult } from '../../../src/mystery/types.ts';

const result = (over: Partial<RunResult> = {}): RunResult => ({
  rulesVersion: 'mystery-v3.1', outcome: 'finished', dnfReason: null, verdict: 'case_solved', accused: SILENT_EVIDENCE.culprit, correct: true,
  cluesFound: ['transfer_note', 'master_key', 'greenhouse_trace'], eggTier: 'rare', eggPoints: 3, eggSecurity: 80, activeTimeS: 214.3,
  score: 85.7, catches: 0, hp: 100, duo: { characterId: 'enid', pokemonId: 'gengar' }, ...over,
});

const culpritName = SILENT_EVIDENCE.suspects.find((s) => s.id === SILENT_EVIDENCE.culprit)!.name;
const innocent = SILENT_EVIDENCE.suspects.find((s) => s.id !== SILENT_EVIDENCE.culprit)!;

describe('card copy budgets over all 126 pairs (UX §2)', () => {
  it('duo name ≤ 22, trade-offs ≤ 46 chars, 2 advantages + 1–2 disadvantages shown, F/Q text ≤ 90', () => {
    const pairs = allPairs();
    expect(pairs).toHaveLength(126);
    for (const d of pairs) {
      const card = buildCard(d);
      const [v] = offerViews([card, card, card], 'draft');
      expect(card.duoName.length).toBeLessThanOrEqual(22);
      expect(v!.advantages.length).toBe(MAX_ADVANTAGES);
      expect(v!.disadvantages.length).toBeGreaterThanOrEqual(1);
      expect(v!.disadvantages.length).toBeLessThanOrEqual(MAX_DISADVANTAGES);
      for (const t of [...v!.advantages, ...v!.disadvantages]) expect(t.length).toBeLessThanOrEqual(46);
      expect(v!.power.text!.length).toBeLessThanOrEqual(90);
      expect(v!.move.text!.length).toBeLessThanOrEqual(90);
    }
  });
});

describe('best-of-three marks', () => {
  it('marks the max of each stat unless all three are equal; values stay absolute', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const offer = draftOffer(seed);
      const views = offerViews(offer.cards, 'draft');
      for (const { key } of STAT_ROWS) {
        const vals = offer.cards.map((c) => c.stats[key]);
        const max = Math.max(...vals);
        views.forEach((v, i) => {
          const expected = vals.some((x) => x !== max) && vals[i] === max;
          expect(v.best.includes(key)).toBe(expected);
          expect(v.stats![key]).toBe(offer.cards[i]!.stats[key]);
        });
      }
    }
  });
});

describe('evidence board links (only from found clues)', () => {
  it('no links before any clue; links appear only for found clues', () => {
    for (const s of SILENT_EVIDENCE.suspects) {
      const l = linksFor(SILENT_EVIDENCE, [], s.id);
      expect(l.points.length + l.explains.length).toBe(0);
    }
    const one = SILENT_EVIDENCE.clues[0]!;
    for (const s of SILENT_EVIDENCE.suspects) {
      const l = linksFor(SILENT_EVIDENCE, [one.id], s.id);
      expect(l.points.map((c) => c.id)).toEqual(one.implicates.includes(s.id) ? [one.id] : []);
      expect(l.explains.map((c) => c.id)).toEqual(one.exonerates.includes(s.id) ? [one.id] : []);
    }
  });
  it('all clues found: the culprit is linked by every clue (logically deducible)', () => {
    const all = SILENT_EVIDENCE.clues.map((c) => c.id);
    expect(linksFor(SILENT_EVIDENCE, all, SILENT_EVIDENCE.culprit).points).toHaveLength(SILENT_EVIDENCE.clues.length);
  });
});

describe('results verdict copy (UX §6)', () => {
  it('Case Solved names the culprit', () => {
    const v = verdictView(result(), SILENT_EVIDENCE);
    expect(v.title).toBe('Case Solved');
    expect(v.sub).toContain(culpritName);
  });
  it('wrong accusation never reveals the culprit', () => {
    const v = verdictView(result({ verdict: 'egg_secured_mystery_unsolved', accused: innocent.id, correct: false, cluesFound: ['master_key', 'transfer_note'] }), SILENT_EVIDENCE);
    expect(v.title).toBe('Egg Secured, Mystery Unsolved');
    expect(v.sub).toContain(innocent.name);
    expect(v.sub).toContain('2 of 3');
    expect(v.sub).not.toContain(culpritName);
  });
  it('right suspect with missing clues reads exactly like a wrong one (no leak)', () => {
    const right = verdictView(result({ verdict: 'egg_secured_mystery_unsolved', cluesFound: ['master_key'] }), SILENT_EVIDENCE);
    const wrong = verdictView(result({ verdict: 'egg_secured_mystery_unsolved', accused: innocent.id, correct: false, cluesFound: ['master_key'] }), SILENT_EVIDENCE);
    expect(right.sub.replace(culpritName, 'X')).toBe(wrong.sub.replace(innocent.name, 'X'));
  });
  it('leave unsolved → not_accused, shown as Egg Secured, Mystery Unsolved', () => {
    const v = verdictView(result({ verdict: 'not_accused', accused: null, correct: false }), SILENT_EVIDENCE);
    expect(v.title).toBe('Egg Secured, Mystery Unsolved');
    expect(v.sub).toContain('left the case unsolved');
  });
  it('DNF: unranked, no culprit', () => {
    const v = verdictView(result({ outcome: 'dnf', dnfReason: 'second_catch', verdict: 'not_accused', accused: null, score: null }), SILENT_EVIDENCE);
    expect(v.title).toBe('Dragged into the fog');
    expect(v.extra).toContain('Unranked');
    expect(v.sub).not.toContain(culpritName);
  });
  it('scores use a true minus sign', () => {
    expect(fmtScore(85.66)).toBe('85.7');
    expect(fmtScore(-12.34)).toBe('−12.3');
  });
});
