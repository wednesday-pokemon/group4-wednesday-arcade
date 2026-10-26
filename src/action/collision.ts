// XZ-plane collisions between the two-circle hull and circle/capsule obstacles, with fair damage rules:
// per-obstacle cooldown, short global invulnerability, damage scaled by impact speed and angle.
import { BOAT, COLLISION } from './config.ts';
import { forwardVector } from './rowing.ts';
import type { BoatState, CourseDef, Obstacle } from './types.ts';

export interface Contact { obstacle: Obstacle; nx: number; nz: number; depth: number }

/**
 * Obstacle position at time t. Drifting obstacles oscillate along `drift.axisAngle` (heading convention, so the
 * axis is (−sin a, −cos a)); without an axis they slide sideways along X as in Phase 1.
 */
export function obstaclePosition(o: Obstacle, t: number): { x: number; z: number } {
  if (!o.drift) return { x: o.x, z: o.z };
  const offset = o.drift.amplitude * Math.sin((t / o.drift.periodS) * Math.PI * 2 + o.drift.phase);
  if (o.drift.axisAngle === undefined) return { x: o.x + offset, z: o.z };
  return { x: o.x - Math.sin(o.drift.axisAngle) * offset, z: o.z - Math.cos(o.drift.axisAngle) * offset };
}

/** Closest point on the obstacle's core segment (a point for circles). */
function closestCorePoint(o: Obstacle, px: number, pz: number, t: number): { x: number; z: number } {
  const c = obstaclePosition(o, t);
  if (o.halfLength <= 0) return c;
  const ax = -Math.sin(o.angle);
  const az = -Math.cos(o.angle);
  const along = Math.max(-o.halfLength, Math.min(o.halfLength, (px - c.x) * ax + (pz - c.z) * az));
  return { x: c.x + ax * along, z: c.z + az * along };
}

export function hullCircles(boat: BoatState): { x: number; z: number; r: number }[] {
  const f = forwardVector(boat.heading);
  return BOAT.hullCircles.map((c) => ({ x: boat.x + f.x * c.offset, z: boat.z + f.z * c.offset, r: c.radius }));
}

export function findContacts(boat: BoatState, obstacles: Obstacle[], t: number): Contact[] {
  const contacts: Contact[] = [];
  const hull = hullCircles(boat);
  for (const o of obstacles) {
    let best: Contact | null = null;
    for (const h of hull) {
      const p = closestCorePoint(o, h.x, h.z, t);
      const dx = h.x - p.x;
      const dz = h.z - p.z;
      const dist = Math.hypot(dx, dz);
      const depth = o.radius + h.r - dist;
      if (depth > 0 && (!best || depth > best.depth)) {
        best = { obstacle: o, nx: dist > 1e-6 ? dx / dist : 0, nz: dist > 1e-6 ? dz / dist : 1, depth };
      }
    }
    if (best) contacts.push(best);
  }
  return contacts;
}

export interface Hit { obstacle: Obstacle; damage: number; impactSpeed: number; absorbed: boolean; headOn: number }

/** What a fresh impact looks like to the rules layer (traits, abilities). */
export interface ImpactInfo { id: string; kind: Obstacle['kind'] | 'land'; impactSpeed: number; headOn: number; canDamage: boolean }

/**
 * How the rules layer modifies a fresh impact. `damageMult` 0 = absorbed (the hit still counts for cooldowns).
 * `speedLossMult` scales the angle-based speed cut; `minRetain` is a floor on the speed kept.
 * `pass` = the obstacle is cut/shoved and the boat goes straight through (no speed loss, no damage).
 */
export interface ImpactPolicy { damageMult: number; speedLossMult: number; minRetain: number; pass?: boolean }
export type ImpactHook = (info: ImpactInfo) => ImpactPolicy;
export const DEFAULT_POLICY: ImpactPolicy = { damageMult: 1, speedLossMult: 1, minRetain: 0 };

/** Per-session collision memory: damage cooldowns and which obstacles were touching last step. */
export interface CollisionMemory { cooldowns: Map<string, number>; touching: Map<string, number> }

export function createCollisionMemory(): CollisionMemory {
  return { cooldowns: new Map(), touching: new Map() };
}

const CONTACT_GAP_S = 0.05; // a contact that lapses longer than this counts as a fresh impact

/**
 * Impact (first touch of an obstacle): one speed cut scaled by angle, damage once per cooldown window, and a small
 * deflection off the obstacle. Sustained contact only bleeds speed per second by how directly the bow pushes into
 * it, so the player can always turn and slide free. Mutates `boat` and `memory`.
 */
