// Shared movement + SEARCH helpers for the two enemies (the Hyde, hyde.ts; Joseph Crackstone, crackstone.ts). Extracted
// verbatim from the Hyde (ENEMY_CONTRACT R1: its behaviour must not change — the regression hashes in
// tests/unit/mystery/crackstone.test.ts pin its logs byte for byte):
//   NavTraveller     walk toward a goal along a nav grid at a speed (world.move collision, turn rate, replanning while
//                    chasing, stuck guard: < 0.3 m progress in 1.5 s drops the plan and — unless chasing — reports
//                    "arrived" so the caller moves on).
//   planSearchSpots  plausible hiding places around a search centre (near side of hiding spots at hidingSafeM, flank
//                    points looking behind cover), nearest-first.
//   pickSearchPoint  a random wander point near the centre, never within hidingSafeM of a hiding spot.
// An optional `accept` filter lets Crackstone keep his search inside his leash; the Hyde passes none.
import type { SimContext } from './context.ts';
import { dist, turnToward, yawTo } from './geometry.ts';
import type { NavGrid } from './nav.ts';
import type { Rng } from './rng.ts';
import type { MapDef, Vec2 } from './types.ts';

/** SEARCH counts a planned spot as reached this far short of it (travel `arrive`). */
export const SEARCH_ARRIVE_M = 0.6;

/** Closest a SEARCH stand / wander point may be to a hiding spot's centre without ever revealing a player inside it. */
export function hidingSafeM(s: { radius: number; revealM: number }): number {
  return s.revealM + s.radius + SEARCH_ARRIVE_M + 0.4;
}

/** Is `p` closer than hidingSafeM to some hiding spot? */
export function nearHiding(map: MapDef, p: Vec2): boolean {
  return map.hidingSpots.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < hidingSafeM(s));
}

/** revealM of the crouch-in hiding spot containing (x, z), or null when the point is in none (cabinets are entered with E). */
export function hidingRevealAt(ctx: Pick<SimContext, 'map'>, x: number, z: number): number | null {
  for (const s of ctx.map.hidingSpots) if (s.kind !== 'cabinet' && Math.hypot(s.x - x, s.z - z) <= s.radius) return s.revealM;
  return null;
}

/** Stands for "never seen": a closed cabinet hides the player at any distance (canSee: distance > −1 → hidden). */
export const CLOSED_CABINET_REVEAL_M = -1;

/**
 * How a hidden player can be seen right now (canSee's hiddenRevealM): null = not hidden; inside a CLOSED cabinet →
 * CLOSED_CABINET_REVEAL_M (invisible); an OPEN cabinet → that cabinet's revealM (like a crouch spot); crouched in a hiding
 * spot → its revealM.
 */
export function playerRevealAt(ctx: Pick<SimContext, 'map' | 'player'>): number | null {
  const p = ctx.player;
  if (!p.hidden) return null;
  const cab = p.cabinet;
  if (cab) {
    if (cab.phase === 'closed') return CLOSED_CABINET_REVEAL_M;
    return ctx.map.hidingSpots.find((s) => s.id === cab.spotId)?.revealM ?? 1.5;
  }
  return hidingRevealAt(ctx, p.x, p.z);
}

/** The player is inside a cabinet with the door open or closed (not while stepping in / out). */
export function inCabinetNow(p: { cabinet?: { phase: string } | null }): boolean {
  return !!p.cabinet && (p.cabinet.phase === 'open' || p.cabinet.phase === 'closed');
}

/**
 * The cabinet an enemy at `body` finds the player in right now (its spot id), or null: the player is inside (open /
 * closed), the enemy either sees them (an open door within revealM) or remembers that cabinet (witnessed / creak), and it
 * stands within cabinet.pullOutM of the cabinet's exit point (ctx.cabinetExit).
 */
export function cabinetFound(ctx: SimContext, body: Vec2, remembered: { spotId: string } | null, seen: boolean): string | null {
  const cab = ctx.player.cabinet;
  if (!cab || !inCabinetNow(ctx.player) || !ctx.pullOut) return null;
  if (!seen && remembered?.spotId !== cab.spotId) return null;
  const door = ctx.cabinetExit?.();
  if (!door) return null;
  return Math.hypot(body.x - door.x, body.z - door.z) <= ctx.tuning.cabinet.pullOutM ? cab.spotId : null;
}

