// Single versioned source of rule constants (GDD v2.5). Never duplicate these values elsewhere.
import type {
  CharacterDef, EggTier, LegDef, LegIndex, PokemonDef, PushLevel, RouteId, RuleConfig, WeatherDef, WeatherId,
} from './types.ts';

export const RULES_VERSION = 'v2.5' as const;

export const RULE_CONFIG: RuleConfig = {
  rulesVersion: RULES_VERSION,
  startHp: 100,
  startStamina: 6,
  startGapM: 100,
  maxDiscountPct: 50,
  minLegTimeS: 10,
};

export const ENID_START_STAMINA = 7;
export const LEG_COUNT = 3;

export const LEGS: Record<LegIndex, LegDef> = {
  1: { index: 1, name: 'Misty Shallows', safeBaseS: 48, shortcutBaseS: 35, shortcutCrashP: 0.2, shortcutHydeBaseP: 0.15 },
  2: { index: 2, name: 'Raven Island Crypts', safeBaseS: 55, shortcutBaseS: 38, shortcutCrashP: 0.3, shortcutHydeBaseP: 0.25 },
  3: { index: 3, name: 'Final Sprint Dock', safeBaseS: 46, shortcutBaseS: 34, shortcutCrashP: 0.4, shortcutHydeBaseP: 0.35 },
};

export const WEATHER: Record<WeatherId, WeatherDef> = {
  clear: { id: 'clear', name: 'Clear', probability: 0.45, safeDelayS: 0, shortcutDelayS: 0 },
  strong_currents: { id: 'strong_currents', name: 'Strong Currents', probability: 0.3, safeDelayS: 3, shortcutDelayS: 6 },
  heavy_fog: { id: 'heavy_fog', name: 'Heavy Fog', probability: 0.25, safeDelayS: 4, shortcutDelayS: 7 },
};
export const WEATHER_ORDER: WeatherId[] = ['clear', 'strong_currents', 'heavy_fog'];

export const FOG_SHORTCUT_HYDE_BONUS_P = 0.15;
export const FOG_SHORTCUT_GAP_LOSS_M = 10;

export const PUSH_DISCOUNT_PCT: Record<PushLevel, number> = { 1: 5, 2: 12, 3: 20 };

export const GAP = {
  safeRouteM: 10,
  shortcutRouteM: -15,
  push3M: 10,
  crashLossM: 25,
  firstCatchResetM: 30,
  kentLeg2M: 15,
  misdreavusShortcutM: 10,
} as const;

/** Gap risk modifier evaluated on the updated gap (just before the catch check). */
export const GAP_RISK = { closeBelowM: 40, closeP: 0.15, midBelowM: 70, midP: 0.05 } as const;
export const MAX_HYDE_P = 0.95;

export const CRASH = { hpLoss: 10, delayS: 8, eggFailureP: 0.25 } as const;
export const CATCH = { hpLoss: 35, delayS: 10, morticiaDelayS: 5, eggLossFraction: 0.5 } as const;
export const EGG_COLLECT_DELAY_S = 5;

export const EGG_POINTS: Record<EggTier, number> = { none: 0, common: 1, rare: 3, legendary: 6 };
export const EGG_TIER_ORDER: EggTier[] = ['none', 'common', 'rare', 'legendary'];

/** Probability of each offered tier by route and leg. Every row sums to 1. */
export const EGG_TABLE: Record<RouteId, Record<LegIndex, Record<EggTier, number>>> = {
  safe: {
    1: { none: 0.3, common: 0.7, rare: 0, legendary: 0 },
    2: { none: 0.3, common: 0.7, rare: 0, legendary: 0 },
    3: { none: 0.3, common: 0.7, rare: 0, legendary: 0 },
  },
  shortcut: {
    1: { none: 0.1, common: 0.3, rare: 0.6, legendary: 0 },
    2: { none: 0, common: 0.3, rare: 0.6, legendary: 0.1 },
    3: { none: 0, common: 0.3, rare: 0.6, legendary: 0.1 },
  },
};

