// Probability display rules (UX_OVERHAUL §7): 5 % rounding with largest remainder, facts as words, bands, the HUD Odds
// panel phase table (≤ 4 rows, exact source labels) and observation-only delta chips.
import { describe, expect, it } from 'vitest';
import { bandOf, deltaText, oddsCells, pctText, roundGroup, roundPct, SOURCE_LABEL } from '../../../src/ui/mystery/odds.ts';
import { buildOdds, OddsDeltaTracker, oddsPhase } from '../../../src/app/mystery/hud/oddsModel.ts';
import type { LiveForecasts } from '../../../src/mystery/analytics/types.ts';
import type { InvestigationState } from '../../../src/mystery/types.ts';

const sq = (x: number, z: number) => [{ x, z }, { x, z: z + 1 }, { x: x + 1, z: z + 1 }, { x: x + 1, z }];

function forecasts(over: Partial<LiveForecasts> = {}): LiveForecasts {
  return {
    detection: { p: 0.1, band: 'low', source: 'ml', label: 'ML estimate', topFactors: [] },
    extraction: { p: 0.82, source: 'ml', label: 'ML estimate' },
    egg: {
      sites: [
        { siteId: 'e1', areaId: 'a1', label: 'Potting shed', x: 1, z: 1, p: 0.5, prevP: null, ruledOut: false },
        { siteId: 'e2', areaId: 'a2', label: 'Vault', x: 2, z: 2, p: 0.3, prevP: null, ruledOut: false },
        { siteId: 'e3', areaId: 'a3', label: 'Reliquary', x: 3, z: 3, p: 0.2, prevP: null, ruledOut: false },
      ],
      label: 'Bayesian estimate', lastChange: null,
    },
    clueAreas: {
      areas: [
        { areaId: 'a1', name: 'Greenhouse Annex', x: 0, z: 0, radiusM: 8, p: 0.8 },
        { areaId: 'a2', name: 'Records Crypt', x: 5, z: 5, radiusM: 8, p: 0.45 },
      ],
      label: 'Bayesian estimate',
    },
    hyde: {
      phase: 'active', label: 'Bayesian estimate',
      zones: [
        { zoneId: 'z1', name: 'Ravine', p: 0.45, polygon: sq(0, 0) },
        { zoneId: 'z2', name: 'Lawn', p: 0.3, polygon: sq(2, 0) },
        { zoneId: 'z3', name: 'Courtyard', p: 0.15, polygon: sq(4, 0) },
        { zoneId: 'z4', name: 'Crypt', p: 0.1, polygon: sq(6, 0) },
      ],
    },
    ...over,
  };
}

const inv = (over: Partial<InvestigationState> = {}): InvestigationState => ({
  checkedClueSites: [], knownClueSites: {}, checkedEggSites: [], eggSeenAt: null, traces: [], examined: [], passageOpen: false,
  hydeEmerged: true, hydeEmergedAt: 0, hydeEmergesInS: null, lastHydeSighting: null, ...over,
});