export function resolveCollisions(
  boat: BoatState, contacts: Contact[], memory: CollisionMemory, damageTaken: number, t: number, dt: number,
  hook?: ImpactHook,
): Hit[] {
  const hits: Hit[] = [];
  for (const c of contacts) {
    const f = forwardVector(boat.heading);
    const headOn = Math.max(0, -(f.x * c.nx + f.z * c.nz)); // 1 = straight into it, 0 = scraping alongside
    const lastTouchPeek = memory.touching.get(c.obstacle.id) ?? -Infinity;
    if (hook && t - lastTouchPeek > CONTACT_GAP_S) {
      // Fresh impact: the rules layer may let the boat pass straight through (cut / shoved obstacles).
      const readyAtPeek = memory.cooldowns.get(c.obstacle.id) ?? -Infinity;
      const impactSpeedPeek = boat.speed * Math.max(COLLISION.minImpactFactor, headOn);
      const canDamagePeek = t >= readyAtPeek && t >= boat.invulnerableUntil && impactSpeedPeek >= 0.3;
      const policy = hook({ id: c.obstacle.id, kind: c.obstacle.kind, impactSpeed: impactSpeedPeek, headOn, canDamage: canDamagePeek });
      if (policy.pass) {
        hits.push({ obstacle: c.obstacle, damage: 0, impactSpeed: impactSpeedPeek, absorbed: true, headOn });
        continue;
      }
      resolveOne(boat, c, memory, damageTaken, t, dt, headOn, policy, hits);
      continue;
    }
    resolveOne(boat, c, memory, damageTaken, t, dt, headOn, DEFAULT_POLICY, hits);
  }
  return hits;
}

function resolveOne(
  boat: BoatState, c: Contact, memory: CollisionMemory, damageTaken: number, t: number, dt: number, headOn: number,
  policy: ImpactPolicy, hits: Hit[],
): void {
  const f = forwardVector(boat.heading);
  boat.x += c.nx * c.depth;
  boat.z += c.nz * c.depth;
  const lastTouch = memory.touching.get(c.obstacle.id) ?? -Infinity;
  memory.touching.set(c.obstacle.id, t);
  if (t - lastTouch <= CONTACT_GAP_S) {
    boat.speed *= Math.exp(-COLLISION.contactDragPerS * headOn * dt);
    // scraping along the same obstacle keeps its damage cooldown alive: only a genuinely new impact can hurt
    const readyAt = memory.cooldowns.get(c.obstacle.id) ?? -Infinity;
    if (readyAt > t) memory.cooldowns.set(c.obstacle.id, Math.max(readyAt, t + COLLISION.perObstacleCooldownS));
    return;
  }
  const factor = Math.max(COLLISION.minImpactFactor, headOn);
  const impactSpeed = boat.speed * factor;
  const retain = Math.max(policy.minRetain, 1 - COLLISION.speedLossHeadOn * factor * policy.speedLossMult);
  boat.speed *= Math.min(1, retain);
  const side = Math.sign(f.x * c.nz - f.z * c.nx) || 1; // which way the normal turns the bow
  boat.heading -= side * COLLISION.deflectRad * (1 - headOn * 0.5);
  const readyAt = memory.cooldowns.get(c.obstacle.id) ?? -Infinity;
  if (t < readyAt || t < boat.invulnerableUntil || impactSpeed < 0.3) return;
  const scale = Math.max(COLLISION.minDamageFraction, Math.min(1.2, impactSpeed / COLLISION.referenceSpeed));
  const absorbed = policy.damageMult <= 0;
  const damage = absorbed ? 0 : Math.max(1, Math.round(c.obstacle.damage * scale * damageTaken * policy.damageMult));
  boat.hp = Math.max(0, boat.hp - damage);
  boat.invulnerableUntil = t + COLLISION.invulnerableS;
  memory.cooldowns.set(c.obstacle.id, t + COLLISION.perObstacleCooldownS);
  hits.push({ obstacle: c.obstacle, damage, impactSpeed, absorbed, headOn });
}

/**
 * Soft course boundary: the boat slides along the shore. Speed bleeds only in proportion to how directly it is
 * pushing into the edge (per second, so it is frame-rate independent). Never damages. Returns true if scraping.
 */
export function clampToBounds(boat: BoatState, bounds: CourseDef['bounds'], dt: number): boolean {
  const x = Math.max(bounds.minX, Math.min(bounds.maxX, boat.x));
  const z = Math.max(bounds.minZ, Math.min(bounds.maxZ, boat.z));
  if (x === boat.x && z === boat.z) return false;
  const f = forwardVector(boat.heading);
  const outward = Math.max(Math.abs(boat.x - x) > 0 ? Math.abs(f.x) : 0, Math.abs(boat.z - z) > 0 ? Math.abs(f.z) : 0);
  boat.x = x;
  boat.z = z;
  boat.speed *= Math.exp(-COLLISION.wallDragPerS * outward * dt);
  return true;
}
