// Exact Bayesian posteriors (src/mystery/analytics/bayes.ts): hand-computed fixtures, agreement with the sim's own
// public-knowledge helpers (layout.ts) and a Monte-Carlo check against the sim's DRAW rules (drawLayout + traceSiteFor):
// among sessions whose trace pointed at site k, the true egg site is distributed exactly as the posterior says.
import { describe, expect, it } from 'vitest';
import {
  clueAreaProbabilities, clueSitePosterior, clueSiteProbabilities, EggTracker, eggPosterior, traceLikelihood,
} from '../../../src/mystery/analytics/bayes.ts';
import { clueSitePosterior as simClue, drawLayout, eggSitePosterior as simEgg, traceSiteFor } from '../../../src/mystery/layout.ts';
import { CASE_WORLDS } from '../../../src/mystery/data/caseWorlds.ts';
import type { CaseWorldDef, EggSiteDef, InvestigationState, SiteDef } from '../../../src/mystery/types.ts';

const site = (id: string, areaId: string, prior: number, x = 0, z = 0): SiteDef => ({ id, areaId, roomId: 'path', x, z, prior, label: id, prop: 'crate' });
const egg = (id: string, areaId: string, prior: number): EggSiteDef => ({ ...site(id, areaId, prior), traceText: `to ${id}` });

/** A synthetic world with real uncertainty (3 egg sites, multi-site clue groups) — independent of the designer data. */
export const FIXTURE: CaseWorldDef = {
  caseId: 'poisoned_archive', theme: 'archive',
  areas: [
    { id: 'A', name: 'Archive', x: 0, z: 0, radiusM: 8 },
    { id: 'G', name: 'Greenhouse', x: 30, z: 0, radiusM: 8 },
    { id: 'C', name: 'Crypt', x: 0, z: 30, radiusM: 8 },
  ],
  clueSites: [
    { clueId: 'falsified_transfer', searchS: 2, sites: [site('ft1', 'A', 0.6), site('ft2', 'G', 0.4)] },
    { clueId: 'botanical_residue', searchS: 2, sites: [site('br1', 'G', 0.5), site('br2', 'G', 0.3), site('br3', 'C', 0.2)] },
    { clueId: 'access_ledger', searchS: 2, sites: [site('al1', 'C', 1)] },
  ],
  eggSites: [egg('e1', 'A', 0.5), egg('e2', 'G', 0.3), egg('e3', 'C', 0.2)],
  traceAccuracy: 0.75,
  hydeSpawns: [], zones: [], extraWalls: [], extraCover: [], extraHiding: [], passage: null, examines: [], hazards: [],
};

const inv = (o: Partial<InvestigationState> = {}): InvestigationState => ({
  checkedClueSites: [], knownClueSites: {}, checkedEggSites: [], eggSeenAt: null, traces: [], examined: [], passageOpen: false,
  hydeEmerged: false, hydeEmergedAt: null, hydeEmergesInS: 20, lastHydeSighting: null, ...o,
});

const ps = (xs: { p: number }[]) => xs.map((x) => x.p);