describe('rounding (largest remainder, 5 % steps)', () => {
  it('a distribution always sums to exactly 100 in 5 % units', () => {
    const cases = [[0.5, 0.3, 0.2], [0.333, 0.333, 0.334], [0.41, 0.27, 0.32], [0.97, 0.02, 0.01], [0.12, 0.13, 0.14, 0.15, 0.16, 0.3], [1 / 7, 1 / 7, 1 / 7, 1 / 7, 1 / 7, 1 / 7, 1 / 7]];
    for (const ps of cases) {
      const r = roundGroup(ps);
      expect(r.reduce((a, b) => a + b, 0)).toBe(100);
      for (const v of r) expect(v % 5).toBe(0);
    }
  });

  it('gives the leftover units to the largest remainders (ties → larger p, then order)', () => {
    expect(roundGroup([0.5, 0.3, 0.2])).toEqual([50, 30, 20]);
    // remainders .66 / .66 / .68: the .68 first, then the tie goes to the lower index
    expect(roundGroup([0.333, 0.333, 0.334])).toEqual([35, 30, 35]);
    expect(roundGroup([0.44, 0.33, 0.23])).toEqual([45, 35, 20]);
    expect(roundGroup([0, 0, 0])).toEqual([0, 0, 0]);
    // renormalises small floating drift
    expect(roundGroup([0.5000001, 0.3, 0.2]).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('single values round to 5 % and estimates never read 0 % or 100 %', () => {
    expect(roundPct(0.024)).toBe(0);
    expect(roundPct(0.026)).toBe(5);
    expect(roundPct(0.83)).toBe(85);
    expect(pctText(0)).toBe('<5%');
    expect(pctText(100)).toBe('>95%');
    expect(pctText(45)).toBe('45%');
  });

  it('facts are words; independent groups are rounded one by one', () => {
    const cells = oddsCells([{ p: 0 , fact: 'Not here' }, { p: 0.62 }, { p: 0.38 }], { distribution: true });
    expect(cells.map((c) => c.text)).toEqual(['Not here', '60%', '40%']);
    expect(cells[0]!.pct).toBeNull();
    const seen = oddsCells([{ p: 1, fact: 'Seen' }, { p: 0, fact: 'Not here' }, { p: 0, fact: 'Not here' }]);
    expect(seen.map((c) => c.text)).toEqual(['Seen', 'Not here', 'Not here']);
    // clue areas (P(≥ 1 clue)) do not form a distribution: no forced sum
    const areas = oddsCells([{ p: 0.8 }, { p: 0.45 }], { distribution: false });
    expect(areas.map((c) => c.text)).toEqual(['80%', '45%']);
  });

  it('bands: ≥ 60 likely, 30–55 maybe, ≤ 25 unlikely', () => {
    expect(bandOf(60)).toBe('likely');
    expect(bandOf(55)).toBe('maybe');
    expect(bandOf(30)).toBe('maybe');
    expect(bandOf(25)).toBe('unlikely');
    expect(deltaText(50, 80)).toBe('50% → 80%');
  });
});

describe('HUD Odds panel (§7.5 phase table)', () => {
  it('phases: hidden in the tutorial / accusation / without forecasts', () => {
    const f = forecasts();
    expect(oddsPhase('tutorial', 'find_clues', f)).toBe('hidden');
    expect(oddsPhase('playing', 'accuse', f)).toBe('hidden');
    expect(oddsPhase('playing', 'find_clues', null)).toBe('hidden');
    expect(oddsPhase('playing', 'find_clues', f)).toBe('find_clues');
    expect(oddsPhase('playing', 'find_egg', f)).toBe('find_egg');
    expect(oddsPhase('playing', 'deliver_egg', f)).toBe('carry');
    expect(oddsPhase('playing', 'retrieve_egg', f)).toBe('carry');
    const dormant = forecasts({ hyde: { phase: 'before_emergence', emergesInS: 18, label: 'Rule-based estimate', spawns: [] } });
    expect(oddsPhase('playing', 'find_clues', dormant)).toBe('dormant');
  });

  it('find_clues: HYDE LIKELY IN top 2 · CLUE top area · EGG top site — 4 rows, one shared source line', () => {
    const v = buildOdds('find_clues', forecasts(), inv(), new Map());
    expect(v.groups.map((g) => g.id)).toEqual(['hyde', 'clue', 'egg']);
    expect(v.groups[0]!.title).toBe('Hyde likely in');
    expect(v.groups[0]!.rows.map((r) => [r.name, r.cell.text])).toEqual([['Ravine', '45%'], ['Lawn', '30%']]);
    expect(v.groups[1]!.tag).toBe('Clue');
    expect(v.groups[1]!.rows[0]!.name).toBe('Greenhouse Annex');
    expect(v.groups[2]!.tag).toBe('Egg');
    expect(v.groups.reduce((s, g) => s + g.rows.length, 0)).toBe(4);
    expect(v.footer).toEqual(['Bayesian estimate']);
  });

  it('dormant: HYDE MAY EMERGE AT 3 spawns (rule-based) + CLUE; per-group source lines when they differ', () => {
    const f = forecasts({
      hyde: {
        phase: 'before_emergence', emergesInS: 18, label: SOURCE_LABEL.rule,
        spawns: [
          { spawnId: 's1', name: 'Archive Hallway', zoneId: 'z1', x: 0, z: 0, p: 0.45 },
          { spawnId: 's2', name: 'Greenhouse Entrance', zoneId: 'z2', x: 1, z: 0, p: 0.35 },
          { spawnId: 's3', name: 'Restricted Vault', zoneId: 'z3', x: 2, z: 0, p: 0.2 },
        ],
      },
    });
    const v = buildOdds('dormant', f, inv(), new Map());
    expect(v.groups.map((g) => g.id)).toEqual(['spawn', 'clue']);
    expect(v.groups[0]!.rows.map((r) => r.cell.text)).toEqual(['45%', '35%', '20%']);
    expect(v.footer).toEqual(['Hyde · Rule-based estimate', 'Clue · Bayesian estimate']);
  });

  it('find_egg: HYDE top 1 + EGG LIKELY AT all 3 with facts as words', () => {
    const f = forecasts();
    f.egg!.sites[1] = { ...f.egg!.sites[1]!, p: 0, ruledOut: true };
    f.egg!.sites[0] = { ...f.egg!.sites[0]!, p: 0.71 };
    f.egg!.sites[2] = { ...f.egg!.sites[2]!, p: 0.29 };
    const v = buildOdds('find_egg', f, inv({ checkedEggSites: ['e2'] }), new Map());
    expect(v.groups.map((g) => [g.id, g.rows.length])).toEqual([['hyde', 1], ['egg', 3]]);
    expect(v.groups[1]!.rows.map((r) => r.cell.text)).toEqual(['70%', '30%', 'Not here']);
    const seen = buildOdds('find_egg', f, inv({ eggSeenAt: 'e3' }), new Map());
    expect(seen.groups[1]!.rows.map((r) => [r.name, r.cell.text])).toEqual([['Reliquary', 'Seen'], ['Potting shed', 'Not here'], ['Vault', 'Not here']]);
  });

  it('carrying: HYDE top 3 + TOWER (extraction, its own source label)', () => {
    const v = buildOdds('carry', forecasts({ extraction: { p: 0.62, source: 'rule', label: 'Rule-based estimate' } }), inv(), new Map());
    expect(v.groups.map((g) => [g.id, g.rows.length])).toEqual([['hyde', 3], ['tower', 1]]);
    expect(v.groups[1]!.rows[0]!.cell.text).toBe('60%');
    expect(v.footer).toEqual(['Hyde · Bayesian estimate', 'Tower · Rule-based estimate']);
  });

  it('delta chips only after an observation and only for changes ≥ 10 points; Hyde zones never', () => {
    const t = new OddsDeltaTracker();
    const f1 = forecasts();
    t.update(f1, inv(), 0, 0);
    const drift = forecasts();
    drift.egg!.sites[0] = { ...drift.egg!.sites[0]!, p: 0.7 };
    drift.egg!.sites[1] = { ...drift.egg!.sites[1]!, p: 0.15 };
    drift.egg!.sites[2] = { ...drift.egg!.sites[2]!, p: 0.15 };
    t.update(drift, inv(), 0, 1); // no observation: no chip
    expect(t.active.size).toBe(0);
    t.update(drift, inv(), 1, 2); // observation (e.g. a trace): chip 50 → 70
    expect(t.active.get('egg:e1')).toMatchObject({ from: 50, to: 70 });
    expect(t.latest).toMatchObject({ id: 'egg:e1', from: 50, to: 70 });
    const v = buildOdds('find_egg', drift, inv(), t.active);
    expect(v.groups[1]!.rows[0]!.delta).toEqual({ text: '50% → 70%', dir: 'up' });
    expect(v.groups[0]!.rows[0]!.delta).toBeNull(); // Hyde row
    t.update(drift, inv(), 1, 5.1); // 3 s later the chip is gone
    expect(t.active.size).toBe(0);
  });
});
