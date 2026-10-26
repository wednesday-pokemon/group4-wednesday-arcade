// Public investigation state (docs/overhaul/OVERHAUL_CONTRACT.md "Sim rules" 2–4): what the player has OBSERVED about the
// hidden session layout, kept exact so analytics posteriors are valid Bayesian updates.
//
// Site checks: every step, each unresolved candidate site within tuning.investigation.siteCheckM of the player with line of
// sight (walls + high cover; a high-cover prop standing ON the site does not hide it) is checked: the item there →
// knownClueSites / eggSeenAt + `site_checked{found:true}`; else checkedClueSites / checkedEggSites +
// `site_checked{found:false}`. Detection is certain in range (likelihood 0 for "present but unseen"). A clue group is
// unresolved until its clue is known; egg sites until the egg is seen. Starting a clue search / egg pickup with E always
// counts as a check of that site. Reveal powers (reveal_clues, incl. the scent trail) are exact observations too: the
// revealed clue becomes known, and — because they pick the NEAREST uncollected clues — every candidate site of another
// unfound clue strictly nearer than the last revealed clue (or within range, when fewer than `magnitude` were in range)
// is checked empty; a reveal that does not light the egg checks the egg sites within its range.
//
// Traces: every clue found and every examined ExamineDef with givesTrace → one trace (`trace_found`) whose target is
// layout.ts traceSiteFor (PRF 'trace:<sourceId>'). Traces keep coming after the egg was seen (no longer informative).
import type { SimContext } from './context.ts';
import { segmentHitsCollider, type World } from './geometry.ts';
import { traceSiteFor } from './layout.ts';
import type { CaseWorldDef, ClueId, EggTrace, ExamineDef, InvestigationState, SessionLayout, SiteDef } from './types.ts';

interface SiteEntry { kind: 'clue' | 'egg'; clueId: ClueId | null; site: SiteDef }

/** Line of sight from the player to a site: walls + high cover, except cover standing on the site itself (its prop). */
export function siteVisible(world: World, px: number, pz: number, s: { x: number; z: number }): boolean {
  for (const w of world.walls) {
    if (world.isWallOpen(w.id)) continue;
    if (segmentHitsCollider(px, pz, s.x, s.z, w)) return false;
  }
  for (const c of world.cover) {
    if (c.low) continue;
    if (Math.hypot(c.ax - s.x, c.az - s.z) <= c.r + 0.5) continue; // the site's own prop / shelf
    if (segmentHitsCollider(px, pz, s.x, s.z, c)) return false;
  }
  return true;
}

export type InvestigationCore = Omit<InvestigationState, 'hydeEmerged' | 'hydeEmergedAt' | 'hydeEmergesInS' | 'lastHydeSighting'>;

export class InvestigationTracker {
  readonly checkedClueSites: string[] = [];
  readonly knownClueSites: Partial<Record<ClueId, string>> = {};
  readonly checkedEggSites: string[] = [];
  eggSeenAt: string | null = null;
  readonly traces: EggTrace[] = [];
  readonly examined: string[] = [];
  passageOpen = false;
  private readonly sites: SiteEntry[] = [];
  private readonly traced = new Set<string>();

  constructor(readonly world: CaseWorldDef | null, private readonly layout: SessionLayout, private readonly seed: string) {
    if (!world) return;
    for (const g of world.clueSites) for (const s of g.sites) this.sites.push({ kind: 'clue', clueId: g.clueId, site: s });
    for (const s of world.eggSites) this.sites.push({ kind: 'egg', clueId: null, site: s });
  }

  /** Is this site still informative (its group unresolved and the site itself not checked)? */
  private open(e: SiteEntry): boolean {
    if (e.kind === 'clue') return this.knownClueSites[e.clueId!] === undefined && !this.checkedClueSites.includes(e.site.id);
    return this.eggSeenAt === null && !this.checkedEggSites.includes(e.site.id);
  }

  private isTrue(e: SiteEntry): boolean {
    return e.kind === 'clue' ? this.layout.clueSites[e.clueId!] === e.site.id : this.layout.eggSiteId === e.site.id;
  }

  /** Records one check of `e` (must be open) and emits `site_checked`. Returns whether the item was there. */
  private check(ctx: SimContext, e: SiteEntry): boolean {
    const found = this.isTrue(e);
    if (e.kind === 'clue') {
      if (found) this.knownClueSites[e.clueId!] = e.site.id;
      else this.checkedClueSites.push(e.site.id);
    } else if (found) this.eggSeenAt = e.site.id;
    else this.checkedEggSites.push(e.site.id);
    ctx.emit({ type: 'site_checked', site: e.kind, siteId: e.site.id, found });
    return found;
  }

