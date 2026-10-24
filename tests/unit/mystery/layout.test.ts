// Session layout draws (docs/overhaul/OVERHAUL_CONTRACT.md "Sim rules" 1, 3, 6): determinism and exact PRF keys, empirical
// frequencies ≈ priors, trace accuracy, Bayesian consistency of the trace model, the Hyde spawn distribution, and the
// session map sharing geometry (no per-run nav rebuild).
import { describe, expect, it } from 'vitest';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { caseMap } from '../../../src/mystery/defaults.ts';
import {
  drawHydeSpawn, drawLayout, eggSitePosterior, layoutFromMap, pickCumulative, sessionMap, spawnDistribution, traceOffset, traceSiteFor,
} from '../../../src/mystery/layout.ts';
import { navGridsBuilt } from '../../../src/mystery/nav.ts';
import { prfUniform } from '../../../src/mystery/prf.ts';
import { MysteryRun } from '../../../src/mystery/run.ts';
import { CASE_IDS, type CaseWorldDef } from '../../../src/mystery/types.ts';
import { fixtureWorld, fixtureWorldMap } from './worldFixture.ts';

const N = 3000;
/** 3.5 standard errors of a frequency (at least 1 pp): seeded draws are deterministic, this only guards honesty. */
const tol = (p: number, n: number) => Math.max(0.01, 3.5 * Math.sqrt(Math.max(p * (1 - p), 1e-4) / n));
const seeds = Array.from({ length: N }, (_, i) => `layout-${i}`);

function worlds(): [string, CaseWorldDef][] {
  return [['fixture', fixtureWorld()], ...CASE_IDS.map((id) => [id, caseMap(id).world!] as [string, CaseWorldDef])];
}

describe('pickCumulative', () => {
  it('picks the first item whose running sum exceeds u × total', () => {
    const w = [0.5, 0.3, 0.2];
    expect(pickCumulative(w, (x) => x, 0)).toBe(0);
    expect(pickCumulative(w, (x) => x, 0.4999)).toBe(0);
    expect(pickCumulative(w, (x) => x, 0.5)).toBe(1);
    expect(pickCumulative(w, (x) => x, 0.7999)).toBe(1);
    expect(pickCumulative(w, (x) => x, 0.8)).toBe(2);
    expect(pickCumulative(w, (x) => x, 0.999999)).toBe(2);
    expect(pickCumulative([], (x: number) => x, 0.3)).toBe(-1);
  });
});

describe('drawLayout', () => {
  it("uses exactly prfUniform(seed, 'site:<clueId>') / 'site:egg' against cumulative priors (never 'egg:tier')", () => {
    const w = fixtureWorld();
    for (const seed of seeds.slice(0, 200)) {
      const l = drawLayout(w, seed);
      for (const g of w.clueSites) {
        const u = prfUniform(seed, `site:${g.clueId}`);
        expect(l.clueSites[g.clueId]).toBe(g.sites[pickCumulative(g.sites, (s) => s.prior, u)].id);
      }
      expect(l.eggSiteId).toBe(w.eggSites[pickCumulative(w.eggSites, (s) => s.prior, prfUniform(seed, 'site:egg'))].id);
    }
  });

  it('is deterministic per seed and differs across seeds', () => {
    const w = fixtureWorld();
    expect(drawLayout(w, 'abc')).toEqual(drawLayout(w, 'abc'));
    const distinct = new Set(seeds.slice(0, 50).map((s) => JSON.stringify(drawLayout(w, s))));
    expect(distinct.size).toBeGreaterThan(5);
  });

  for (const [name, w] of worlds()) {
    it(`${name}: empirical site frequencies over ${N} seeds ≈ priors (±3 pp)`, () => {
      const counts = new Map<string, number>();
      for (const seed of seeds) {
        const l = drawLayout(w, seed);
        for (const id of [...Object.values(l.clueSites), l.eggSiteId]) counts.set(id!, (counts.get(id!) ?? 0) + 1);
      }
      for (const g of w.clueSites) for (const s of g.sites) expect(Math.abs((counts.get(s.id) ?? 0) / N - s.prior), `${g.clueId}/${s.id}`).toBeLessThan(0.03);
      for (const s of w.eggSites) expect(Math.abs((counts.get(s.id) ?? 0) / N - s.prior), `egg/${s.id}`).toBeLessThan(0.03);
    });
  }
});

