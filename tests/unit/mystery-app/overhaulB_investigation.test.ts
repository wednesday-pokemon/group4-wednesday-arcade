// Frontend B — Tab "Investigation" overlay + accusation (docs/overhaul/UX_OVERHAUL.md §4, §7; rulings R2, R3).
// Pure view-model + static markup: secrecy (locked slots name candidate AREAS, never the drawn site), TL;DR copy guard,
// the odds display rules (5 % largest remainder, facts as words, bands, exact source labels) and the R3 gate.
import { caseWorld } from '../../../src/mystery/data/caseWorlds.ts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LiveForecasts } from '../../../src/mystery/analytics/types.ts';
import { CASES, ROOM_LABELS } from '../../../src/mystery/data/cases.ts';
import { FIXED_SOLUTIONS as CASE_SOLUTIONS } from '../mystery/fixedSolutions.ts';
import type { CaseDef, CaseWorldDef, ClueId, InvestigationState } from '../../../src/mystery/types.ts';
import { EvidenceBoard } from '../../../src/ui/mystery/EvidenceBoard.tsx';
import { hitTest, highlightId } from '../../../src/ui/mystery/InvestigationMap.tsx';
import {
  BANNED_CLUE_WORDS, canNameSuspect, evidenceSlots, firstSentence, oddsBlocks, type FoundSlot, type LockedSlot,
} from '../../../src/ui/mystery/investigationView.ts';

const ALL_CASES = Object.values(CASES);
const allClues = (c: CaseDef): ClueId[] => c.clues.map((x) => x.id);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const emptyInv = (): InvestigationState => ({
  checkedClueSites: [], knownClueSites: {}, checkedEggSites: [], eggSeenAt: null, traces: [], examined: [], passageOpen: false,
  hydeEmerged: false, hydeEmergedAt: null, hydeEmergesInS: 20, lastHydeSighting: null,
});

/** A synthetic world for case 01 with real uncertainty: two candidate sites in different areas for two clues. */
function testWorld(): CaseWorldDef {
  const c = CASES.poisoned_archive;
  const [a, b, d] = c.clues.map((x) => x.id) as [ClueId, ClueId, ClueId];
  const site = (id: string, areaId: string, prior: number) => ({ id, areaId, roomId: 'path' as const, x: 0, z: 0, prior, label: `Spot ${id}`, prop: 'desk' as const });
  return {
    caseId: c.id, theme: 'archive', traceAccuracy: 0.75,
    areas: [
      { id: 'a1', name: 'Research Archive', x: 30, z: 0, radiusM: 9 },
      { id: 'a2', name: 'Greenhouse Annex', x: 0, z: -24, radiusM: 9 },
      { id: 'a3', name: 'Records Crypt', x: -24, z: 14, radiusM: 9 },
    ],
    clueSites: [
      { clueId: a, searchS: 2, sites: [site('s_a1', 'a1', 0.6), site('s_a2', 'a2', 0.4)] },
      { clueId: b, searchS: 2, sites: [site('s_b2', 'a2', 0.5), site('s_b3', 'a3', 0.5)] },
      { clueId: d, searchS: 2, sites: [site('s_d3', 'a3', 1)] },
    ],
    eggSites: [
      { ...site('e1', 'a1', 0.5), traceText: 'Straw toward the archive.' },
      { ...site('e2', 'a2', 0.3), traceText: 'Straw toward the annex.' },
      { ...site('e3', 'a3', 0.2), traceText: 'Straw toward the crypt.' },
    ],
    hydeSpawns: [], zones: [], extraWalls: [], extraCover: [], extraHiding: [], passage: null, examines: [], hazards: [],
  };
}

const board = (c: CaseDef, found: readonly ClueId[], mode: 'review' | 'accuse', extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(EvidenceBoard, {
    caseDef: c, cluesFound: found, roomName: (id) => ROOM_LABELS[id], mode, onClose: () => undefined, onAccuse: () => undefined, ...extra,
  }));