  /** Per-step automatic checks by sight. */
  observe(ctx: SimContext): void {
    if (this.sites.length === 0) return;
    const p = ctx.player;
    const R = ctx.tuning.investigation.siteCheckM;
    for (const e of this.sites) {
      if (Math.abs(e.site.x - p.x) > R || Math.abs(e.site.z - p.z) > R) continue;
      if (!this.open(e)) continue;
      if (Math.hypot(e.site.x - p.x, e.site.z - p.z) > R) continue;
      if (!siteVisible(ctx.world, p.x, p.z, e.site)) continue;
      this.check(ctx, e);
    }
  }

  /** The player started searching `clueId` (E): its site is now known. */
  searched(ctx: SimContext, clueId: ClueId): void {
    const e = this.sites.find((x) => x.kind === 'clue' && x.clueId === clueId && this.isTrue(x));
    if (e && this.open(e)) this.check(ctx, e);
  }

  /** The egg was seen at its resting site (pickup started, reveal effect, scent trail). */
  eggSeen(ctx: SimContext): void {
    const e = this.sites.find((x) => x.kind === 'egg' && this.isTrue(x));
    if (e && this.open(e)) this.check(ctx, e);
  }

  clueFound(ctx: SimContext, clueId: ClueId): void {
    this.searched(ctx, clueId);
    this.trace(ctx, clueId);
  }

  examineDone(ctx: SimContext, ex: ExamineDef): void {
    if (this.examined.includes(ex.id)) return;
    this.examined.push(ex.id);
    ctx.emit({ type: 'examined', examineId: ex.id });
    if (ex.givesTrace) this.trace(ctx, ex.id);
  }

  /** One trace per source id (clue id / examine id). */
  trace(ctx: SimContext, sourceId: string): void {
    const w = this.world;
    if (!w || w.eggSites.length === 0 || !this.layout.eggSiteId || this.traced.has(sourceId)) return;
    this.traced.add(sourceId);
    const siteId = traceSiteFor(w, this.layout.eggSiteId, this.seed, sourceId);
    this.traces.push({ sourceId, siteId, t: Math.round(ctx.t * 1000) / 1000 });
    ctx.emit({ type: 'trace_found', sourceId, siteId });
  }

  /**
   * A reveal_clues activation picked `picked` (nearest first, ≤ k when k ≥ 1; k = 0 means "all in range") among the
   * uncollected clues within `rangeM` (0 = anywhere) of the player. Records exactly what that shows.
   */
  revealed(ctx: SimContext, picked: readonly ClueId[], rangeM: number, k: number): void {
    if (this.sites.length === 0) return;
    const p = ctx.player;
    const dist = (s: SiteDef) => Math.hypot(s.x - p.x, s.z - p.z);
    let kthD = 0;
    for (const id of picked) {
      const e = this.sites.find((x) => x.kind === 'clue' && x.clueId === id && this.isTrue(x));
      if (!e) continue;
      kthD = Math.max(kthD, dist(e.site));
      if (this.open(e)) this.check(ctx, e);
    }
    const full = k <= 0 || picked.length < k; // every unpicked uncollected clue lies beyond the range
    const inBound = (d: number) => (full ? rangeM > 0 && d <= rangeM : d < kthD - 1e-6);
    for (const e of this.sites) {
      if (e.kind !== 'clue' || picked.includes(e.clueId!) || ctx.cluesFound.includes(e.clueId!)) continue;
      if (!this.open(e) || this.isTrue(e)) continue; // the true site is never inside the bound (nearest-first)
      if (inBound(dist(e.site))) this.check(ctx, e);
    }
  }

  /** A reveal effect with range `rangeM` (> 0) did not light the resting egg: egg sites within range are empty. */
  eggNotRevealed(ctx: SimContext, rangeM: number): void {
    if (!(rangeM > 0)) return;
    const p = ctx.player;
    for (const e of this.sites) {
      if (e.kind !== 'egg' || !this.open(e) || this.isTrue(e)) continue;
      if (Math.hypot(e.site.x - p.x, e.site.z - p.z) <= rangeM) this.check(ctx, e);
    }
  }

  core(): InvestigationCore {
    return {
      checkedClueSites: [...this.checkedClueSites],
      knownClueSites: { ...this.knownClueSites },
      checkedEggSites: [...this.checkedEggSites],
      eggSeenAt: this.eggSeenAt,
      traces: this.traces.map((t) => ({ ...t })),
      examined: [...this.examined],
      passageOpen: this.passageOpen,
    };
  }
}
