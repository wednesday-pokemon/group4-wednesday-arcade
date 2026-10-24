// Exact Bayesian posteriors over the case's candidate sites (overhaul, docs/overhaul/OVERHAUL_CONTRACT.md "Analytics").
// Pure functions of PUBLIC inputs only: the case world (priors, sites — design data) and the InvestigationState (what
// the player observed). The session's hidden draw (SessionLayout / MapDef.clues / MapDef.eggSpawn) is never an input.
//
// EGG (one site per session drawn with the priors π_i, n sites):
//   P(egg at i | observations) ∝ π_i · Π_traces L_i(trace) · [i not checked empty]          (egg seen at s ⇒ 1 at s)
//   L_i(trace pointing at k) = a                 if i = k
//                            = (1 − a) / (n − 1)  otherwise                                 (a = world.traceAccuracy)
//   This is the sim's exact trace rule (u = prfUniform(seed, 'trace:<sourceId>') independent per source; u < a → true
//   site, else uniformly one of the other n − 1 sites) and its exact site-check rule (detection within siteCheckM is
//   certain, so a checked site that showed nothing has likelihood 0).
// CLUES (one site per clue group, drawn with the group's priors; groups independent):
//   P(clue c at s) ∝ π_s · [s not checked empty]   (known site ⇒ 1 there); collected clues are excluded;
//   P(area A holds ≥ 1 uncollected clue) = 1 − Π_c (1 − Σ_{s ∈ A} P(c at s)).
import type { AreaDef, CaseWorldDef, ClueId, ClueSiteGroup, EggSiteDef, InvestigationState } from '../types.ts';
import type { AreaProb, SiteProb } from './types.ts';

export interface SitePosterior { siteId: string; p: number; ruledOut: boolean }

/** Likelihood of one trace that points at site index `k`, for the hypothesis "the egg is at index `i`". */
export function traceLikelihood(n: number, a: number, i: number, k: number): number {
  if (n <= 1) return 1;
  return i === k ? a : (1 - a) / (n - 1);
}

function normalise(w: number[]): number[] {
  const z = w.reduce((s, x) => s + x, 0);
  return z > 0 ? w.map((x) => x / z) : w.map(() => 0);
}

/**
 * Egg-site posterior. Returns one entry per egg site in world order. If the observations are inconsistent (every site
 * ruled out — impossible under the sim rules), the prior is returned so the display never divides by zero.
 */
export function eggPosterior(world: Pick<CaseWorldDef, 'eggSites' | 'traceAccuracy'>, inv: Pick<InvestigationState, 'checkedEggSites' | 'eggSeenAt' | 'traces'>): SitePosterior[] {
  const sites = world.eggSites;
  const n = sites.length;
  if (n === 0) return [];
  if (inv.eggSeenAt && sites.some((s) => s.id === inv.eggSeenAt)) {
    return sites.map((s) => ({ siteId: s.id, p: s.id === inv.eggSeenAt ? 1 : 0, ruledOut: s.id !== inv.eggSeenAt }));
  }
  const a = Math.min(1, Math.max(0, world.traceAccuracy));
  const checked = new Set(inv.checkedEggSites);
  const index = new Map(sites.map((s, i) => [s.id, i]));
  const w = sites.map((s, i) => {
    if (checked.has(s.id)) return 0;
    let x = Math.max(0, s.prior);
    for (const tr of inv.traces) {
      const k = index.get(tr.siteId);
      if (k === undefined) continue; // a trace to an unknown site carries no information here
      x *= traceLikelihood(n, a, i, k);
    }
    return x;
  });
  let p = normalise(w);
  if (p.every((x) => x === 0)) p = normalise(sites.map((s) => Math.max(0, s.prior)));
  return sites.map((s, i) => ({ siteId: s.id, p: p[i], ruledOut: checked.has(s.id) }));
}

/** Posterior over one clue's candidate sites (known site → 1 there; checked-empty sites → 0). */
export function clueSitePosterior(group: ClueSiteGroup, inv: Pick<InvestigationState, 'checkedClueSites' | 'knownClueSites'>): SitePosterior[] {
  const known = inv.knownClueSites[group.clueId];
  if (known && group.sites.some((s) => s.id === known)) {
    return group.sites.map((s) => ({ siteId: s.id, p: s.id === known ? 1 : 0, ruledOut: s.id !== known }));
  }
  const checked = new Set(inv.checkedClueSites);
  let p = normalise(group.sites.map((s) => (checked.has(s.id) ? 0 : Math.max(0, s.prior))));
  if (p.every((x) => x === 0)) p = normalise(group.sites.map((s) => Math.max(0, s.prior)));
  return group.sites.map((s, i) => ({ siteId: s.id, p: p[i], ruledOut: checked.has(s.id) }));
}