describe('evidence slots', () => {
  it('found slots use the TL;DR line (short) + Meaning, else the first sentence + the neutral deduction', () => {
    for (const c of ALL_CASES) {
      const slots = evidenceSlots(c, allClues(c), null, null) as FoundSlot[];
      slots.forEach((s, i) => {
        const clue = c.clues[i]!;
        expect(s.kind).toBe('found');
        expect(s.short).toBe(clue.short?.trim() || firstSentence(clue.text));
        expect(s.short.length).toBeLessThanOrEqual(90);
        expect(s.meaning).toBe(clue.meaning?.trim() || clue.deduction);
        expect(s.mentions).toEqual(c.suspects.filter((x) => clue.mentions.includes(x.id)).map((x) => x.name));
      });
    }
  });

  it('locked slots name every unchecked candidate AREA (never singling out one site) and count the spots left', () => {
    const c = CASES.poisoned_archive;
    const w = testWorld();
    const [first] = evidenceSlots(c, [], w, emptyInv()) as LockedSlot[];
    expect(first!.search).toBe('Search: Research Archive, Greenhouse Annex · 2 spots left');
    expect(first!.areaIds).toEqual(['a1', 'a2']);
    // one candidate checked empty → only the other area remains
    const after = evidenceSlots(c, [], w, { ...emptyInv(), checkedClueSites: ['s_a1'] })[0] as LockedSlot;
    expect(after.search).toBe('Search: Greenhouse Annex · 1 spot left');
    // seen (not yet picked up): the spot is public now
    const seen = evidenceSlots(c, [], w, { ...emptyInv(), knownClueSites: { [c.clues[0]!.id]: 's_a2' } })[0] as LockedSlot;
    expect(seen.spotted).toBe(true);
    expect(seen.search).toBe('Spotted: Spot s_a2 · Greenhouse Annex');
    // without the player's observations the count is unknown: areas only
    expect((evidenceSlots(c, [], w, null)[0] as LockedSlot).search).toBe('Search: Research Archive, Greenhouse Annex');
    // without a world: the clue's own location
    expect((evidenceSlots(c, [], null, null)[1] as LockedSlot).search).toBe(`Search: ${c.clues[1]!.location}`);
  });

  it('the locked slot output does not depend on where the clue really is (no hidden-truth input exists)', () => {
    // evidenceSlots takes only public inputs: same observations → same text, whatever SessionLayout drew.
    const c = CASES.poisoned_archive;
    const a = JSON.stringify(evidenceSlots(c, [], testWorld(), emptyInv()));
    const b = JSON.stringify(evidenceSlots(c, [], testWorld(), emptyInv()));
    expect(a).toBe(b);
    expect(evidenceSlots.length).toBe(4);
  });

  it('copy guard: no culprit wording in any found slot / clue card copy (R2)', () => {
    for (const c of ALL_CASES) {
      for (const s of evidenceSlots(c, allClues(c), null, null) as FoundSlot[]) {
        for (const t of [s.title, s.short, s.meaning, ...s.mentions]) expect(t).not.toMatch(BANNED_CLUE_WORDS);
      }
      const html = board(c, allClues(c), 'review');
      const slotsHtml = html.slice(html.indexOf('inv-slots'), html.indexOf('inv-suspects'));
      expect(slotsHtml.length).toBeGreaterThan(100);
      expect(slotsHtml.replace(/<[^>]+>/g, ' ')).not.toMatch(BANNED_CLUE_WORDS);
      // the review overlay never asks the accusation question
      expect(html).not.toContain('Who released the Hyde?');
    }
  });
});