export interface SearchSpot { at: Vec2; look: Vec2 }

export interface MovingBody { x: number; z: number; yaw: number; speed: number; path: Vec2[] }
export interface TravelSpec { radius: number; turnRatePerS: number; replanS: number }

export class NavTraveller {
  planGoal: Vec2 | null = null;
  lastPlanT = -Infinity;
  private stuckRefX = 0;
  private stuckRefZ = 0;
  private stuckRefT = 0;
  private lastTravelT = -Infinity;

  /** Drops the current plan so the next travel() replans from scratch. */
  invalidate(body: MovingBody): void {
    body.path = [];
    this.planGoal = null;
    this.lastPlanT = -Infinity;
  }

  /**
   * Walk `body` toward `goal` along `nav` at `speed`. Returns true once within `arrive` metres of the goal, or when the
   * goal cannot be got closer to (unreachable / stuck — never while `chasing`).
   */
  travel(
    ctx: SimContext, nav: NavGrid, body: MovingBody, spec: TravelSpec, goal: Vec2, speed: number, dt: number, arrive: number,
    direct: boolean, chasing: boolean,
  ): boolean {
    const h = body;
    const t = ctx.t;
    if (t - this.lastTravelT > dt * 2.5) {
      this.stuckRefX = h.x;
      this.stuckRefZ = h.z;
      this.stuckRefT = t;
    }
    this.lastTravelT = t;
    const d = Math.hypot(goal.x - h.x, goal.z - h.z);
    if (d <= arrive) {
      h.speed = 0;
      return true;
    }
    const goalMoved = !this.planGoal || Math.hypot(goal.x - this.planGoal.x, goal.z - this.planGoal.z) > 1.0;
    const stale = chasing && t - this.lastPlanT >= spec.replanS;
    if (direct && nav.lineWalkable(h, goal)) {
      h.path = [{ x: goal.x, z: goal.z }];
      this.planGoal = { x: goal.x, z: goal.z };
    } else if (goalMoved || stale || h.path.length === 0) {
      if (h.path.length === 0 && !goalMoved && !stale && t - this.lastPlanT < 0.5) {
        h.speed = 0; // already at the closest reachable point to an unreachable goal
        return true;
      }
      h.path = nav.findPath(h, goal) ?? [];
      this.planGoal = { x: goal.x, z: goal.z };
      this.lastPlanT = t;
      if (h.path.length === 0) {
        h.speed = 0;
        return true;
      }
    }
    let budget = speed * dt;
    let moved = 0;
    let guard = 0;
    while (budget > 1e-6 && h.path.length > 0 && guard++ < 8) {
      const wp = h.path[0];
      const dx = wp.x - h.x;
      const dz = wp.z - h.z;
      const dd = Math.hypot(dx, dz);
      if (dd < 0.05) {
        h.path.shift();
        continue;
      }
      const stepLen = Math.min(budget, dd);
      const r = ctx.world.move(h.x, h.z, (dx / dd) * stepLen, (dz / dd) * stepLen, spec.radius);
      const actual = Math.hypot(r.x - h.x, r.z - h.z);
      h.x = r.x;
      h.z = r.z;
      h.yaw = turnToward(h.yaw, yawTo(0, 0, dx, dz), spec.turnRatePerS * dt);
      moved += actual;
      budget -= stepLen;
      if (stepLen >= dd - 1e-6) h.path.shift();
      if (actual < stepLen * 0.3) break;
    }
    h.speed = moved / Math.max(1e-6, dt);
    if (t - this.stuckRefT >= 1.5) {
      const progressed = Math.hypot(h.x - this.stuckRefX, h.z - this.stuckRefZ);
      this.stuckRefX = h.x;
      this.stuckRefZ = h.z;
      this.stuckRefT = t;
      if (progressed < 0.3 && speed > 0.3) {
        h.path = [];
        this.planGoal = null;
        if (!chasing) return true;
      }
    }
    if (h.path.length === 0 && Math.hypot(goal.x - h.x, goal.z - h.z) <= arrive + 0.3) return true;
    return false;
  }
}