export const ABILITY = {
  wednesdayFogFlatP: 0.15,
  biancaCurrentsPct: 15,
  ajaxCrashDelayReductionS: 3,
  yokoPush3Pct: 24,
  gomezShortcutPct: 10,
  marowakCrashDelayReductionS: 4,
  dusknoirFogFlatP: 0.1,
  drifblimPct: 10,
  froslassMultiplier: 0.85,
  dragapultAllRoutePct: 10,
  dragapultPush3Pct: 30,
  dragapultPush3Cost: 4,
  corsolaLeg2Push1Pct: 12,
  basculegionPct: 10,
  basculegionMinGapM: 70,
  ceruledgePct: 15,
  gholdengoMultiplier: 1.25,
  sableyeBonus: 1,
} as const;

/** Monte Carlo strategist defaults (GDD 8.3). */
export const ADVISOR = { rolloutsPerCandidate: 512, maxDnfRisk: 0.25, timeBudgetMs: 1500 } as const;

export const NICKNAME = { minLength: 3, maxLength: 15 } as const;

export const CHARACTERS: CharacterDef[] = [
  { id: 'wednesday', name: 'Wednesday', abilityName: 'Dark Vision', shortAbility: 'Heavy Fog: Hyde catch risk −15 pts', palette: ['#111114', '#3a3a42', '#eae6da'] },
  { id: 'enid', name: 'Enid', abilityName: 'High Energy', shortAbility: 'Starts with 7 stamina instead of 6', palette: ['#f4a7c8', '#8fd3f4', '#f7e27a'] },
  { id: 'bianca', name: 'Bianca', abilityName: 'Siren Navigation', shortAbility: 'Strong Currents: +15% time reduction', palette: ['#5b2a86', '#1e2a5a', '#c0c7d6'] },
  { id: 'xavier', name: 'Xavier', abilityName: 'Painted Decoy', shortAbility: 'First crash: no HP or time loss (gap loss stays)', palette: ['#2f5fb3', '#3b3f46', '#efe6cf'] },
  { id: 'ajax', name: 'Ajax', abilityName: 'Stone Shield', shortAbility: 'Every crash costs 3 s less time', palette: ['#141414', '#3b3f8f', '#6b7280'] },
  { id: 'yoko', name: 'Yoko', abilityName: 'Night Sprint', shortAbility: 'Push level 3 gives 24% instead of 20%', palette: ['#0b0b0f', '#1b2550', '#b3122e'] },
  { id: 'kent', name: 'Kent', abilityName: 'Hydro Wave', shortAbility: 'Leg 2: automatic +15 m lead on Hyde', palette: ['#2dd4e6', '#3730a3', '#0f766e'] },
  { id: 'divina', name: 'Divina', abilityName: 'Siren Drift', shortAbility: 'Strong Currents delay is halved', palette: ['#1d4ed8', '#7c3aed', '#e8e3f0'] },
  { id: 'rowan', name: 'Rowan', abilityName: 'Telekinetic Push', shortAbility: 'First crash of the race fully negated', palette: ['#14532d', '#0b0b0f', '#efe9d8'] },
  { id: 'eugene', name: 'Eugene', abilityName: 'Hive Swarm', shortAbility: 'Sees both routes’ eggs before choosing', palette: ['#e0a526', '#6b4423', '#f3e8c8'] },
  { id: 'morticia', name: 'Morticia', abilityName: 'Graceful Escape', shortAbility: 'First Hyde catch costs +5 s, not +10 s', palette: ['#0b0b0f', '#4a1942', '#c0c0c8'] },
  { id: 'gomez', name: 'Gomez', abilityName: 'Fearless Dash', shortAbility: 'Shortcut: +10% time reduction', palette: ['#0b0b0f', '#7f1d1d', '#374151'] },
];