describe('egg-site posterior (exact Bayes)', () => {
  it('prior only → the priors', () => {
    expect(ps(eggPosterior(FIXTURE, inv()))).toEqual([0.5, 0.3, 0.2]);
  });

  it('one trace at k: a vs (1 − a)/(n − 1), renormalised', () => {
    const post = ps(eggPosterior(FIXTURE, inv({ traces: [{ sourceId: 'vial', siteId: 'e2', t: 3 }] })));
    // ∝ .5 × .125, .3 × .75, .2 × .125 = .0625, .225, .025 → /.3125
    expect(post[0]).toBeCloseTo(0.0625 / 0.3125, 12);
    expect(post[1]).toBeCloseTo(0.225 / 0.3125, 12);
    expect(post[2]).toBeCloseTo(0.025 / 0.3125, 12);
    expect(traceLikelihood(3, 0.75, 1, 1)).toBe(0.75);
    expect(traceLikelihood(3, 0.75, 0, 1)).toBe(0.125);
    expect(traceLikelihood(1, 0.75, 0, 0)).toBe(1);
  });

  it('checked-empty → 0 (ruledOut), egg seen → 1, inconsistent evidence → the prior', () => {
    const c = eggPosterior(FIXTURE, inv({ checkedEggSites: ['e1'] }));
    expect(ps(c)).toEqual([0, 0.6, 0.4].map((x) => expect.closeTo(x, 12)));
    expect(c[0].ruledOut).toBe(true);
    expect(ps(eggPosterior(FIXTURE, inv({ eggSeenAt: 'e3', traces: [{ sourceId: 'x', siteId: 'e1', t: 1 }] })))).toEqual([0, 0, 1]);
    expect(ps(eggPosterior(FIXTURE, inv({ checkedEggSites: ['e1', 'e2', 'e3'] })))).toEqual([0.5, 0.3, 0.2]);
  });

  it('agrees with the sim helper (layout.ts eggSitePosterior) on many observation sets', () => {
    const traces = ['e1', 'e2', 'e3'];
    for (let i = 0; i < 200; i++) {
      const o = inv({
        traces: Array.from({ length: i % 4 }, (_, k) => ({ sourceId: `s${k}`, siteId: traces[(i * 7 + k * 3) % 3], t: k })),
        checkedEggSites: i % 5 === 0 ? ['e3'] : i % 7 === 0 ? ['e1'] : [],
      });
      const mine = ps(eggPosterior(FIXTURE, o));
      const sim = simEgg(FIXTURE, o);
      mine.forEach((p, k) => expect(p).toBeCloseTo(sim[k], 12));
      expect(mine.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    }
  });

  it('Monte Carlo over the sim draw rules: P(true site | trace → k) matches the posterior', () => {
    const N = 30_000;
    const counts = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; // [pointed k][true i]
    const ids = FIXTURE.eggSites.map((s) => s.id);
    for (let n = 0; n < N; n++) {
      const seed = `mc-${n}`;
      const layout = drawLayout(FIXTURE, seed);
      const k = ids.indexOf(traceSiteFor(FIXTURE, layout.eggSiteId, seed, 'vial'));
      counts[k][ids.indexOf(layout.eggSiteId)]++;
    }
    for (let k = 0; k < 3; k++) {
      const total = counts[k].reduce((a, b) => a + b, 0);
      const post = ps(eggPosterior(FIXTURE, inv({ traces: [{ sourceId: 'vial', siteId: ids[k], t: 0 }] })));
      for (let i = 0; i < 3; i++) {
        const se = Math.sqrt((post[i] * (1 - post[i])) / total);
        expect(Math.abs(counts[k][i] / total - post[i]), `trace→${ids[k]} true ${ids[i]}`).toBeLessThan(4 * se + 1e-9);
      }
    }
  }, 60_000);
});

describe('clue posteriors and areas', () => {
  it('within-group posterior: checked → 0, known → 1; agrees with the sim helper', () => {
    const g = FIXTURE.clueSites[1];
    expect(ps(clueSitePosterior(g, inv()))).toEqual([0.5, 0.3, 0.2]);
    expect(ps(clueSitePosterior(g, inv({ checkedClueSites: ['br1'] })))).toEqual([0, 0.6, 0.4].map((x) => expect.closeTo(x, 12)));
    expect(ps(clueSitePosterior(g, inv({ knownClueSites: { botanical_residue: 'br3' } })))).toEqual([0, 0, 1]);
    for (const o of [inv(), inv({ checkedClueSites: ['br2'] }), inv({ knownClueSites: { botanical_residue: 'br1' } })]) {
      const sim = simClue(FIXTURE, 'botanical_residue', o);
      ps(clueSitePosterior(g, o)).forEach((p, k) => expect(p).toBeCloseTo(sim[k], 12));
    }
  });

  it('P(area holds ≥ 1 uncollected clue) = 1 − Π(1 − P(clue in area)); collected clues excluded', () => {
    const a = clueAreaProbabilities(FIXTURE, inv(), []);
    const by = Object.fromEntries(a.map((x) => [x.areaId, x.p]));
    expect(by.A).toBeCloseTo(0.6, 12); // only falsified_transfer can be in A
    expect(by.G).toBeCloseTo(1 - (1 - 0.4) * (1 - 0.8), 12); // ft2 .4, br1+br2 .8
    expect(by.C).toBeCloseTo(1 - (1 - 0.2) * (1 - 1), 12); // al1 is certain → 1
    const later = Object.fromEntries(clueAreaProbabilities(FIXTURE, inv({ checkedClueSites: ['ft1'] }), ['access_ledger']).map((x) => [x.areaId, x.p]));
    expect(later.A).toBe(0);
    expect(later.C).toBeCloseTo(0.2, 12); // the access ledger is collected: only br3 remains
    expect(clueSiteProbabilities(FIXTURE, inv(), ['falsified_transfer', 'botanical_residue', 'access_ledger'])).toEqual([]);
  });

  it('the designer worlds are valid probability inputs (groups and egg priors sum to 1)', () => {
    for (const w of Object.values(CASE_WORLDS)) {
      for (const g of w.clueSites) expect(g.sites.reduce((a, s) => a + s.prior, 0)).toBeCloseTo(1, 6);
      expect(w.eggSites.reduce((a, s) => a + s.prior, 0)).toBeCloseTo(1, 6);
      expect(ps(eggPosterior(w, inv())).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    }
  });
});

describe('EggTracker (display history)', () => {
  it('keeps prevP and the reason of the last observation-driven change', () => {
    const tr = new EggTracker((kind, id) => (kind === 'trace' ? `Trace from ${id}` : kind === 'checked' ? `${id} searched` : `Egg seen at ${id}`));
    const s0 = tr.update(FIXTURE, inv(), 1);
    expect(s0.map((s) => s.prevP)).toEqual([null, null, null]);
    expect(tr.lastChange()).toBeNull();
    const s1 = tr.update(FIXTURE, inv({ traces: [{ sourceId: 'the cracked vial', siteId: 'e1', t: 5 }] }), 5);
    expect(tr.lastChange()).toEqual({ reason: 'Trace from the cracked vial', t: 5 });
    expect(s1[0].prevP).toBeCloseTo(0.5, 12);
    expect(s1[0].p).toBeGreaterThan(0.5);
    // nothing new → no new change
    tr.update(FIXTURE, inv({ traces: [{ sourceId: 'the cracked vial', siteId: 'e1', t: 5 }] }), 6);
    expect(tr.lastChange()?.t).toBe(5);
    tr.update(FIXTURE, inv({ traces: [{ sourceId: 'the cracked vial', siteId: 'e1', t: 5 }], checkedEggSites: ['e1'] }), 9);
    expect(tr.lastChange()).toEqual({ reason: 'e1 searched', t: 9 });
  });
});