describe('egg traces', () => {
  it('traceOffset: u < a → true site (−1); else uniform over the n − 1 others', () => {
    expect(traceOffset(0.1, 0.75, 3)).toBe(-1);
    expect(traceOffset(0.7499, 0.75, 3)).toBe(-1);
    expect(traceOffset(0.75, 0.75, 3)).toBe(0);
    expect(traceOffset(0.8749, 0.75, 3)).toBe(0);
    expect(traceOffset(0.875, 0.75, 3)).toBe(1);
    expect(traceOffset(0.99999, 0.75, 3)).toBe(1);
    expect(traceOffset(0.9, 0.75, 1)).toBe(-1);
  });

  for (const [name, w] of worlds()) {
    if (w.eggSites.length < 2) continue;
    it(`${name}: a trace points at the true site with frequency ≈ traceAccuracy (±3 pp), wrong ones uniformly`, () => {
      let right = 0;
      const wrong = new Map<string, number>();
      let wrongN = 0;
      for (const seed of seeds) {
        const truth = drawLayout(w, seed).eggSiteId;
        const t = traceSiteFor(w, truth, seed, 'falsified_transfer');
        expect(w.eggSites.map((s) => s.id)).toContain(t);
        if (t === truth) right++;
        else {
          wrongN++;
          const others = w.eggSites.filter((s) => s.id !== truth).map((s) => s.id);
          wrong.set(`${others.indexOf(t)}`, (wrong.get(`${others.indexOf(t)}`) ?? 0) + 1);
        }
      }
      expect(Math.abs(right / N - w.traceAccuracy)).toBeLessThan(0.03);
      const q = 1 / (w.eggSites.length - 1);
      for (let k = 0; k < w.eggSites.length - 1; k++) expect(Math.abs((wrong.get(`${k}`) ?? 0) / wrongN - q), `offset ${k}`).toBeLessThan(tol(q, wrongN));
    });
  }

  it('Bayesian consistency: among seeds sharing the same two traces, the egg-site frequency ≈ the posterior (±3.5 SE)', () => {
    const w = fixtureWorld();
    const M = 8000;
    const buckets = new Map<string, { n: number; truth: Map<string, number>; traces: string[] }>();
    for (let i = 0; i < M; i++) {
      const seed = `bayes-${i}`;
      const truth = drawLayout(w, seed).eggSiteId;
      const traces = ['falsified_transfer', 'ex_vial'].map((src) => traceSiteFor(w, truth, seed, src));
      const key = traces.join('|');
      const b = buckets.get(key) ?? { n: 0, truth: new Map(), traces };
      b.n++;
      b.truth.set(truth, (b.truth.get(truth) ?? 0) + 1);
      buckets.set(key, b);
    }
    let checked = 0;
    for (const b of buckets.values()) {
      if (b.n < 250) continue;
      const post = eggSitePosterior(w, { checkedEggSites: [], eggSeenAt: null, traces: b.traces.map((siteId, k) => ({ sourceId: `s${k}`, siteId, t: 0 })) });
      w.eggSites.forEach((s, i) => expect(Math.abs((b.truth.get(s.id) ?? 0) / b.n - post[i]), `${b.traces.join('|')} → ${s.id}`).toBeLessThan(tol(post[i], b.n)));
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });
});

describe('Hyde spawn distribution', () => {
  const w = fixtureWorld();

  it('renormalises the weights of spawns ≥ minSpawnM; closer ones get 0; sums to 1', () => {
    const all = spawnDistribution(w, { x: 0, z: 17 }, 25);
    expect(all.map((s) => s.p)).toEqual([0.5, 0.3, 0.2]);
    const near = spawnDistribution(w, { x: 0, z: 0 }, 13); // sp_n is 12 m away → excluded
    expect(near.find((s) => s.spawnId === 'sp_n')!.p).toBe(0);
    expect(near.find((s) => s.spawnId === 'sp_w')!.p).toBeCloseTo(0.6, 10);
    expect(near.find((s) => s.spawnId === 'sp_e')!.p).toBeCloseTo(0.4, 10);
    for (const pos of [{ x: 0, z: 17 }, { x: -10, z: -10 }, { x: 15, z: 0 }]) {
      expect(spawnDistribution(w, pos, 10).reduce((a, s) => a + s.p, 0)).toBeCloseTo(1, 10);
    }
  });

  it('no valid spawn → the farthest gets p = 1 (and is drawn)', () => {
    const d = spawnDistribution(w, { x: 0, z: -12 }, 100);
    expect(d.filter((s) => s.p > 0)).toEqual([expect.objectContaining({ spawnId: 'sp_e', p: 1 })]); // 17.1 m vs sp_w 16.5 m
    expect(drawHydeSpawn(w, 'x', { x: 0, z: -12 }, 100)!.id).toBe('sp_e');
  });

  it(`draws with prfUniform(seed, 'hyde:spawn') at frequencies ≈ the distribution (${N} seeds, ±3 pp)`, () => {
    const pos = { x: 0, z: 0 };
    const dist = spawnDistribution(w, pos, 13);
    const counts = new Map<string, number>();
    for (const seed of seeds) {
      const s = drawHydeSpawn(w, seed, pos, 13)!;
      expect(Math.hypot(s.x - pos.x, s.z - pos.z)).toBeGreaterThanOrEqual(13);
      counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
    }
    for (const s of dist) expect(Math.abs((counts.get(s.spawnId) ?? 0) / N - s.p), s.spawnId).toBeLessThan(0.03);
  });
});

describe('session map', () => {
  it('moves clues / egg to the drawn sites and shares every geometry array with the case map', () => {
    for (const id of CASE_IDS) {
      const base = caseMap(id);
      const run = new MysteryRun({ duo: { characterId: 'enid', pokemonId: 'gengar' }, seed: `sess-${id}`, caseDef: CASES[id] });
      const w = base.world!;
      expect(run.layout).toEqual(drawLayout(w, `sess-${id}`));
      expect(run.map.id).toBe(base.id);
      for (const k of ['walls', 'cover', 'hidingSpots', 'rooms', 'patrol', 'world', 'safeReleasePoints', 'landmarks'] as const) expect(run.map[k], k).toBe(base[k]);
      for (const c of run.map.clues) {
        const g = w.clueSites.find((x) => x.clueId === c.clueId)!;
        const s = g.sites.find((x) => x.id === run.layout.clueSites[c.clueId])!;
        expect({ x: c.x, z: c.z, roomId: c.roomId, searchS: c.searchS }).toEqual({ x: s.x, z: s.z, roomId: s.roomId, searchS: g.searchS });
      }
      const e = w.eggSites.find((x) => x.id === run.layout.eggSiteId)!;
      expect(run.map.eggSpawn).toEqual({ x: e.x, z: e.z });
      expect(run.egg).toMatchObject({ x: e.x, z: e.z, state: 'resting' });
      expect(layoutFromMap(run.map)).toEqual(run.layout);
    }
  });

  it('a forced `layout` option is honoured; an explicit map is used as-is', () => {
    const map = fixtureWorldMap();
    const forced = { clueSites: { falsified_transfer: 's_ft_b', access_ledger: 's_al_b', botanical_residue: 's_br' }, eggSiteId: 'e_c' };
    const a = new MysteryRun({ duo: { characterId: 'enid', pokemonId: 'gengar' }, seed: 'f', map, layout: forced });
    expect(a.layout).toEqual(forced);
    expect(a.map.clues.find((c) => c.clueId === 'falsified_transfer')).toMatchObject({ x: 15, z: 10 });
    expect(a.map.walls).toBe(map.walls);
    const b = new MysteryRun({ duo: { characterId: 'enid', pokemonId: 'gengar' }, seed: 'f', map });
    expect(b.map).toBe(map);
    expect(b.layout).toEqual({ clueSites: { falsified_transfer: 's_ft_a', access_ledger: 's_al_a', botanical_residue: 's_br' }, eggSiteId: 'e_a' });
    expect(sessionMap(map, forced).cover).toBe(map.cover);
  });

  it('nav grids are shared across runs (no rebuild per session); construction is cheap', () => {
    const mk = (i: number) => new MysteryRun({ duo: { characterId: 'enid', pokemonId: 'gengar' }, seed: `perf-${i}`, caseDef: CASES.midnight_signal });
    const warm = mk(0);
    warm.playerNav();
    warm.playerNav(true);
    warm.hydeNav();
    const built = navGridsBuilt();
    const t0 = performance.now();
    const n = 60;
    for (let i = 1; i <= n; i++) {
      const r = mk(i);
      r.playerNav();
      r.playerNav(true);
      r.hydeNav();
    }
    const per = (performance.now() - t0) / n;
    expect(navGridsBuilt()).toBe(built);
    console.log(`MysteryRun construction + nav lookups: ${per.toFixed(2)} ms per run (grids built: ${built})`);
    expect(per).toBeLessThan(15);
  });
});
