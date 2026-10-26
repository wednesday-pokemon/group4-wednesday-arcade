// Heuristic future-decision policies used for Monte Carlo continuations and synthetic data.
import { getPushOptions } from '../game/index.ts';
import type { GameState, LegChoice, PushLevel, PushOption, RacePolicy, RouteId } from '../game/index.ts';

const ADAPTIVE_MIN_GAP_M = 70;

/** Spreads stamina evenly over the remaining legs; on the final leg spends as much as is legal. */
export function evenPushLevel(state: GameState, options: PushOption[]): PushLevel {
  const legal = options.filter((o) => o.isLegal);
  if (legal.length === 0) return 1;
  const remainingLegs = 4 - state.legIndex;
  const target = remainingLegs === 1 ? 3 : Math.max(1, Math.min(3, Math.floor(state.stamina / remainingLegs)));
  const affordable = legal.filter((o) => o.pushLevel <= target);
  const pool = affordable.length > 0 ? affordable : legal;
  return pool.reduce((best, o) => (o.pushLevel > best.pushLevel ? o : best)).pushLevel;
}

function routePolicy(pickRoute: (state: GameState) => RouteId): RacePolicy {
  return {
    chooseLeg(state, _view, options): LegChoice {
      return { route: pickRoute(state), pushLevel: evenPushLevel(state, options) };
    },
    chooseEgg(_state, offer) {
      return offer === 'none' ? 'skip' : 'collect';
    },
  };
}

export const FUTURE_POLICIES: Record<string, RacePolicy> = {
  'safe from here': routePolicy(() => 'safe'),
  'shortcuts from here': routePolicy(() => 'shortcut'),
  'shortcut only while Hyde is far': routePolicy((s) => (s.hydeCatchCount === 0 && s.pursuitGapM >= ADAPTIVE_MIN_GAP_M ? 'shortcut' : 'safe')),
};

/** Uniformly random legal route × push, collecting eggs with the given probability (synthetic data coverage). */
export function randomPolicy(rng: () => number, collectRate = 0.85): RacePolicy {
  return {
    chooseLeg(state) {
      const legal = getPushOptions(state).filter((o) => o.isLegal);
      const push = legal[Math.floor(rng() * legal.length)]?.pushLevel ?? 1;
      return { route: rng() < 0.5 ? 'safe' : 'shortcut', pushLevel: push };
    },
    chooseEgg(_state, offer) {
      return offer !== 'none' && rng() < collectRate ? 'collect' : 'skip';
    },
  };
}
