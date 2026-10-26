// Rescue window rules (GDD 6), as a pure function so the outcome table is testable on its own.
//   Q within the clean-escape window with the ability ready → clean_escape: NOT counted (max 1 per run); the
//     Pokémon's rescue effect also applies.
//   Q later in the window with the ability ready → rescued: counted; rescue flags apply (negateDamage, pushHydeBackM).
//   No Q / ability not ready → caught: counted, full hull damage.
//   SPACE presses always help: −6 % hull damage each (max −48 %), +0.5 u knockback each (max +4 u).
import { STAGE_TUNING } from './data/stages.ts';
import type { PokemonAbilityDef, RescueOutcome } from './types.ts';

export interface RescueResolutionInput {
  qUsed: boolean; // Q pressed with the ability rescue-ready
  qAtRealS: number; // real seconds into the window when Q was pressed
  cleanEscapeWindowS: number; // incl. trait bonus
  cleanEscapesLeft: number;
  rescue: PokemonAbilityDef['rescue'];
  strugglePresses: number;
  baseDamage: number; // catch hull damage before reductions
  hullMult: number; // egg_protection etc.
  baseKnockbackU: number; // postCatchGapU + trait bonus
}

export interface RescueResolution { outcome: Exclude<RescueOutcome, 'pending'>; counted: boolean; damage: number; knockbackU: number }

export function resolveRescue(i: RescueResolutionInput): RescueResolution {
  const r = STAGE_TUNING.rescue;
  const struggleCut = Math.min(r.struggleMaxReduction, i.strugglePresses * r.struggleReductionPerPress);
  const struggleKnock = Math.min(r.struggleMaxKnockbackU, i.strugglePresses * r.struggleKnockbackPerPressU);
  const full = i.baseDamage * i.hullMult * (1 - struggleCut);
  if (!i.qUsed) return { outcome: 'caught', counted: true, damage: Math.round(full), knockbackU: i.baseKnockbackU + struggleKnock };
  const clean = i.qAtRealS <= i.cleanEscapeWindowS && i.cleanEscapesLeft > 0;
  return {
    outcome: clean ? 'clean_escape' : 'rescued',
    counted: !clean,
    damage: i.rescue.negateDamage ? 0 : Math.round(full),
    knockbackU: i.baseKnockbackU + i.rescue.pushHydeBackM + struggleKnock,
  };
}
