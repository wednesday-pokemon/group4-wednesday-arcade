// Pure view logic behind the duo cards, evidence board and results (UX_MYSTERY §2, §5, §6; docs/MYSTERY_CASES.md).
// Tests may import the answer keys (data/solutions.ts); the UI modules under test never do.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EvidenceBoard, evidenceOptions, mentionedNames, shortRole } from '../../../src/ui/mystery/EvidenceBoard.tsx';
import { caseTruthView, fmtScore, verdictView } from '../../../src/ui/mystery/MysteryResults.tsx';
import { MAX_ADVANTAGES, MAX_DISADVANTAGES, offerViews, STAT_ROWS } from '../../../src/ui/mystery/duoView.ts';
import { CASES, ROOM_LABELS } from '../../../src/mystery/data/cases.ts';
import { CASE_VARIANTS } from '../../../src/mystery/data/solutions.ts';
import { withClueContent } from '../../../src/mystery/caseVariant.ts';
import { FIXED_SOLUTIONS as CASE_SOLUTIONS } from '../mystery/fixedSolutions.ts';
import { allPairs, buildCard, draftOffer } from '../../../src/mystery/draft.ts';
import type { CaseDef, CaseSolution, ClueId, RunResult } from '../../../src/mystery/types.ts';

const ALL_CASES = Object.values(CASES);
const solutionOf = (c: CaseDef): CaseSolution => CASE_SOLUTIONS[c.id];
const nameOf = (c: CaseDef, id: string) => c.suspects.find((s) => s.id === id)!.name;
const allClues = (c: CaseDef): ClueId[] => c.clues.map((x) => x.id);

const result = (c: CaseDef, over: Partial<RunResult> = {}): RunResult => ({
  rulesVersion: 'mystery-v3.1', caseId: c.id, caseVersion: c.version, outcome: 'finished', dnfReason: null, verdict: 'case_solved',
  accused: solutionOf(c).culprit, correct: true, evidence: [...solutionOf(c).supportingEvidence], deductionCorrect: true,
  cluesFound: allClues(c), eggTier: 'rare', eggPoints: 3, eggSecurity: 80, activeTimeS: 214.3,
  score: 85.7, catches: 0, hp: 100, duo: { characterId: 'enid', pokemonId: 'gengar' }, ...over,
});

