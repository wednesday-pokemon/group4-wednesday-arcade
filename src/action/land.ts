// Land masses (shore, islet, reef) as solid CCW polygons in the XZ plane. The two hull circles are pushed out of
// any polygon they overlap; the boat then slides along the shoreline with a per-second drag proportional to how
// directly the bow points into it (same feel as the course boundary) while the bow yaws toward the shoreline tangent
// (slide assist, LAND.slideAlignRadPerS), so it glides along instead of grinding. Shores and islets never damage; reefs give a
// light scrape on fast head-on hits only. At the fixed 120 Hz step the boat moves ≤ 0.15 u per step even at the
// boosted cap, far less than the hull radius, so it cannot tunnel through land of any thickness.
import { LAND } from './config.ts';
import { hullCircles, type ImpactHook } from './collision.ts';
import { forwardVector } from './rowing.ts';
import type { BoatState, LandMass, Vec2 } from './types.ts';

interface Bbox { minX: number; maxX: number; minZ: number; maxZ: number }
const bboxCache = new WeakMap<LandMass, Bbox>();

function bboxOf(land: LandMass): Bbox {
  let b = bboxCache.get(land);
  if (!b) {
    b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const p of land.points) {
      b.minX = Math.min(b.minX, p.x);
      b.maxX = Math.max(b.maxX, p.x);
      b.minZ = Math.min(b.minZ, p.z);
      b.maxZ = Math.max(b.maxZ, p.z);
    }
    bboxCache.set(land, b);
  }
  return b;
}

/** Even-odd ray cast (works for any simple polygon, either winding). */
export function pointInPolygon(x: number, z: number, pts: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Closest point on the polygon outline to (x, z). */
export function closestOnOutline(x: number, z: number, pts: readonly Vec2[]): { x: number; z: number; d: number } {
  let best = { x: pts[0].x, z: pts[0].z, d: Infinity };
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j];
    const b = pts[i];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len2 = ex * ex + ez * ez;
    const u = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / len2)) : 0;
    const px = a.x + ex * u;
    const pz = a.z + ez * u;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { x: px, z: pz, d };
  }
  return best;
}

export interface CirclePolyContact { nx: number; nz: number; depth: number }

/** Circle vs polygon: outward normal (from land toward the circle) and penetration depth, or null. */
export function circleVsPolygon(cx: number, cz: number, r: number, land: LandMass): CirclePolyContact | null {
  const b = bboxOf(land);
  if (cx + r < b.minX || cx - r > b.maxX || cz + r < b.minZ || cz - r > b.maxZ) return null;
  const inside = pointInPolygon(cx, cz, land.points);
  const q = closestOnOutline(cx, cz, land.points);
  if (!inside && q.d >= r) return null;
  if (q.d < 1e-9) return null; // exactly on the outline: resolved next step
  const sx = (cx - q.x) / q.d;
  const sz = (cz - q.z) / q.d;
  return inside ? { nx: -sx, nz: -sz, depth: q.d + r } : { nx: sx, nz: sz, depth: r - q.d };
}

/** True if a circle of radius r at (x, z) overlaps any land (used by tests, autopilots and spawn checks). */
export function circleHitsLand(x: number, z: number, r: number, lands: readonly LandMass[]): boolean {
  return lands.some((l) => circleVsPolygon(x, z, r, l) !== null);
}

export interface LandMemory { touching: Map<string, number>; cooldowns: Map<string, number> }
export function createLandMemory(): LandMemory {
  return { touching: new Map(), cooldowns: new Map() };
}

export interface LandHit { land: LandMass; damage: number; impactSpeed: number; absorbed: boolean }

const CONTACT_GAP_S = 0.05;

/**
 * Pushes the hull out of every overlapping land mass (two relaxation passes for corners where shores meet), bleeds
 * speed by how directly the bow points in, and reports fresh impacts (reef damage or 0-damage shore bumps).
 */
