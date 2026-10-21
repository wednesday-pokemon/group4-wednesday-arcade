// Pre-decision route card numbers, probed from the pure rules engine with "no event" draws.
// These are previews of the rules (what WOULD apply), never outcomes: outcomes only come from the backend.
import { CHARACTER_BY_ID, EGG_TABLE, LEGS, POKEMON_BY_ID, WEATHER } from '../../game/index.ts';
import type { EggTier, GameState, PushLevel, PushOption, RouteId, WeatherId } from '../../game/index.ts';
import { probeLeg } from '../../analytics/counterfactual.ts';

const NEVER = 0.999999;
const NO_EVENTS = { crash: NEVER, eggFailure: NEVER, hyde: NEVER };

export interface RoutePreview {
  route: RouteId;
  baseCs: number;
  weatherDelayCs: number;
  weatherNote: string | null;
  crashP: number;
  hydeP: number;
  proximityCatch: boolean;
  leadDeltaM: number;
  eggOdds: { tier: EggTier; p: number }[];
  knownEgg: EggTier | null;
}

const TIER_ORDER: EggTier[] = ['legendary', 'rare', 'common', 'none'];

export function legalPushFor(options: PushOption[], wanted: PushLevel): PushLevel {
  return options.find((o) => o.pushLevel === wanted)?.isLegal ? wanted : 1;
}

function abilityOwnerName(id: string): string {
  return CHARACTER_BY_ID[id as keyof typeof CHARACTER_BY_ID]?.name ?? POKEMON_BY_ID[id as keyof typeof POKEMON_BY_ID]?.name ?? id;
}

export function previewRoute(
  state: GameState, weather: WeatherId, route: RouteId, pushLevel: PushLevel, knownEgg: EggTier | undefined,
): RoutePreview {
  const leg = LEGS[state.legIndex];
  const r = probeLeg(state, weather, { route, pushLevel }, NO_EVENTS);
  const rawDelayCs = (route === 'safe' ? WEATHER[weather].safeDelayS : WEATHER[weather].shortcutDelayS) * 100;
  const weatherDelayCs = r?.time.weatherDelayCs ?? rawDelayCs;
  const reducer = r?.abilityEvents.find((e) => /delay/.test(e.message));
  const odds = EGG_TABLE[route][state.legIndex];
  return {
    route,
    baseCs: (route === 'safe' ? leg.safeBaseS : leg.shortcutBaseS) * 100,
    weatherDelayCs,
    weatherNote: weatherDelayCs !== rawDelayCs && reducer ? abilityOwnerName(reducer.abilityId) : null,
    crashP: route === 'shortcut' ? leg.shortcutCrashP : 0,
    hydeP: r ? (r.catchType === 'proximity' ? 1 : r.hydeProbability ?? 0) : 0,
    proximityCatch: r?.catchType === 'proximity',
    leadDeltaM: r ? r.gapBeforeCatchM - r.gapStartM : 0,
    eggOdds: TIER_ORDER.filter((t) => odds[t] > 0).map((t) => ({ tier: t, p: odds[t] })),
    knownEgg: knownEgg ?? null,
  };
}