/** renderToStaticMarkup escapes quotes and apostrophes in text. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const board = (c: CaseDef, found: readonly ClueId[], mode: 'review' | 'accuse') =>
  renderToStaticMarkup(createElement(EvidenceBoard, {
    caseDef: c, cluesFound: found, roomName: (id) => ROOM_LABELS[id], mode, onClose: () => undefined, onAccuse: () => undefined,
  }));

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

describe('evidence board (public data only)', () => {
  it.each(ALL_CASES.map((c) => [c.id, c] as const))('%s: citable options = found clues in case order, then the two notes', (_id, c) => {
    expect(evidenceOptions(c, []).map((o) => o.id)).toEqual(c.notes.map((n) => n.id));
    const [a, b, d] = c.clues;
    expect(evidenceOptions(c, [d!.id, a!.id]).map((o) => o.id)).toEqual([a!.id, d!.id, ...c.notes.map((n) => n.id)]);
    expect(evidenceOptions(c, [b!.id])[0]).toEqual({ id: b!.id, kind: 'clue', title: b!.title });
    expect(evidenceOptions(c, allClues(c)).filter((o) => o.kind === 'note')).toHaveLength(2);
  });

  it.each(ALL_CASES.map((c) => [c.id, c] as const))('%s: "Names:" lists who the clue text mentions, in suspect order', (_id, c) => {
    for (const clue of c.clues) {
      const names = mentionedNames(c, clue);
      expect(names).toHaveLength(clue.mentions.length);
      for (const n of names) expect(c.suspects.some((s) => s.name === n)).toBe(true);
    }
  });

  it.each(ALL_CASES.map((c) => [c.id, c] as const))('%s: no guilt links, no answer text, identical suspect cards', (_id, c) => {
    const sol = solutionOf(c);
    for (const mode of ['review', 'accuse'] as const) {
      for (const found of [[], allClues(c)]) {
        const html = board(c, found, mode);
        expect(html).not.toMatch(/Points to|Explains|Linked by|Explained by|Contradiction|pin--|thread/);
        expect(html).not.toContain(esc(sol.resolution));
        for (const why of Object.values(sol.innocents)) expect(html).not.toContain(esc(why!));
        expect(html).not.toContain(`data-culprit`);
        // Every suspect card has exactly the same classes and structure (only the text differs).
        const cards = [...html.matchAll(/<li class="suspect" data-testid="suspect-(\w+)">(.*?)<\/li>/g)];
        expect(cards.map((m) => m[1])).toEqual(c.suspects.map((s) => s.id));
        const shape = (s: string) => s.replace(/>[^<]*</g, '><');
        expect(new Set(cards.map((m) => shape(m[2]!))).size).toBe(1);
      }
    }
  });

  it('shows case number, title, victim, statements, notes; locked clues show only where to search', () => {
    // the run's case as the visitor holds it: every clue's text read (the board must still show only the found one)
    const c = withClueContent(CASES.poisoned_archive, CASE_VARIANTS.poisoned_archive.barry.clues);
    const html = board(c, [c.clues[0]!.id], 'review');
    expect(html).toContain(`Case ${c.number} · ${c.title}`);
    expect(html).toContain(`Victim: ${c.victim}`);
    expect(html).toContain('1 of 3 clues found');
    expect(html).toContain('Case-file notes');
    for (const s of c.suspects) expect(html).toContain(esc(s.alibiOrContext));
    for (const n of c.notes) expect(html).toContain(esc(n.text));
    expect(html).toContain(esc(c.clues[0]!.text));
    expect(html).toContain(esc(c.clues[0]!.deduction));
    for (const locked of c.clues.slice(1)) {
      expect(html).toContain(`data-testid="clue-${locked.id}" data-found="false"`); // overhaul: "Search: <areas>" (overhaulB_investigation.test.ts)
      expect(html).not.toContain(esc(locked.text));
      expect(html).not.toContain(esc(locked.title));
    }
    expect(html).toContain('data-testid="btn-board-close"');
    expect(html).not.toContain('(role in this story)'); // the board footnote covers it
    expect(shortRole('Archivist (role in this story)')).toBe('Archivist');
  });

  it('accuse mode: step 1 radiogroup + Accuse + Leave unsolved; no close button', () => {
    const c = CASES.midnight_signal;
    const html = board(c, allClues(c), 'accuse');
    expect(html).toContain('data-testid="accuse-panel"');
    expect(html).toContain('data-step="suspect"');
    for (const s of c.suspects) expect(html).toContain(`data-testid="radio-${s.id}"`);
    expect(html).toContain('data-testid="btn-accuse"');
    expect(html).toContain('data-testid="btn-leave-unsolved"');
    expect(html).not.toContain('data-testid="btn-board-close"');
  });
});

describe('results verdict copy (UX §6)', () => {
  it.each(ALL_CASES.map((c) => [c.id, c] as const))('%s: Case Solved names the culprit, every clue held', (_id, c) => {
    const v = verdictView(result(c), c, solutionOf(c));
    expect(v.title).toBe('Case Solved');
    expect(v.sub).toContain(nameOf(c, solutionOf(c).culprit));
    expect(v.sub).toContain('Every clue held.');
    // Works before the answer key arrives, too (the accused IS the culprit on a solved case).
    expect(verdictView(result(c), c, null).sub).toBe(v.sub);
  });

  it.each(ALL_CASES.map((c) => [c.id, c] as const))('%s: right suspect, wrong evidence → told honestly', (_id, c) => {
    const notes = c.notes.map((n) => n.id);
    const r = result(c, { verdict: 'egg_secured_mystery_unsolved', evidence: [c.clues[0]!.id, ...notes], deductionCorrect: false });
    const v = verdictView(r, c, solutionOf(c));
    expect(v.title).toBe('Egg Secured, Mystery Unsolved');
    expect(v.sub).toContain('Right suspect — but the evidence you cited doesn’t prove it');
    expect(v.sub).toContain(`3 of ${c.clues.length} clues found`);
    // missing clues: same honesty, plus why
    const missing = verdictView({ ...r, cluesFound: [c.clues[0]!.id] }, c, solutionOf(c));
    expect(missing.sub).toContain('Right suspect');
    expect(missing.sub).toContain(`1 of ${c.clues.length}`);
    expect(missing.extra).toContain(`all ${c.clues.length} clues`);
    expect(v.extra).toBeNull();
    // without the key, r.correct decides
    expect(verdictView(r, c, null).sub).toBe(v.sub);
  });

  it.each(ALL_CASES.map((c) => [c.id, c] as const))('%s: wrong suspect → names only the accused', (_id, c) => {
    const sol = solutionOf(c);
    const innocent = c.suspects.find((s) => s.id !== sol.culprit)!;
    const v = verdictView(result(c, { verdict: 'egg_secured_mystery_unsolved', accused: innocent.id, correct: false, deductionCorrect: false, cluesFound: allClues(c).slice(0, 2) }), c, sol);
    expect(v.title).toBe('Egg Secured, Mystery Unsolved');
    expect(v.sub).toContain(innocent.name);
    expect(v.sub).toContain(`2 of ${c.clues.length}`);
    expect(v.sub).not.toContain(nameOf(c, sol.culprit));
    expect(v.sub).not.toContain('Right suspect');
  });

  it('a stale answer key (other case / version) is ignored', () => {
    const c = CASES.crypt_last_witness;
    const wrongKey = CASE_SOLUTIONS.poisoned_archive; // culprit thornhill
    const r = result(c, { verdict: 'egg_secured_mystery_unsolved', accused: 'thornhill', correct: false, deductionCorrect: false });
    expect(verdictView(r, c, wrongKey).sub).toContain('You accused Marilyn Thornhill');
    expect(caseTruthView(c, wrongKey)).toBeNull();
    expect(caseTruthView(c, { ...solutionOf(c), version: c.version + 1 })).toBeNull();
  });

  it('leave unsolved → not_accused, shown as Egg Secured, Mystery Unsolved', () => {
    const c = CASES.poisoned_archive;
    const v = verdictView(result(c, { verdict: 'not_accused', accused: null, correct: false, evidence: [], deductionCorrect: false }), c, solutionOf(c));
    expect(v.title).toBe('Egg Secured, Mystery Unsolved');
    expect(v.sub).toContain('left the case unsolved');
    expect(v.sub).toContain(`of ${c.clues.length} clues`);
  });

  it('DNF: unranked, no culprit', () => {
    const c = CASES.midnight_signal;
    const v = verdictView(result(c, { outcome: 'dnf', dnfReason: 'second_catch', verdict: 'not_accused', accused: null, score: null }), c, solutionOf(c));
    expect(v.title).toBe('Dragged into the fog');
    expect(v.extra).toContain('Unranked');
    expect(v.sub).not.toContain(nameOf(c, solutionOf(c).culprit));
  });

  it('scores use a true minus sign', () => {
    expect(fmtScore(85.66)).toBe('85.7');
    expect(fmtScore(-12.34)).toBe('−12.3');
  });
});

describe('results: what really happened (post-accusation only)', () => {
  it.each(ALL_CASES.map((c) => [c.id, c] as const))('%s: resolution, both innocents explained, proof = the three clues', (_id, c) => {
    const sol = solutionOf(c);
    const t = caseTruthView(c, sol)!;
    expect(t.culprit).toBe(nameOf(c, sol.culprit));
    expect(t.resolution).toBe(sol.resolution);
    expect(t.innocents.map((i) => i.id)).toEqual(c.suspects.filter((s) => s.id !== sol.culprit).map((s) => s.id));
    for (const i of t.innocents) expect(i.why).toBe(sol.innocents[i.id]);
    expect(t.proof).toEqual(sol.supportingEvidence.map((id) => c.clues.find((x) => x.id === id)!.title));
  });
  it('null while the answer key is loading', () => {
    expect(caseTruthView(CASES.poisoned_archive, null)).toBeNull();
  });
});