export const POKEMON: PokemonDef[] = [
  { id: 'gengar', name: 'Gengar', traitName: 'Shadow Sneak', shortTrait: 'Ignores the first weather delay of the race', palette: ['#5b3a8e', '#e02424'] },
  { id: 'alolan_marowak', name: 'Alolan Marowak', traitName: 'Bone Shield', shortTrait: 'Crash time penalty −4 s', palette: ['#2b2b33', '#7cf06b'] },
  { id: 'misdreavus', name: 'Misdreavus', traitName: 'Spite Echo', shortTrait: 'Shortcuts lose 10 m less lead', palette: ['#5a3d8a', '#e05aa0'] },
  { id: 'galarian_corsola', name: 'Galarian Corsola', traitName: 'Cursed Body', shortTrait: 'Leg 2: push 1 works like push 2 (12%)', palette: ['#e8e6f0', '#9aa0b8'] },
  { id: 'sableye', name: 'Sableye', traitName: 'Keen Eye', shortTrait: 'Rare/Legendary eggs worth +1 point', palette: ['#4b3b78', '#4fd1c5'] },
  { id: 'dusknoir', name: 'Dusknoir', traitName: 'Pressure', shortTrait: 'Heavy Fog: Hyde catch risk −10 pts', palette: ['#6b6f78', '#f2c94c'] },
  { id: 'drifblim', name: 'Drifblim', traitName: 'Wind Power', shortTrait: 'Push 2 or 3: extra +10% time reduction', palette: ['#6d4c9e', '#f6d55c'] },
  { id: 'froslass', name: 'Froslass', traitName: 'Snow Cloak', shortTrait: 'Shortcut Hyde risk ×0.85', palette: ['#f1f5f9', '#60a5fa'] },
  { id: 'jellicent', name: 'Jellicent', traitName: 'Water Absorb', shortTrait: 'No Strong Currents delay', palette: ['#7dd3fc', '#f9a8d4'] },
  { id: 'chandelure', name: 'Chandelure', traitName: 'Flash Fire', shortTrait: 'No Heavy Fog delay (risk still applies)', palette: ['#1f1f2b', '#8b5cf6'] },
  { id: 'aegislash', name: 'Aegislash', traitName: 'King’s Shield', shortTrait: 'First Hyde catch: no HP, time or egg loss', palette: ['#c9a227', '#4b5563'] },
  { id: 'trevenant', name: 'Trevenant', traitName: 'Forest Anchor', shortTrait: 'Crashes never cost pursuit distance', palette: ['#5b4130', '#4ade80'] },
  { id: 'dhelmise', name: 'Dhelmise', traitName: 'Ghost Anchor', shortTrait: 'First Hyde catch: unbanked eggs protected', palette: ['#4d7c5a', '#a16207'] },
  { id: 'decidueye', name: 'Decidueye', traitName: 'Spirit Shackle', shortTrait: 'Leg 3: no new pursuit distance lost', palette: ['#3f6b3a', '#d9c7a3'] },
  { id: 'dragapult', name: 'Dragapult', traitName: 'Infiltrator', shortTrait: 'All routes +10%; push 3 = 30% for 4 stamina', palette: ['#3d7a7a', '#e05252'] },
  { id: 'basculegion', name: 'Basculegion', traitName: 'Wave Rider', shortTrait: 'Lead ≥70 m at leg start: +10% time reduction', palette: ['#3f7d5a', '#c0392b'] },
  { id: 'ceruledge', name: 'Ceruledge', traitName: 'Bitter Blade', shortTrait: 'Leg 3 push 3: +15% time reduction', palette: ['#2d1b4e', '#3b82f6'] },
  { id: 'gholdengo', name: 'Gholdengo', traitName: 'Good as Gold', shortTrait: 'Final egg points ×1.25 (rounded down)', palette: ['#e8b923', '#8a6d1d'] },
];

export const CHARACTER_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c])) as Record<CharacterDef['id'], CharacterDef>;
export const POKEMON_BY_ID = Object.fromEntries(POKEMON.map((p) => [p.id, p])) as Record<PokemonDef['id'], PokemonDef>;