export interface ClueSiteProb { clueId: ClueId; siteId: string; areaId: string; label: string; x: number; z: number; p: number; ruledOut: boolean }

/** Every candidate site of every UNCOLLECTED clue with its within-group posterior. */
export function clueSiteProbabilities(world: Pick<CaseWorldDef, 'clueSites'>, inv: Pick<InvestigationState, 'checkedClueSites' | 'knownClueSites'>, collected: readonly string[]): ClueSiteProb[] {
  const out: ClueSiteProb[] = [];
  for (const g of world.clueSites) {
    if (collected.includes(g.clueId)) continue;
    const post = clueSitePosterior(g, inv);
    g.sites.forEach((s, i) => out.push({ clueId: g.clueId, siteId: s.id, areaId: s.areaId, label: s.label, x: s.x, z: s.z, p: post[i].p, ruledOut: post[i].ruledOut }));
  }
  return out;
}

/** P(area holds ≥ 1 uncollected clue) for every area of the world (world order). */
export function clueAreaProbabilities(world: Pick<CaseWorldDef, 'clueSites' | 'areas'>, inv: Pick<InvestigationState, 'checkedClueSites' | 'knownClueSites'>, collected: readonly string[]): AreaProb[] {
  const sites = clueSiteProbabilities(world, inv, collected);
  return world.areas.map((a: AreaDef) => {
    let none = 1;
    const byClue = new Map<string, number>();
    for (const s of sites) if (s.areaId === a.id) byClue.set(s.clueId, (byClue.get(s.clueId) ?? 0) + s.p);
    for (const q of byClue.values()) none *= 1 - Math.min(1, q);
    return { areaId: a.id, name: a.name, x: a.x, z: a.z, radiusM: a.radiusM, p: clamp01(1 - none) };
  });
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// ----------------------------------------------------------------------------------------------------- display tracker

export interface EggChange { reason: string; t: number }

/**
 * Keeps the egg posterior's display history: `prevP` = the value before the latest observation-driven change (for the
 * "50% → 71%" animation) and `lastChange` = why it changed ("Trace from the cracked vial", "Potting shed searched").
 */
export class EggTracker {
  private last: Map<string, number> | null = null;
  private prev = new Map<string, number>();
  private change: EggChange | null = null;
  private seenTraces = 0;
  private seenChecked = 0;
  private seenSeen: string | null = null;

  constructor(private readonly reasonOf: (kind: 'trace' | 'checked' | 'seen', id: string) => string) {}

  /** Recomputes from the observations; `t` = sim time of this update. */
  update(world: Pick<CaseWorldDef, 'eggSites' | 'traceAccuracy'>, inv: Pick<InvestigationState, 'checkedEggSites' | 'eggSeenAt' | 'traces'>, t: number): SiteProb[] {
    const post = eggPosterior(world, inv);
    const now = new Map(post.map((s) => [s.siteId, s.p]));
    let reason: string | null = null;
    if (inv.eggSeenAt && inv.eggSeenAt !== this.seenSeen) reason = this.reasonOf('seen', inv.eggSeenAt);
    else if (inv.traces.length > this.seenTraces) reason = this.reasonOf('trace', inv.traces[inv.traces.length - 1].sourceId);
    else if (inv.checkedEggSites.length > this.seenChecked) reason = this.reasonOf('checked', inv.checkedEggSites[inv.checkedEggSites.length - 1]);
    this.seenSeen = inv.eggSeenAt;
    this.seenTraces = inv.traces.length;
    this.seenChecked = inv.checkedEggSites.length;
    if (this.last && [...now].some(([id, p]) => Math.abs(p - (this.last!.get(id) ?? 0)) > 1e-9)) {
      this.prev = new Map(this.last);
      this.change = { reason: reason ?? 'New evidence', t };
    }
    this.last = now;
    const byId = new Map<string, EggSiteDef>(world.eggSites.map((s) => [s.id, s]));
    return post.map((s) => {
      const d = byId.get(s.siteId)!;
      const prevP = this.change ? (this.prev.get(s.siteId) ?? null) : null;
      return { siteId: s.siteId, areaId: d.areaId, label: d.label, x: d.x, z: d.z, p: s.p, prevP, ruledOut: s.ruledOut };
    });
  }

  lastChange(): EggChange | null {
    return this.change;
  }
}
