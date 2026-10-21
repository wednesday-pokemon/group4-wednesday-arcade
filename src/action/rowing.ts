// Rowing physics + stamina. Functions mutate the BoatState passed in (hot path, 120 Hz) and are otherwise pure.
import type { BoatState, RowingConfig } from './types.ts';
import type { StatMultipliers } from './characterStats.ts';
import { ROWING_EXTRAS } from './data/stages.ts';

export interface RowingModifiers extends StatMultipliers {
  /** Temporary multiplier on top speed (e.g. Pokémon speed boost); 1 = none. */
  speedBoost: number;
  /** Multiplier on stroke stamina cost; 1 = none. */
  staminaCost: number;
  /** Additive top-speed raise in u/s (speed_boost abilities, passives); default 0. */
  topSpeedBonus?: number;
  /** Drag multiplier while coasting (no accepted stroke for `coastAfterS`); default 1. */
  coastDragMult?: number;
  coastAfterS?: number;
}

/** Boost leftovers above the speed cap bleed off at this rate (GDD 2.1) instead of being clipped instantly. */
export const OVER_CAP_DECAY_PER_S = ROWING_EXTRAS.overCapDecayPerS;

export function createBoatState(x: number, z: number, heading: number, maxHp: number, maxStamina: number): BoatState {
  return {
    x, z, heading, speed: 0, turnRate: 0, hp: maxHp, maxHp, stamina: maxStamina, maxStamina,
    lastStrokeAt: -Infinity, strokeCount: 0, missedStrokes: 0, invulnerableUntil: 0,
  };
}

export function topSpeed(mods: RowingModifiers, cfg: RowingConfig): number {
  return cfg.maxSpeed * mods.topSpeed * mods.speedBoost + (mods.topSpeedBonus ?? 0);
}

/** Stroke effectiveness from stamina: full above the low threshold, falling linearly to the floor at 0. */
export function staminaEffectiveness(boat: BoatState, cfg: RowingConfig): number {
  const fraction = boat.stamina / boat.maxStamina;
  if (fraction >= cfg.lowStaminaThreshold) return 1;
  return cfg.lowStaminaFloor + (1 - cfg.lowStaminaFloor) * (fraction / cfg.lowStaminaThreshold);
}

export interface StrokeResult { accepted: boolean; power: number }

export interface StrokeExtras { impulseMult: number; costMult: number }
const NO_EXTRAS: StrokeExtras = { impulseMult: 1, costMult: 1 };

/** One SPACE press. Rejected (missed) if it comes faster than the cadence cap. */
export function applyStroke(boat: BoatState, mods: RowingModifiers, cfg: RowingConfig, t: number, extras: StrokeExtras = NO_EXTRAS): StrokeResult {
  if (t - boat.lastStrokeAt < cfg.minStrokeIntervalS) {
    boat.missedStrokes++;
    return { accepted: false, power: 0 };
  }
  const vmax = topSpeed(mods, cfg);
  const headroom = Math.max(0, 1 - (boat.speed / vmax) ** 2); // diminishing returns near max speed
  const power = cfg.baseImpulse * mods.power * staminaEffectiveness(boat, cfg) * extras.impulseMult;
  if (boat.speed < vmax) boat.speed = Math.min(vmax, boat.speed + power * headroom);
  boat.stamina = Math.max(0, boat.stamina - cfg.strokeStaminaCost * mods.staminaCost * extras.costMult);
  boat.lastStrokeAt = t;
  boat.strokeCount++;
  return { accepted: true, power: power * headroom };
}

export interface SteerInput { forward: boolean; left: boolean; right: boolean; brake: boolean }

/** Integrates drag, W glide, S brake, steering, stamina recovery and position over dt seconds. */
export function integrateBoat(
  boat: BoatState, input: SteerInput, mods: RowingModifiers, cfg: RowingConfig, dt: number, t: number,
  push: { x: number; z: number } = { x: 0, z: 0 },
): void {
  const vmax = topSpeed(mods, cfg);
  // W: gentle glide toward a cruising speed (costs a little stamina, never exceeds cruise speed by itself).
  if (input.forward && boat.speed < cfg.cruiseSpeed && boat.stamina > 0) {
    boat.speed = Math.min(cfg.cruiseSpeed, boat.speed + cfg.cruiseAccel * mods.power * dt);
    boat.stamina = Math.max(0, boat.stamina - cfg.cruiseStaminaPerS * dt);
  }
  const coasting = t - boat.lastStrokeAt >= (mods.coastAfterS ?? Infinity);
  const coastMult = coasting ? (mods.coastDragMult ?? 1) : 1;
  const drag = cfg.drag * coastMult + (input.brake ? cfg.brakeDrag : 0);
  boat.speed *= Math.exp(-drag * dt); // exact exponential decay → frame-rate independent
  boat.speed = Math.max(0, boat.speed - cfg.linearDrag * coastMult * dt);
  if (boat.speed > vmax) boat.speed = Math.max(vmax, boat.speed - OVER_CAP_DECAY_PER_S * dt);

  const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const authority = cfg.steerMinAuthority + (1 - cfg.steerMinAuthority) * Math.min(1, boat.speed / 4);
  const targetTurn = steer * cfg.steerRate * mods.handling * authority;
  boat.turnRate += (targetTurn - boat.turnRate) * (1 - Math.exp(-8 * dt));
  boat.heading += boat.turnRate * dt;

  const idle = t - boat.lastStrokeAt;
  const regen = cfg.staminaRegenPerS * (idle >= cfg.regenDelayS ? 2 : 1) * mods.staminaRegen;
  boat.stamina = Math.min(boat.maxStamina, boat.stamina + regen * dt);

  boat.x += (-Math.sin(boat.heading) * boat.speed + push.x) * dt;
  boat.z += (-Math.cos(boat.heading) * boat.speed + push.z) * dt;
}

export function forwardVector(heading: number): { x: number; z: number } {
  return { x: -Math.sin(heading), z: -Math.cos(heading) };
}
