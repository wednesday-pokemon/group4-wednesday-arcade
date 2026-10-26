// The public view of one live moment: case world + observations → posteriors (+ the session's Hyde-zone estimate when
// known). Shared by the prescriptive engine, the live engine and objective targeting. Built ONLY from publicState.ts.
import type { MysteryRun } from '../run.ts';
import type { CaseWorldDef, EggSiteDef, InvestigationState, Vec2 } from '../types.ts';
import { clueAreaProbabilities, clueSiteProbabilities, eggPosterior, type ClueSiteProb, type SitePosterior } from './bayes.ts';
import { zoneIndexAt } from './hydeZones.ts';
import { hydeEmergedOf, hydeVisibleOf, investigationOf, publicEggPosition, worldOf } from './publicState.ts';
import type { AreaProb, ZoneProb } from './types.ts';

export interface EggSiteView extends SitePosterior { def: EggSiteDef }

export interface PublicView {
  world: CaseWorldDef | null;
  inv: InvestigationState;
  emerged: boolean;
  /** The player can see the Hyde now. */
  visible: boolean;
  /** Candidate sites of the uncollected clues (within-group posterior). */
  clueSites: ClueSiteProb[];
  /** P(area holds ≥ 1 uncollected clue), world order. */
  areas: AreaProb[];
  egg: EggSiteView[];
  /** Where the player knows the egg is (carried / dropped / seen), else null. */
  eggKnownAt: Vec2 | null;
  /** The session's zone estimate (null = not available, e.g. before emergence or without a session). */
  zones: ZoneProb[] | null;
  /** Probability that the Hyde is in the player's own zone (0 when unknown / before emergence). */
  ownZoneP: number;
  ownZoneName: string | null;
}

export function publicView(run: MysteryRun, zones: ZoneProb[] | null = null): PublicView {
  const world = worldOf(run);
  const inv = investigationOf(run);
  const emerged = hydeEmergedOf(run, inv);
  const visible = emerged && hydeVisibleOf(run);
  const clueSites = world ? clueSiteProbabilities(world, inv, run.cluesFound) : [];
  const areas = world ? clueAreaProbabilities(world, inv, run.cluesFound) : [];
  const egg: EggSiteView[] = world
    ? eggPosterior(world, inv).map((s) => ({ ...s, def: world.eggSites.find((e) => e.id === s.siteId)! }))
    : [];
  let ownZoneP = 0;
  let ownZoneName: string | null = null;
  if (zones && zones.length > 0 && world && world.zones.length === zones.length) {
    const i = zoneIndexAt(world.zones, run.player.x, run.player.z);
    if (i >= 0) {
      ownZoneP = zones[i].p;
      ownZoneName = zones[i].name;
    }
  }
  return {
    world, inv, emerged, visible, clueSites, areas, egg, eggKnownAt: publicEggPosition(run, inv, world),
    zones: emerged ? zones : null, ownZoneP: emerged ? ownZoneP : 0, ownZoneName,
  };
}

/** The most probable egg site (ties → nearest to `from`), or null. */
export function topEggSite(view: Pick<PublicView, 'egg'>, from: Vec2): EggSiteView | null {
  let best: EggSiteView | null = null;
  const d = (s: EggSiteView) => Math.hypot(s.def.x - from.x, s.def.z - from.z);
  for (const s of view.egg) if (!best || s.p > best.p + 1e-9 || (Math.abs(s.p - best.p) <= 1e-9 && d(s) < d(best))) best = s;
  return best;
}
