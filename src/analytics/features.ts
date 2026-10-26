// Raven Vision feature vectors. Every feature is known BEFORE the leg is resolved (route, push, weather,
// current state and rule-engine probes with fixed draws). Never add post-event fields (crash, catch, actual time).
import { EGG_COLLECT_DELAY_S, EGG_TABLE } from '../game/index.ts';
import type { GameState, LegChoice, WeatherId } from '../game/index.ts';
import { probeChoice, type LegProbe } from './counterfactual.ts';

export const TIME_FEATURES = [
  'intercept', 'no_event_time_s', 'crash_p_x_crash_extra_s', 'collect_p_x_5s',
  'catch_p_x_catch_extra_s', 'shortcut', 'leg2', 'leg3', 'currents', 'fog',
] as const;

export const CATCH_FEATURES = [
  'intercept', 'rule_expected_catch_p', 'catch_p_no_crash', 'catch_p_with_crash', 'crash_p', 'shortcut',
  'gap_start_100m', 'fog', 'leg2', 'leg3', 'prior_catches',
] as const;

export interface LegFeatures {
  probe: LegProbe;
  time: number[];
  catch: number[];
}

/** Probability that an egg will be collected on this route, integrating unknown offers (no hidden-egg leak). */
export function collectProbability(state: GameState, route: LegChoice['route'], knownOffer: string | undefined, collectIntent = 1): number {
  if (knownOffer !== undefined) return knownOffer === 'none' ? 0 : collectIntent;
  return (1 - EGG_TABLE[route][state.legIndex].none) * collectIntent;
}

export function buildLegFeatures(state: GameState, weather: WeatherId, choice: LegChoice, pCollect: number): LegFeatures {
  const probe = probeChoice(state, weather, choice, pCollect);
  const isShortcut = choice.route === 'shortcut' ? 1 : 0;
  const leg2 = state.legIndex === 2 ? 1 : 0;
  const leg3 = state.legIndex === 3 ? 1 : 0;
  const currents = weather === 'strong_currents' ? 1 : 0;
  const fog = weather === 'heavy_fog' ? 1 : 0;
  return {
    probe,
    time: [
      1, probe.noEventTimeS, probe.crashP * probe.crashExtraS, pCollect * EGG_COLLECT_DELAY_S,
      probe.expectedCatchP * probe.catchExtraS, isShortcut, leg2, leg3, currents, fog,
    ],
    catch: [
      1, probe.expectedCatchP, probe.catchPNoCrash, probe.catchPWithCrash, probe.crashP, isShortcut,
      state.pursuitGapM / 100, fog, leg2, leg3, state.hydeCatchCount,
    ],
  };
}