export function resolveLand(
  boat: BoatState, lands: readonly LandMass[], memory: LandMemory, damageTaken: number, t: number, dt: number,
  hook?: ImpactHook,
): LandHit[] {
  const hits: LandHit[] = [];
  if (!lands.length) return hits;
  let maxHeadOn = 0;
  let pressN: { nx: number; nz: number } | null = null; // normal of the most head-on contact this step
  const touched = new Map<LandMass, number>(); // land → head-on factor at first contact this step
  for (let pass = 0; pass < 2; pass++) {
    for (const land of lands) {
      let best: CirclePolyContact | null = null;
      for (const h of hullCircles(boat)) {
        const c = circleVsPolygon(h.x, h.z, h.r, land);
        if (c && (!best || c.depth > best.depth)) best = c;
      }
      if (!best) continue;
      boat.x += best.nx * best.depth;
      boat.z += best.nz * best.depth;
      const f = forwardVector(boat.heading);
      const headOn = Math.max(0, -(f.x * best.nx + f.z * best.nz));
      if (headOn > maxHeadOn || !pressN) pressN = { nx: best.nx, nz: best.nz };
      maxHeadOn = Math.max(maxHeadOn, headOn);
      if (!touched.has(land)) touched.set(land, headOn);
    }
  }
  for (const [land, headOn] of touched) {
    const last = memory.touching.get(land.id) ?? -Infinity;
    memory.touching.set(land.id, t);
    if (t - last <= CONTACT_GAP_S) {
      const readyAt = memory.cooldowns.get(land.id) ?? -Infinity;
      if (readyAt > t) memory.cooldowns.set(land.id, Math.max(readyAt, t + LAND.reefCooldownS));
      continue;
    }
    const impactSpeed = boat.speed * headOn;
    const reefHit = land.kind === 'reef' && headOn >= LAND.reefMinHeadOn && impactSpeed >= LAND.reefMinSpeed;
    const canDamage = reefHit && t >= (memory.cooldowns.get(land.id) ?? -Infinity) && t >= boat.invulnerableUntil;
    const policy = hook?.({ id: land.id, kind: 'land', impactSpeed, headOn, canDamage });
    // a fresh bump also takes a share of the speed (head-on only), so shores feel solid without hurting
    boat.speed *= 1 - 0.5 * headOn * headOn * (policy ? policy.speedLossMult : 1);
    if (canDamage) {
      const mult = policy ? policy.damageMult : 1;
      const absorbed = mult <= 0;
      const damage = absorbed ? 0 : Math.max(1, Math.round(LAND.reefDamage * Math.min(1.2, impactSpeed / 9) * damageTaken * mult));
      boat.hp = Math.max(0, boat.hp - damage);
      boat.invulnerableUntil = t + 0.6;
      memory.cooldowns.set(land.id, t + LAND.reefCooldownS);
      hits.push({ land, damage, impactSpeed, absorbed });
    } else if (impactSpeed >= LAND.bumpEventSpeed) {
      hits.push({ land, damage: 0, impactSpeed, absorbed: false });
    }
  }
  if (maxHeadOn > 0) {
    boat.speed *= Math.exp(-LAND.wallDragPerS * maxHeadOn * dt);
    if (pressN) alignAlongShore(boat, pressN.nx, pressN.nz, maxHeadOn, dt);
  }
  return hits;
}

/**
 * Slide assist: yaw the bow toward the shoreline tangent (whichever side it already leans to) at
 * LAND.slideAlignRadPerS × sin(approach angle). A perfectly head-on push has no preferred side and is left alone.
 */
function alignAlongShore(boat: BoatState, nx: number, nz: number, headOn: number, dt: number): void {
  const sinAngle = Math.sqrt(Math.max(0, 1 - headOn * headOn));
  if (sinAngle < 1e-3) return;
  // d(headOn)/d(heading) for forward = (−sin h, −cos h): turning against its sign reduces how hard the bow pushes in
  const slope = Math.cos(boat.heading) * nx - Math.sin(boat.heading) * nz;
  if (Math.abs(slope) < 1e-9) return;
  boat.heading -= Math.sign(slope) * Math.min(LAND.slideAlignRadPerS * sinAngle * dt, Math.asin(Math.min(1, headOn)));
}
