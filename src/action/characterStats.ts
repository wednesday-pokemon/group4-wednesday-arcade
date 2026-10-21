// Converts 1–10 character ratings into physics multipliers (rating 5 = neutral 1.0) using the designer's
// STAGE_TUNING.statScaling, and registers every character's ratings from CHARACTER_ACTION_DEFS.
import type { CharacterId } from '../game/types.ts';
import { BOAT } from './config.ts';
import { CHARACTER_ACTION_DEFS } from './data/characters.ts';
import { STAGE_TUNING } from './data/stages.ts';
import type { CharacterActionDef, CharacterStats } from './types.ts';

export const NEUTRAL_STATS: CharacterStats = { rowingPower: 5, topSpeed: 5, stamina: 5, handling: 5, defense: 5 };

export interface StatMultipliers {
  power: number; // × stroke impulse (and W glide acceleration)
  topSpeed: number; // × max speed
  maxStamina: number; // absolute max stamina
  staminaRegen: number; // × stamina recovery
  handling: number; // × steering rate
  glancingDeg: number; // approach angle (deg) at or below which a hit is glancing (less damage, keeps speed)
  damageTaken: number; // × collision damage
}

export function statMultipliers(s: CharacterStats): StatMultipliers {
  const k = STAGE_TUNING.statScaling;
  const d = (r: number) => r - k.neutralRating;
  return {
    power: 1 + k.rowingPowerPerPoint * d(s.rowingPower),
    topSpeed: 1 + k.topSpeedPerPoint * d(s.topSpeed),
    maxStamina: BOAT.baseMaxStamina * (1 + k.staminaMaxPerPoint * d(s.stamina)),
    staminaRegen: 1 + k.staminaRegenPerPoint * d(s.stamina),
    handling: 1 + k.handlingSteerPerPoint * d(s.handling),
    glancingDeg: STAGE_TUNING.collision.glancingAngleDeg + k.handlingGlancingDegPerPoint * d(s.handling),
    damageTaken: Math.max(0.2, 1 - k.defenseReductionPerPoint * d(s.defense)),
  };
}

let table: Partial<Record<CharacterId, CharacterStats>> = {};
let defs: Partial<Record<CharacterId, CharacterActionDef>> = {};

export function registerCharacterStats(entries: { id: CharacterId; stats: CharacterStats }[]): void {
  table = Object.fromEntries(entries.map((e) => [e.id, e.stats]));
}

/** Registered once at module load from the designer data; tests may re-register custom tables. */
registerCharacterStats(CHARACTER_ACTION_DEFS);
defs = Object.fromEntries(CHARACTER_ACTION_DEFS.map((d) => [d.id, d]));

export function statsFor(id: CharacterId | null | undefined): CharacterStats {
  return (id && table[id]) || NEUTRAL_STATS;
}

export function characterDefFor(id: CharacterId): CharacterActionDef {
  const def = defs[id];
  if (!def) throw new Error(`unknown character ${id}`);
  return def;
}
