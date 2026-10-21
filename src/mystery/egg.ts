// The physical Pokémon egg: tier drawn from the seed (weights from tuning), carried / dropped / retrieved / delivered.
// Security (0–100, never below 0 — the egg never breaks) drops on grabs and hard impacts (× eggSecurityLossMult × active
// egg shield). A landed (unblocked) grab always knocks the egg out of the player's hands; after any loss, security ≤
// dropThreshold also drops it. Forced drops are loud (noise.eggDrop); setting it down with a held E is quiet
// (noise.eggSetDown). Dropped eggs are clamped to a nav cell connected to the tower on the gate-closed grid, so the egg
// can never end up unreachable (no softlock).
import type { SimTuning } from './config.ts';
import type { SimContext } from './context.ts';
import { eggTierForSeed } from './scoring.ts';
import type { EggRuntime, MapDef, Vec2 } from './types.ts';

export function createEgg(map: MapDef, seed: string, tuning: SimTuning): EggRuntime {
  const tier = eggTierForSeed(seed, tuning.egg.tierWeights);
  return { tier, points: tuning.egg.points[tier], security: 100, state: 'resting', x: map.eggSpawn.x, z: map.eggSpawn.z };
}

/** Multiplier on any security loss right now: passive mods × (1 − egg shield magnitude while active). */
export function eggLossMult(ctx: SimContext): number {
  const shield = ctx.t < ctx.fx.eggShieldUntil ? Math.max(0, Math.min(1, ctx.fx.eggShieldMag)) : 0;
  return ctx.mods.eggSecurityLossMult * (1 - shield);
}

/** Applies a security loss and emits `egg_damage`. Returns the amount actually lost (rounded to 0.1). */
export function damageEgg(ctx: SimContext, base: number, cause: 'grab' | 'impact' | 'drop'): number {
  const egg = ctx.egg;
  const amount = Math.min(egg.security, Math.round(base * eggLossMult(ctx) * 10) / 10);
  if (amount <= 0) return 0;
  egg.security = Math.max(0, Math.round((egg.security - amount) * 10) / 10);
  ctx.emit({ type: 'egg_damage', amount, cause, security: egg.security });
  return amount;
}

/**
 * A point near `p` where a dropped egg can rest: walkable for the player AND in the tower's connected component on the
 * gate-closed grid (so it stays reachable even if a timed gate shuts).
 */
export function safeEggPoint(ctx: SimContext, p: Vec2): Vec2 {
  const nav = ctx.playerNav(true);
  const towerComp = nav.componentAt(ctx.map.tower, ctx.map.tower.radius + 2);
  const q = towerComp >= 0 ? nav.nearestWalkable(p, 30, towerComp) : nav.nearestWalkable(p, 30);
  return q ?? { x: ctx.map.eggSpawn.x, z: ctx.map.eggSpawn.z };
}

export function dropEgg(ctx: SimContext, reason: 'manual' | 'impact' | 'grab'): void {
  const egg = ctx.egg;
  if (egg.state !== 'carried') return;
  const at = safeEggPoint(ctx, ctx.player);
  egg.state = 'dropped';
  egg.x = at.x;
  egg.z = at.z;
  ctx.emit({ type: 'egg_drop', reason, security: egg.security });
  const loud = reason === 'manual' ? ctx.tuning.noise.eggSetDown : ctx.tuning.noise.eggDrop;
  ctx.noise('egg_drop', egg.x, egg.z, loud);
}

export function pickUpEgg(ctx: SimContext): void {
  const egg = ctx.egg;
  if (egg.state !== 'resting' && egg.state !== 'dropped') return;
  egg.state = 'carried';
  egg.x = ctx.player.x;
  egg.z = ctx.player.z;
  ctx.emit({ type: 'egg_pickup' });
  ctx.noise('interact', ctx.player.x, ctx.player.z, ctx.tuning.noise.eggPickup);
}

/** Deposit at the tower. Idempotent: only the first call while carrying does anything. Returns true if delivered. */
export function deliverEgg(ctx: SimContext): boolean {
  const egg = ctx.egg;
  if (egg.state !== 'carried') return false;
  egg.state = 'delivered';
  egg.x = ctx.map.tower.x;
  egg.z = ctx.map.tower.z;
  ctx.emit({ type: 'egg_delivered', tier: egg.tier, points: egg.points, security: egg.security });
  ctx.noise('interact', ctx.map.tower.x, ctx.map.tower.z, ctx.tuning.noise.deposit);
  return true;
}

/** A hard impact while carrying: security loss, impact noise, and a drop once security is below the threshold. */
export function eggImpact(ctx: SimContext): void {
  if (ctx.egg.state !== 'carried') return;
  damageEgg(ctx, ctx.tuning.egg.impactLoss, 'impact');
  ctx.noise('impact', ctx.player.x, ctx.player.z, ctx.tuning.noise.impact);
  if (ctx.egg.security <= ctx.tuning.egg.dropThreshold) dropEgg(ctx, 'impact');
}

export function inTower(map: MapDef, p: Vec2): boolean {
  return Math.hypot(p.x - map.tower.x, p.z - map.tower.z) <= map.tower.radius;
}
