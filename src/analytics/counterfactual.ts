// Pre-decision probes of the real rules engine. Each probe resolves a hypothetical leg with FIXED draws
// (never the session's secret draws), so derived features contain no post-event information.
import { EGG_COLLECT_DELAY_S, LEGS, prepareLeg, resolvePreparedLeg } from '../game/index.ts';
import type {
  EggDecision, EggTier, GameState, LegChoice, LegContext, LegDraws, LegResolution, WeatherId,
} from '../game/index.ts';

const NEVER = 0.999999;
const NO_EVENTS: LegDraws = { crash: NEVER, eggFailure: NEVER, hyde: NEVER };
const CRASH_ONLY: LegDraws = { crash: 0, eggFailure: NEVER, hyde: NEVER };
const CATCH_ONLY: LegDraws = { crash: NEVER, eggFailure: NEVER, hyde: 0 };

export function probeLeg(
  state: GameState, weather: WeatherId, choice: LegChoice, draws: LegDraws, offer: EggTier = 'none', egg: EggDecision = 'skip',
): LegResolution | null {
  const ctx: LegContext = { legIndex: state.legIndex, weather, offers: { safe: offer, shortcut: offer } };
  const prepared = prepareLeg(state, ctx, choice, state.revision);
  if (!prepared.ok) return null;
  const resolved = resolvePreparedLeg(prepared.state, ctx, draws, egg, prepared.state.revision);
  return resolved.ok ? resolved.resolution : null;
}

export interface LegProbe {
  isLegal: boolean;
  noEventTimeS: number;
  crashP: number;
  crashExtraS: number;
  catchExtraS: number;
  catchPNoCrash: number;
  catchPWithCrash: number;
  /** Exact rule-based expectations (used as transparent fallback and as model features). */
  expectedCatchP: number;
  expectedTimeS: number;
}

function catchProbability(r: LegResolution): number {
  if (r.catchType === 'proximity') return 1;
  return r.hydeProbability ?? 0;
}

/** collectProbability: chance the visitor will collect an egg this leg (offer odds × intent). */
export function probeChoice(state: GameState, weather: WeatherId, choice: LegChoice, collectProbability: number): LegProbe {
  const base = probeLeg(state, weather, choice, NO_EVENTS);
  if (!base) {
    return { isLegal: false, noEventTimeS: 0, crashP: 0, crashExtraS: 0, catchExtraS: 0, catchPNoCrash: 0, catchPWithCrash: 0, expectedCatchP: 0, expectedTimeS: 0 };
  }
  const crashed = probeLeg(state, weather, choice, CRASH_ONLY) ?? base;
  const caught = probeLeg(state, weather, choice, CATCH_ONLY) ?? base;
  const crashP = choice.route === 'shortcut' ? LEGS[state.legIndex].shortcutCrashP : 0;
  const noEventTimeS = base.time.totalCs / 100;
  const crashExtraS = (crashed.time.totalCs - base.time.totalCs) / 100;
  const catchExtraS = Math.max(0, (caught.time.totalCs - base.time.totalCs) / 100);
  const catchPNoCrash = catchProbability(base);
  const catchPWithCrash = catchProbability(crashed);
  const expectedCatchP = (1 - crashP) * catchPNoCrash + crashP * catchPWithCrash;
  const expectedTimeS = noEventTimeS + crashP * crashExtraS + collectProbability * EGG_COLLECT_DELAY_S + expectedCatchP * catchExtraS;
  return { isLegal: true, noEventTimeS, crashP, crashExtraS, catchExtraS, catchPNoCrash, catchPWithCrash, expectedCatchP, expectedTimeS };
}