/**
 * Plausible spots around `center` a hiding player would use: near-side stand points of hiding spots (hidingSafeM out,
 * so the sweep itself never reveals a properly hidden player) and flank points looking at the hiding place behind each
 * cover piece (as seen from the centre). Snapped to the searcher's component, never within hidingSafeM of any hiding
 * spot, deduplicated (2 m), nearest-first greedy order from `from`, at most `maxSpots`.
 */
export function planSearchSpots(
  ctx: SimContext, nav: NavGrid, from: Vec2, center: Vec2, radiusM: number, maxSpots: number, accept?: (p: Vec2) => boolean,
): SearchSpot[] {
  const R = radiusM;
  const comp = nav.componentAt(from, 2);
  const ok = (p: Vec2) => !nearHiding(ctx.map, p) && (!accept || accept(p));
  const cands: SearchSpot[] = [];
  for (const s of ctx.map.hidingSpots) {
    const d = Math.hypot(s.x - center.x, s.z - center.z);
    if (d > R + s.radius) continue;
    let dx = center.x - s.x;
    let dz = center.z - s.z;
    let l = Math.hypot(dx, dz);
    if (l < 0.3) {
      dx = from.x - s.x;
      dz = from.z - s.z;
      l = Math.hypot(dx, dz);
    }
    if (l < 1e-6) continue;
    const away = hidingSafeM(s) + 0.1;
    const want = { x: s.x + (dx / l) * away, z: s.z + (dz / l) * away };
    const at = nav.nearestWalkable(want, 1.5, comp);
    if (at && ok(at)) cands.push({ at, look: { x: s.x, z: s.z } });
  }
  for (const c of ctx.map.cover) {
    const d = Math.hypot(c.x - center.x, c.z - center.z);
    if (d > R || d < 0.3) continue;
    const ux = (c.x - center.x) / d;
    const uz = (c.z - center.z) / d;
    const behind = { x: c.x + ux * (c.radius + 0.8), z: c.z + uz * (c.radius + 0.8) }; // where a crouching player would be
    for (const side of [1, -1]) {
      const want = { x: behind.x - uz * side * 2.5, z: behind.z + ux * side * 2.5 }; // flank point
      const at = nav.nearestWalkable(want, 1.0, comp);
      if (!at || !ok(at) || Math.hypot(at.x - behind.x, at.z - behind.z) < 1.5) continue;
      if (!ctx.world.lineOfSight(at.x, at.z, behind.x, behind.z, true)) continue;
      cands.push({ at, look: behind });
      break;
    }
  }
  const unique: SearchSpot[] = [];
  for (const c of cands) if (!unique.some((u) => Math.hypot(u.at.x - c.at.x, u.at.z - c.at.z) < 2)) unique.push(c);
  const out: SearchSpot[] = [];
  let at: Vec2 = { x: from.x, z: from.z };
  while (unique.length && out.length < maxSpots) {
    let bi = 0;
    for (let i = 1; i < unique.length; i++) if (dist(unique[i].at, at) < dist(unique[bi].at, at)) bi = i;
    const next = unique.splice(bi, 1)[0];
    out.push(next);
    at = next.at;
  }
  return out;
}

/** A random wander point within radiusM of `center`, never within hidingSafeM of a hiding spot (6 seeded tries). */
export function pickSearchPoint(
  ctx: SimContext, nav: NavGrid, rng: Rng, from: Vec2, center: Vec2, radiusM: number, accept?: (p: Vec2) => boolean,
): Vec2 {
  const c = center;
  const comp = nav.componentAt(from, 2);
  // random wander points, never within hidingSafeM of a hiding spot: searching never drags a hidden player out
  for (let i = 0; i < 6; i++) {
    const a = rng.range(-Math.PI, Math.PI);
    const r = rng.range(1.5, radiusM);
    const cand = nav.nearestWalkable({ x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r }, 2, comp);
    if (cand && !nearHiding(ctx.map, cand) && (!accept || accept(cand))) return cand;
  }
  return nav.nearestWalkable(c, 4, comp) ?? { x: from.x, z: from.z };
}