describe('the odds (display rules, UX §7)', () => {
  const forecasts = (over: Partial<LiveForecasts> = {}): LiveForecasts => ({
    detection: { p: 0.42, band: 'medium', source: 'rule', label: 'Rule-based risk estimate', topFactors: [] },
    extraction: { p: 0.83, source: 'ml', label: 'ML estimate' },
    egg: {
      label: 'Bayesian estimate', lastChange: { reason: 'Straw trace', t: 30 },
      sites: [
        { siteId: 'e1', areaId: 'a1', label: 'Potting shed', x: 0, z: 0, p: 0.8, prevP: 0.5, ruledOut: false },
        { siteId: 'e2', areaId: 'a2', label: 'Burial vault', x: 0, z: 0, p: 0.2, prevP: 0.3, ruledOut: false },
        { siteId: 'e3', areaId: 'a3', label: 'Bell tower', x: 0, z: 0, p: 0, prevP: 0.2, ruledOut: true },
      ],
    },
    clueAreas: { label: 'Bayesian estimate', areas: [
      { areaId: 'a1', name: 'Research Archive', x: 0, z: 0, radiusM: 9, p: 0.62 },
      { areaId: 'a2', name: 'Greenhouse Annex', x: 0, z: 0, radiusM: 9, p: 0.62 },
      { areaId: 'a3', name: 'Records Crypt', x: 0, z: 0, radiusM: 9, p: 0 },
    ] },
    hyde: { phase: 'active', label: 'Bayesian estimate', zones: [
      { zoneId: 'z1', name: 'Crypt', p: 0.333, polygon: [] },
      { zoneId: 'z2', name: 'Lawn', p: 0.333, polygon: [] },
      { zoneId: 'z3', name: 'Courtyard', p: 0.334, polygon: [] },
      { zoneId: 'z4', name: 'Pier', p: 0.0001, polygon: [] },
    ] },
    ...over,
  });
  const ctx = (f: LiveForecasts | null, found: ClueId[] = []) =>
    oddsBlocks({ forecasts: f, world: testWorld(), investigation: emptyInv(), cluesFound: found, clueTotal: 3, eggState: 'resting' });
  const sum = (vals: (number | null)[]) => vals.reduce<number>((s, v) => s + (v ?? 0), 0);

  it('distributions sum to exactly 100 in 5 % steps; tiny estimates read "<5%"; never 0 % or 100 %', () => {
    const [hyde, egg] = ctx(forecasts());
    expect(sum(hyde!.rows.map((r) => r.pct))).toBe(100);
    for (const r of hyde!.rows) expect((r.pct ?? 0) % 5).toBe(0);
    expect(hyde!.rows.find((r) => r.key === 'z4')!.value).toBe('<5%');
    expect(sum(egg!.rows.map((r) => r.pct))).toBe(100);
    for (const b of ctx(forecasts())) for (const r of b.rows) expect(r.value).not.toMatch(/^(0|100)%$/);
  });

  it('facts are words; the top row is marked; bands follow ≥ 60 likely · 30–55 maybe · ≤ 25 unlikely', () => {
    const egg = ctx(forecasts())[1]!;
    expect(egg.rows.map((r) => [r.name, r.value, r.bandText])).toEqual([
      ['Potting shed', '80%', 'likely'], ['Burial vault', '20%', 'unlikely'], ['Bell tower', 'Not here', null],
    ]);
    expect(egg.rows[0]!.top).toBe(true);
    expect(egg.history).toBe('50% → 80% · Straw trace');
    const seen = oddsBlocks({ forecasts: null, world: testWorld(), investigation: { ...emptyInv(), eggSeenAt: 'e2' }, cluesFound: [], clueTotal: 3, eggState: 'resting' })[1]!;
    expect(seen.rows.map((r) => r.value)).toEqual(['Seen', 'Not here', 'Not here']);
  });

  it('clue areas are independent: rounded one by one, only areas still holding a clue', () => {
    const clues = ctx(forecasts())[2]!;
    expect(clues.rows.map((r) => [r.name, r.value])).toEqual([['Research Archive', '60%'], ['Greenhouse Annex', '60%']]);
    expect(ctx(forecasts(), allClues(CASES.poisoned_archive))[2]!.fact).toBe('All 3 clues found.');
  });

  it('exact source labels per block (ML only from the model; rule-based risk keeps its own wording)', () => {
    const [hyde, egg, clues, tower] = ctx(forecasts());
    expect(hyde!.source).toBe('Bayesian estimate · patrol route + what you saw and heard');
    expect(egg!.source).toBe('Bayesian estimate · priors, traces, searched spots');
    expect(clues!.source).toBe('Bayesian estimate · case priors, searched spots');
    expect(tower!.source).toBe('Tower: ML estimate · Risk: Rule-based risk estimate');
    expect(tower!.rows.map((r) => [r.name, r.value, r.bandText])).toEqual([['Reach the tower', '85%', 'likely'], ['Detected in 15 s', '40%', 'Medium']]);
    const dormant = ctx(forecasts({
      detection: null,
      hyde: { phase: 'before_emergence', emergesInS: 20, label: 'Rule-based estimate', spawns: [
        { spawnId: 'sp1', name: 'Tower Courtyard', zoneId: 'z', x: 0, z: 0, p: 0.5 },
        { spawnId: 'sp2', name: 'Crypt Stairs', zoneId: 'z', x: 0, z: 0, p: 0.5 },
      ] },
    }));
    expect(dormant[0]!.question).toBe('Where may it emerge?');
    expect(dormant[0]!.note).toBe('Emerges in 0:20');
    expect(dormant[0]!.source).toBe('Rule-based estimate · case spawn rules');
    expect(dormant[3]!.source).toBe('Tower: ML estimate · Risk: Hyde not out yet');
  });

  it('without forecasts: egg / clue odds from the same Bayesian posterior (needs the investigation), no invented Hyde / tower numbers', () => {
    const [hyde, egg, clues, tower] = ctx(null);
    expect(hyde!.fact).toBe('Not available yet.');
    expect(tower!.fact).toBe('Not available yet.');
    expect(egg!.rows.map((r) => r.value)).toEqual(['50%', '30%', '20%']); // priors, nothing observed yet
    expect(clues!.rows.length).toBeGreaterThan(0);
    const blind = oddsBlocks({ forecasts: null, world: testWorld(), investigation: null, cluesFound: [], clueTotal: 3 });
    expect(blind[1]!.fact).toBe('Not available yet.');
    expect(blind[2]!.fact).toBe('Not available yet.');
  });

  it('carried / delivered egg → a fact line instead of odds', () => {
    expect(oddsBlocks({ forecasts: forecasts({ egg: null }), world: null, investigation: null, cluesFound: [], clueTotal: 3, eggState: 'carried' })[1]!.fact).toBe('You carry the egg.');
    expect(oddsBlocks({ forecasts: null, world: null, investigation: null, cluesFound: [], clueTotal: 3, eggState: 'delivered' })[1]!.fact).toBe('Egg secured.');
  });

  it('review markup: header, three slots, layer toggles 1/2/3, four odds blocks with sources + footer', () => {
    const c = CASES.crypt_last_witness;
    const html = board(c, [c.clues[0]!.id], 'review', { forecasts: forecasts() });
    expect(html).toContain('>Investigation</h2>');
    expect(html).toContain(`Case ${c.number} · ${esc(c.title)}`);
    expect((html.match(/data-testid="clue-/g) ?? []).length).toBe(3);
    // the case has Joseph Crackstone: toggle 4 + legend + "Will Crackstone see you?" (UX_ENEMIES §3 / §5)
    // UX_FINAL §1d: toggle 5 (Slurp) joins when the case world has Slurp
    const toggles = c.id && caseWorld(c.id)?.slurp ? [1, 2, 3, 4, 5] : [1, 2, 3, 4];
    for (const n of toggles) expect(html).toContain(`data-testid="layer-${n}"`);
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(toggles.length);
    for (const id of ['hyde', 'egg', 'clues', 'tower', 'crack']) expect(html).toContain(`data-testid="odds-${id}"`);
    expect(html).toContain('Will Crackstone see you?');
    expect(html).toContain('data-testid="inv-legend"');
    expect(html).toContain('Estimates, not facts. They change as you learn more.');
    expect(html).toContain('Deliver the egg first.');
  });
});

describe('accusation (R3 gate, no probabilities)', () => {
  it.each(ALL_CASES.map((c) => [c.id, c] as const))('%s: fewer than all clues → only "Leave the case unsolved" + "Find all 3 clues to accuse."', (_id, c) => {
    for (const found of [[], allClues(c).slice(0, 2)]) {
      expect(canNameSuspect(c, found)).toBe(false);
      const html = board(c, found, 'accuse');
      expect(html).toContain('data-step="gated"');
      expect(html).toContain('Find all 3 clues to accuse.');
      expect(html).toContain('data-testid="btn-leave-unsolved"');
      expect(html).not.toContain('data-testid="btn-accuse"');
      expect(html).not.toMatch(/data-testid="radio-/);
    }
  });

  it.each(ALL_CASES.map((c) => [c.id, c] as const))('%s: all clues → suspect radios replace the map; odds gone; nothing computes P(suspect)', (_id, c) => {
    expect(canNameSuspect(c, allClues(c))).toBe(true);
    const html = board(c, allClues(c), 'accuse', {});
    expect(html).toContain('>Name the culprit</h2>');
    expect(html).toContain('Who released the Hyde?');
    for (const s of c.suspects) expect(html).toContain(`data-testid="radio-${s.id}"`);
    expect(html).not.toContain('inv-map');
    expect(html).not.toContain('odds-');
    expect(html.replace(/<[^>]+>/g, ' ')).not.toMatch(/\d+\s?%/);
    expect(html).not.toContain(`data-culprit`);
    expect(html).not.toContain(esc(CASE_SOLUTIONS[c.id].resolution));
    // the three suspect cards are identical in structure (only text differs)
    const cards = [...html.matchAll(/<button type="button" role="radio"[^>]*>(.*?)<\/button>/g)].map((m) => m[1]!.replace(/>[^<]*</g, '><'));
    expect(cards).toHaveLength(3);
    expect(new Set(cards).size).toBe(1);
  });
});

describe('investigation map adapter', () => {
  it('maps odds rows to the renderer highlight ids', () => {
    expect(highlightId({ kind: 'egg', id: 'e1' })).toBe('egg:e1');
    expect(highlightId({ kind: 'zone', id: 'z' })).toBe('zone:z');
    expect(highlightId({ kind: 'tower', id: 'tower' })).toBeNull();
    expect(highlightId(undefined)).toBeNull();
  });

  it('hit-tests egg sites, areas and zones (layer-aware)', () => {
    const view = { center: { x: 0, z: 0 }, rotation: 0, pxPerM: 4, size: { w: 400, h: 400 }, shape: 'rect' as const };
    const L = {
      eggSites: [{ id: 'e1', label: 'Shed', x: 10, z: 0, p: 0.5, cell: null, state: 'candidate', top: true }],
      spawns: [],
      areas: [{ id: 'a1', name: 'Annex', x: -20, z: 0, radiusM: 6, p: 0.5, cell: null, state: 'open', badge: false }],
      zones: [{ id: 'z1', name: 'Lawn', polygon: [{ x: -50, z: -50 }, { x: -50, z: 50 }, { x: 50, z: 50 }, { x: 50, z: -50 }], p: 0.5, cell: null, own: false }],
    } as never;
    const on = { zones: true, egg: true, clues: true };
    expect(hitTest(L, view, { x: 240, y: 200 }, on)).toEqual({ kind: 'egg', id: 'e1' });
    expect(hitTest(L, view, { x: 120, y: 200 }, on)).toEqual({ kind: 'area', id: 'a1' });
    expect(hitTest(L, view, { x: 300, y: 300 }, on)).toEqual({ kind: 'zone', id: 'z1' });
    expect(hitTest(L, view, { x: 240, y: 200 }, { ...on, egg: false })).toEqual({ kind: 'zone', id: 'z1' });
  });
});
