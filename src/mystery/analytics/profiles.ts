// Seeded behaviour profiles for simulated episodes (data generation and tests). Six families cycle per duo so every
// one of the 126 duos gets the same mix: stealthy, stealthy + abilities, light / heavy sprinters, a mixed "visitor"
// and a semi-careful careless player. Knobs inside a family are drawn from Rng(seed, 'profile').
import type { BotOptions } from '../bot.ts';
import { Rng } from '../rng.ts';

export const PROFILE_FAMILIES = ['stealthy', 'stealthy_abilities', 'sprinter_light', 'sprinter_heavy', 'mixed', 'semi_careful'] as const;
export type ProfileFamily = (typeof PROFILE_FAMILIES)[number];

export function profileFor(seed: string, k: number): { family: ProfileFamily; options: BotOptions } {
  const family = PROFILE_FAMILIES[k % PROFILE_FAMILIES.length];
  const r = new Rng(seed, 'profile');
  const common: Partial<BotOptions> = {
    startDelayMaxS: Math.round(r.range(0, 25)),
    accuse: r.chance(0.8) ? 'deduce' : 'guess',
    clueOrder: r.chance(0.7) ? 'nearest' : 'shuffle',
    decisionHz: r.pick([6, 8, 10]),
    maxTimeS: 600,
  };
  let options: BotOptions;
  switch (family) {
    case 'stealthy':
      options = { profile: 'stealthy', ...common };
      break;
    case 'stealthy_abilities':
      options = { profile: 'stealthy', ...common, useAbilities: true, crouchNearHydeM: Math.round(r.range(8, 16)) };
      break;
    case 'sprinter_light':
      options = { profile: 'careless', ...common, sprintProb: Math.round(r.range(0.15, 0.4) * 100) / 100, useAbilities: r.chance(0.5) };
      break;
    case 'sprinter_heavy':
      options = { profile: 'careless', ...common, sprintProb: Math.round(r.range(0.55, 0.85) * 100) / 100, useAbilities: r.chance(0.5) };
      break;
    case 'mixed':
      options = {
        profile: 'stealthy', ...common, sprintProb: Math.round(r.range(0.05, 0.35) * 100) / 100, crouchNearHydeM: r.pick([0, 6, 10]),
        crouchAtSuspicion: r.pick([0.15, 0.4, 2]), hide: r.chance(0.5), useAbilities: r.chance(0.5),
      };
      break;
    case 'semi_careful':
      options = { profile: 'careless', ...common, sprintProb: Math.round(r.range(0.1, 0.3) * 100) / 100, crouchNearHydeM: 8, hide: true, useAbilities: r.chance(0.5) };
      break;
  }
  return { family, options };
}
