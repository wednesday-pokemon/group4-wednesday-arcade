// Authoritative rules engine (rules v2.5). Pure and deterministic: no seed knowledge, no clock, no Math.random.
// Everything trusted arrives as LegContext (weather + offers) and LegDraws (fixed-key uniforms).
import {
  ABILITY, CATCH, CRASH, EGG_COLLECT_DELAY_S, EGG_POINTS, FOG_SHORTCUT_GAP_LOSS_M, FOG_SHORTCUT_HYDE_BONUS_P, GAP,
  GAP_RISK, LEG_COUNT, LEGS, MAX_HYDE_P, PUSH_DISCOUNT_PCT, RULE_CONFIG, RULES_VERSION, WEATHER,
} from './constants.ts';
import {
  characterEvent, pokemonEvent, pushDiscountPct, pushModifier, pushStaminaCost, startingStamina,
} from './abilities.ts';
import { computeFinalEggPoints, computeFinalScore, formatSeconds } from './scoring.ts';
import { isEggDecision, isPushLevel, isRouteId } from './validation.ts';
import type {
  AbilityEvent, ActionRejection, CharacterId, DnfReason, EggDecision, GameState, GapDelta, LegChoice, LegContext,
  LegDraws, LegIndex, LegResolution, LegView, PokemonId, PreparedLeg, PushLevel, PushOption, RouteId, TimeBreakdown,
} from './types.ts';

export type Result<T> = ({ ok: true } & T) | { ok: false; error: ActionRejection };

const PUSH_LEVELS: readonly PushLevel[] = [1, 2, 3];
const BP = 10000; // probability basis points (exact integer arithmetic for Hyde risk)

function reject(code: ActionRejection['code'], message: string): { ok: false; error: ActionRejection } {
  return { ok: false, error: { code, message } };
}

function toBp(p: number): number {
  return Math.round(p * BP);
}

// ---------------------------------------------------------------------------------------------------------------
// State creation and options
// ---------------------------------------------------------------------------------------------------------------

export function createInitialState(i: {
  sessionId: string;
  nickname: string;
  characterId: CharacterId;
  pokemonId: PokemonId;
}): GameState {
  return {
    rulesVersion: RULES_VERSION,
    sessionId: i.sessionId,
    nickname: i.nickname,
    characterId: i.characterId,
    pokemonId: i.pokemonId,
    status: 'in_progress',
    phase: 'awaiting_route',
    legIndex: 1,
    revision: 0,
    hp: RULE_CONFIG.startHp,
    stamina: startingStamina(i.characterId),
    pursuitGapM: RULE_CONFIG.startGapM,
    hydeCatchCount: 0,
    bankedEggPoints: 0,
    unbankedEggPoints: 0,
    totalSimulatedTimeCs: 0,
    flags: { gengarWeatherUsed: false, xavierCrashUsed: false, rowanCrashUsed: false, firstCatchResolved: false },
    prepared: null,
    legResults: [],
    finalEggPoints: null,
    finalScore: null,
    dnfReason: null,
  };
}

/** Remaining legs after the given one (each needs at least 1 stamina). */
export function remainingLegsAfter(leg: LegIndex): number {
  return LEG_COUNT - leg;
}

/** Natural-language reason for a disabled push option (DECISIONS D-16). */
export function staminaDisabledReason(stamina: number, cost: number, remaining: number): string {
  if (stamina < cost) return `Needs ${cost} stamina but you only have ${stamina}`;
  if (remaining === 1) return `Needs ${cost} stamina — you must keep 1 for the final leg`;
  return `Needs ${cost} stamina — you must keep ${remaining} for the last ${remaining === 2 ? 'two' : remaining} legs`;
}

/** Always 3 entries (levels 1..3) for state.legIndex. Legal iff stamina - cost >= remaining legs. */
export function getPushOptions(state: GameState): PushOption[] {
  const remaining = remainingLegsAfter(state.legIndex);
  return PUSH_LEVELS.map((level) => {
    const staminaCost = pushStaminaCost(state.pokemonId, level);
    const isLegal = state.stamina - staminaCost >= remaining;
    return {
      pushLevel: level,
      staminaCost,
      pushDiscountPct: pushDiscountPct(state.characterId, state.pokemonId, state.legIndex, level),
      isLegal,
      disabledReason: isLegal ? null : staminaDisabledReason(state.stamina, staminaCost, remaining),
    };
  });
}

/** Offer visibility: Eugene sees both routes always; others see only the selected route after prepare. */
export function buildLegView(state: GameState, ctx: LegContext): LegView {
  let visibleOffers: LegView['visibleOffers'] = {};
  if (state.characterId === 'eugene') {
    visibleOffers = { safe: ctx.offers.safe, shortcut: ctx.offers.shortcut };
  } else if (state.phase === 'awaiting_egg' && state.prepared) {
    visibleOffers = { [state.prepared.route]: state.prepared.selectedOffer };
  }
  return { legIndex: ctx.legIndex, legName: LEGS[ctx.legIndex].name, weather: ctx.weather, visibleOffers };
}

// ---------------------------------------------------------------------------------------------------------------
// Prepare
// ---------------------------------------------------------------------------------------------------------------

function guardAction(state: GameState, expectedRevision: number, phase: GameState['phase']): { ok: false; error: ActionRejection } | null {
  if (state.status !== 'in_progress') return reject('SESSION_CLOSED', `Session is ${state.status}`);
  if (expectedRevision !== state.revision) {
    return reject('STALE_REVISION', `Expected revision ${state.revision} but received ${expectedRevision}`);
  }
  if (state.phase !== phase) return reject('WRONG_PHASE', `Action requires phase ${phase} but session is in ${state.phase}`);
  return null;
}

export function prepareLeg(
  state: GameState,
  ctx: LegContext,
  choice: LegChoice,
  expectedRevision: number,
): Result<{ state: GameState }> {
  const guard = guardAction(state, expectedRevision, 'awaiting_route');
  if (guard) return guard;
  if (!choice || !isRouteId(choice.route) || !isPushLevel(choice.pushLevel)) {
    return reject('INVALID_INPUT', 'Route must be safe/shortcut and push level 1, 2 or 3');
  }
  if (!ctx || ctx.legIndex !== state.legIndex) return reject('INVALID_INPUT', `Leg context does not match leg ${state.legIndex}`);
  const option = getPushOptions(state).find((o) => o.pushLevel === choice.pushLevel)!;
  if (!option.isLegal) return reject('ILLEGAL_STAMINA', option.disabledReason ?? 'Illegal push level');
  const revision = state.revision + 1;
  const prepared: PreparedLeg = {
    route: choice.route,
    pushLevel: choice.pushLevel,
    legIndex: state.legIndex,
    staminaCost: option.staminaCost,
    weather: ctx.weather,
    selectedOffer: ctx.offers[choice.route],
    preparedRevision: revision,
  };
  return { ok: true, state: { ...state, phase: 'awaiting_egg', prepared, revision } };
}

// ---------------------------------------------------------------------------------------------------------------
// Resolve
// ---------------------------------------------------------------------------------------------------------------

/** Pure time waterfall: raw = base - savings + weather + crash + egg + hyde; total = max(floor, raw). */
export function buildTimeBreakdown(i: {
  baseCs: number;
  discountPct: number;
  speedSavingsCs: number;
  weatherDelayCs: number;
  crashDelayCs: number;
  eggDelayCs: number;
  hydeDelayCs: number;
  discountSources: { source: string; pct: number }[];
  minLegTimeCs?: number;
}): TimeBreakdown {
  const minCs = i.minLegTimeCs ?? RULE_CONFIG.minLegTimeS * 100;
  const raw = i.baseCs - i.speedSavingsCs + i.weatherDelayCs + i.crashDelayCs + i.eggDelayCs + i.hydeDelayCs;
  const totalCs = Math.max(minCs, raw);
  return {
    baseCs: i.baseCs,
    discountPct: i.discountPct,
    speedSavingsCs: i.speedSavingsCs,
    weatherDelayCs: i.weatherDelayCs,
    crashDelayCs: i.crashDelayCs,
    eggDelayCs: i.eggDelayCs,
    hydeDelayCs: i.hydeDelayCs,
    floorAdjustmentCs: totalCs - raw,
    totalCs,
    discountSources: i.discountSources,
  };
}

/** Gap risk (fraction) evaluated on the updated gap just before the catch check. */
export function gapRisk(gapM: number): number {
  if (gapM < GAP_RISK.closeBelowM) return GAP_RISK.closeP;
  if (gapM < GAP_RISK.midBelowM) return GAP_RISK.midP;
  return 0;
}

function isUnitDraw(x: unknown): boolean {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x < 1;
}

function fmtPct(bp: number): string {
  return `${Math.round(bp) / 100}`;
}

export function resolvePreparedLeg(
  state: GameState,
  ctx: LegContext,
  draws: LegDraws,
  egg: EggDecision,
  expectedRevision: number,
): Result<{ state: GameState; resolution: LegResolution }> {
  const guard = guardAction(state, expectedRevision, 'awaiting_egg');
  if (guard) return guard;
  const prepared = state.prepared;
  if (!prepared || prepared.legIndex !== state.legIndex) return reject('WRONG_PHASE', 'No prepared leg to resolve');
  if (!isEggDecision(egg)) return reject('INVALID_INPUT', 'Egg decision must be collect or skip');
  if (!ctx || ctx.legIndex !== state.legIndex) return reject('INVALID_INPUT', `Leg context does not match leg ${state.legIndex}`);
  if (!draws || !isUnitDraw(draws.crash) || !isUnitDraw(draws.eggFailure) || !isUnitDraw(draws.hyde)) {
    return reject('INVALID_INPUT', 'Draws must be numbers in [0, 1)');
  }
  if (egg === 'collect' && prepared.selectedOffer === 'none') {
    return reject('NO_EGG_TO_COLLECT', 'There is no egg on this route to collect');
  }
  return { ok: true, ...resolveCore(state, prepared, draws, egg) };
}

function resolveCore(
  state: GameState,
  prepared: PreparedLeg,
  draws: LegDraws,
  egg: EggDecision,
): { state: GameState; resolution: LegResolution } {
  const c = state.characterId;
  const p = state.pokemonId;
  const leg = prepared.legIndex;
  const legDef = LEGS[leg];
  const route: RouteId = prepared.route;
  const level = prepared.pushLevel;
  const weather = prepared.weather;
  const shortcut = route === 'shortcut';
  const fog = weather === 'heavy_fog';
  const currents = weather === 'strong_currents';
  const flags = { ...state.flags };
  const events: AbilityEvent[] = [];
  const gapStart = state.pursuitGapM;

  // 1. Speed discount (additive integer percentage points, capped).
  const baseS = shortcut ? legDef.shortcutBaseS : legDef.safeBaseS;
  const discountSources: { source: string; pct: number }[] = [];
  const pushPct = pushDiscountPct(c, p, leg, level);
  discountSources.push({ source: 'push', pct: pushPct });
  const mod = pushModifier(c, p, leg, level);
  if (mod === 'dragapult') {
    events.push(pokemonEvent(p, `made push level 3 worth ${pushPct}% (instead of ${PUSH_DISCOUNT_PCT[3]}%) for ${ABILITY.dragapultPush3Cost} stamina`));
  } else if (mod === 'yoko') {
    events.push(characterEvent(c, `made push level 3 worth ${pushPct}% instead of ${PUSH_DISCOUNT_PCT[3]}%`));
  } else if (mod === 'galarian_corsola') {
    events.push(pokemonEvent(p, `made push level 1 worth ${pushPct}% instead of ${PUSH_DISCOUNT_PCT[1]}% on Leg 2`));
  }
  if (c === 'bianca' && currents) {
    discountSources.push({ source: 'bianca', pct: ABILITY.biancaCurrentsPct });
    events.push(characterEvent(c, `rode the Strong Currents for an extra ${ABILITY.biancaCurrentsPct}% speed`));
  }
  if (c === 'gomez' && shortcut) {
    discountSources.push({ source: 'gomez', pct: ABILITY.gomezShortcutPct });
    events.push(characterEvent(c, `added ${ABILITY.gomezShortcutPct}% speed on the shortcut`));
  }
  if (p === 'dragapult') {
    discountSources.push({ source: 'dragapult', pct: ABILITY.dragapultAllRoutePct });
    events.push(pokemonEvent(p, `added ${ABILITY.dragapultAllRoutePct}% speed`));
  }
  if (p === 'drifblim' && level >= 2) {
    discountSources.push({ source: 'drifblim', pct: ABILITY.drifblimPct });
    events.push(pokemonEvent(p, `added ${ABILITY.drifblimPct}% speed at push level ${level}`));
  }
  if (p === 'basculegion' && gapStart >= ABILITY.basculegionMinGapM) {
    discountSources.push({ source: 'basculegion', pct: ABILITY.basculegionPct });
    events.push(pokemonEvent(p, `added ${ABILITY.basculegionPct}% speed with a ${gapStart} m lead`));
  }
  if (p === 'ceruledge' && leg === 3 && level === 3) {
    discountSources.push({ source: 'ceruledge', pct: ABILITY.ceruledgePct });
    events.push(pokemonEvent(p, `added ${ABILITY.ceruledgePct}% speed on the final push`));
  }
  const discountSum = discountSources.reduce((s, d) => s + d.pct, 0);
  const discountPct = Math.min(RULE_CONFIG.maxDiscountPct, discountSum);
  const baseCs = baseS * 100;
  const speedSavingsCs = baseS * discountPct; // baseS * 100 * pct / 100, exact integer

  // 2. Weather delay: cancellations, then Gengar (first nonzero), then Divina (partial).
  const wDef = WEATHER[weather];
  let weatherDelayCs = (shortcut ? wDef.shortcutDelayS : wDef.safeDelayS) * 100;
  if (currents && p === 'jellicent' && weatherDelayCs > 0) {
    events.push(pokemonEvent(p, `cancelled the ${formatSeconds(weatherDelayCs)} s Strong Currents delay`));
    weatherDelayCs = 0;
  }
  if (fog && p === 'chandelure' && weatherDelayCs > 0) {
    events.push(pokemonEvent(p, `cancelled the ${formatSeconds(weatherDelayCs)} s Heavy Fog delay`));
    weatherDelayCs = 0;
  }
  if (p === 'gengar' && weatherDelayCs > 0 && !flags.gengarWeatherUsed) {
    flags.gengarWeatherUsed = true;
    events.push(pokemonEvent(p, `ignored the ${formatSeconds(weatherDelayCs)} s weather delay (one use per race)`));
    weatherDelayCs = 0;
  }
  if (currents && c === 'divina' && weatherDelayCs > 0) {
    const halved = weatherDelayCs / 2;
    events.push(characterEvent(c, `halved the Strong Currents delay from ${formatSeconds(weatherDelayCs)} s to ${formatSeconds(halved)} s`));
    weatherDelayCs = halved;
  }

  // 3. Egg collection.
  const offer = prepared.selectedOffer;
  const eggAttempted = egg === 'collect' && offer !== 'none';
  const eggDelayCs = eggAttempted ? EGG_COLLECT_DELAY_S * 100 : 0;
  let eggPointsProvisional = 0;
  if (eggAttempted) {
    eggPointsProvisional = EGG_POINTS[offer];
    if (p === 'sableye' && (offer === 'rare' || offer === 'legendary')) {
      eggPointsProvisional += ABILITY.sableyeBonus;
      events.push(pokemonEvent(p, `added +${ABILITY.sableyeBonus} point to the ${offer} egg`));
    }
  }

  // 4. Crash (shortcut only).
  const crashProbability = shortcut ? legDef.shortcutCrashP : 0;
  const crashOccurred = shortcut && draws.crash < crashProbability;
  let crashNegatedBy: CharacterId | null = null;
  let crashHpLoss = 0;
  let crashDelayCs = 0;
  let eggFailed = false;
  if (crashOccurred) {
    if (c === 'rowan' && !flags.rowanCrashUsed) {
      flags.rowanCrashUsed = true;
      crashNegatedBy = 'rowan';
      events.push(characterEvent(c, 'negated the crash entirely (no HP, time, lead or egg loss)'));
    } else {
      if (c === 'xavier' && !flags.xavierCrashUsed) {
        flags.xavierCrashUsed = true;
        crashNegatedBy = 'xavier';
        events.push(characterEvent(c, `absorbed the crash: no HP or time lost (the ${GAP.crashLossM} m lead loss still applies)`));
      } else {
        crashHpLoss = CRASH.hpLoss;
        let delayS = CRASH.delayS;
        if (c === 'ajax') {
          delayS -= ABILITY.ajaxCrashDelayReductionS;
          events.push(characterEvent(c, `cut ${ABILITY.ajaxCrashDelayReductionS} s from the crash delay`));
        }
        if (p === 'alolan_marowak') {
          delayS -= ABILITY.marowakCrashDelayReductionS;
          events.push(pokemonEvent(p, `cut ${ABILITY.marowakCrashDelayReductionS} s from the crash delay`));
        }
        crashDelayCs = Math.max(0, delayS) * 100;
      }
      if (eggAttempted) eggFailed = draws.eggFailure < CRASH.eggFailureP;
    }
  }
  const eggPointsAfterCrash = eggFailed ? 0 : eggPointsProvisional;

  // 5. Pursuit gap.
  const gapDeltas: GapDelta[] = [];
  gapDeltas.push({ source: 'route', meters: shortcut ? GAP.shortcutRouteM : GAP.safeRouteM });
  if (p === 'misdreavus' && shortcut) {
    gapDeltas.push({ source: 'misdreavus', meters: GAP.misdreavusShortcutM });
    events.push(pokemonEvent(p, `saved ${GAP.misdreavusShortcutM} m of lead on the shortcut`));
  }
  if (level === 3) gapDeltas.push({ source: 'push3', meters: GAP.push3M });
  if (c === 'kent' && leg === 2) {
    gapDeltas.push({ source: 'kent', meters: GAP.kentLeg2M });
    events.push(characterEvent(c, `added ${GAP.kentLeg2M} m of lead on Leg 2`));
  }
  if (crashOccurred) {
    const d: GapDelta = { source: 'crash', meters: -GAP.crashLossM };
    if (crashNegatedBy === 'rowan') d.negatedBy = 'rowan';
    else if (p === 'trevenant') {
      d.negatedBy = 'trevenant';
      events.push(pokemonEvent(p, `kept the ${GAP.crashLossM} m lead the crash would have cost`));
    }
    gapDeltas.push(d);
  }
  if (fog && shortcut) gapDeltas.push({ source: 'fog', meters: -FOG_SHORTCUT_GAP_LOSS_M });
  if (p === 'decidueye' && leg === 3) {
    let saved = 0;
    for (const d of gapDeltas) {
      if (d.meters < 0 && !d.negatedBy) {
        d.negatedBy = 'decidueye';
        saved -= d.meters;
      }
    }
    if (saved > 0) events.push(pokemonEvent(p, `prevented ${saved} m of lead loss on Leg 3`));
  }
  const gapBeforeCatchM = gapStart + gapDeltas.reduce((s, d) => s + (d.negatedBy ? 0 : d.meters), 0);

  // 6. Hyde check (at most one catch per leg).
  let hydeProbability: number | null = null;
  let hydeCatch = false;
  let catchType: LegResolution['catchType'] = null;
  if (gapBeforeCatchM <= 0) {
    hydeCatch = true;
    catchType = 'proximity';
  } else if (shortcut) {
    let bp = toBp(legDef.shortcutHydeBaseP) + toBp(gapRisk(gapBeforeCatchM)) + (fog ? toBp(FOG_SHORTCUT_HYDE_BONUS_P) : 0);
    if (fog && c === 'wednesday') {
      bp -= toBp(ABILITY.wednesdayFogFlatP);
      events.push(characterEvent(c, `cut Hyde's catch risk by ${fmtPct(toBp(ABILITY.wednesdayFogFlatP))} points in the fog`));
    }
    if (fog && p === 'dusknoir') {
      bp -= toBp(ABILITY.dusknoirFogFlatP);
      events.push(pokemonEvent(p, `cut Hyde's catch risk by ${fmtPct(toBp(ABILITY.dusknoirFogFlatP))} points in the fog`));
    }
    if (p === 'froslass') {
      const before = bp;
      bp = Math.round(bp * ABILITY.froslassMultiplier);
      events.push(pokemonEvent(p, `reduced Hyde's catch risk from ${fmtPct(Math.max(0, before))}% to ${fmtPct(Math.max(0, bp))}%`));
    }
    bp = Math.min(toBp(MAX_HYDE_P), Math.max(0, bp));
    hydeProbability = bp / BP;
    hydeCatch = draws.hyde < hydeProbability;
    if (hydeCatch) catchType = 'roll';
  }

  // 7. Catch effects.
  let catchNumber: 0 | 1 | 2 = 0;
  let catchHpLoss = 0;
  let hydeDelayCs = 0;
  let eggPointsLostToCatch = 0;
  let dnfReason: DnfReason | null = null;
  const unbankedBeforeCatch = state.unbankedEggPoints + eggPointsAfterCrash;
  let hydeCatchCount = state.hydeCatchCount;
  let gapEndM = gapBeforeCatchM;
  if (hydeCatch) {
    if (hydeCatchCount >= 1) {
      catchNumber = 2;
      hydeCatchCount = 2;
      dnfReason = 'second_catch';
    } else {
      catchNumber = 1;
      hydeCatchCount = 1;
      flags.firstCatchResolved = true;
      if (p === 'aegislash') {
        events.push(pokemonEvent(p, 'blocked every penalty of the first Hyde catch (no HP, time or egg loss)'));
      } else {
        catchHpLoss = CATCH.hpLoss;
        if (c === 'morticia') {
          hydeDelayCs = CATCH.morticiaDelayS * 100;
          events.push(characterEvent(c, `limited the catch delay to ${CATCH.morticiaDelayS} s instead of ${CATCH.delayS} s`));
        } else {
          hydeDelayCs = CATCH.delayS * 100;
        }
        const wouldLose = Math.floor(unbankedBeforeCatch * CATCH.eggLossFraction);
        if (p === 'dhelmise') {
          if (wouldLose > 0) events.push(pokemonEvent(p, `protected ${wouldLose} unbanked egg point${wouldLose === 1 ? '' : 's'} from Hyde`));
        } else {
          eggPointsLostToCatch = wouldLose;
        }
      }
      gapEndM = GAP.firstCatchResetM;
    }
  }

  // 8. HP.
  const hpStart = state.hp;
  const hpAfter = hpStart - crashHpLoss - catchHpLoss;
  if (dnfReason === null && hpAfter <= 0) dnfReason = 'hp_depleted';
  const hpEnd = Math.max(0, hpAfter);
  if (dnfReason !== null) gapEndM = gapBeforeCatchM;

  // 9. Time.
  const time = buildTimeBreakdown({
    baseCs, discountPct, speedSavingsCs, weatherDelayCs, crashDelayCs, eggDelayCs, hydeDelayCs, discountSources,
  });
  const totalSimulatedTimeCs = state.totalSimulatedTimeCs + time.totalCs;

  // 10. Banking / advance.
  const survived = dnfReason === null;
  const staminaStart = state.stamina;
  const staminaEnd = staminaStart - prepared.staminaCost;
  const bankedBefore = state.bankedEggPoints;
  const unbankedAfterCatch = unbankedBeforeCatch - eggPointsLostToCatch;
  const eggPointsBanked = survived ? unbankedAfterCatch : 0;
  const bankedAfter = bankedBefore + eggPointsBanked;
  const isLastLeg = leg === LEG_COUNT;
  const outcome: LegResolution['outcome'] = !survived ? 'dnf' : isLastLeg ? 'finished' : 'survived';

  let finalEggPoints: number | null = null;
  let finalScore: number | null = null;
  if (!survived) {
    finalEggPoints = 0;
    finalScore = 0;
  } else if (isLastLeg) {
    finalEggPoints = computeFinalEggPoints(bankedAfter, p);
    finalScore = computeFinalScore(finalEggPoints, totalSimulatedTimeCs);
    if (p === 'gholdengo' && finalEggPoints !== bankedAfter) {
      events.push(pokemonEvent(p, `raised final egg points from ${bankedAfter} to ${finalEggPoints}`));
    }
  }

  const resolution: LegResolution = {
    rulesVersion: RULES_VERSION,
    legIndex: leg,
    legName: legDef.name,
    weather,
    route,
    pushLevel: level,
    staminaCost: prepared.staminaCost,
    eggOffer: offer,
    eggDecision: egg,
    draws: { crash: draws.crash, eggFailure: draws.eggFailure, hyde: draws.hyde },
    crashProbability,
    crashOccurred,
    crashNegatedBy,
    crashHpLoss,
    eggAttempted,
    eggFailed,
    eggPointsProvisional,
    eggPointsLostToCatch,
    eggPointsBanked,
    gapStartM: gapStart,
    gapDeltas,
    gapBeforeCatchM,
    hydeProbability,
    hydeCatch,
    catchType,
    catchNumber,
    catchHpLoss,
    gapEndM,
    hpStart,
    hpEnd,
    staminaStart,
    staminaEnd,
    bankedBefore,
    bankedAfter,
    time,
    abilityEvents: events,
    outcome,
    dnfReason,
  };

  const next: GameState = {
    ...state,
    revision: state.revision + 1,
    hp: hpEnd,
    stamina: staminaEnd,
    pursuitGapM: gapEndM,
    hydeCatchCount,
    bankedEggPoints: bankedAfter,
    unbankedEggPoints: survived ? 0 : unbankedAfterCatch,
    totalSimulatedTimeCs,
    flags,
    prepared: null,
    legResults: [...state.legResults, resolution],
    finalEggPoints,
    finalScore,
    dnfReason,
    status: !survived ? 'dnf' : isLastLeg ? 'completed' : 'in_progress',
    phase: !survived || isLastLeg ? 'complete' : 'awaiting_route',
    legIndex: survived && !isLastLeg ? ((leg + 1) as LegIndex) : leg,
  };
  return { state: next, resolution };
}

// ---------------------------------------------------------------------------------------------------------------
// Abandon
// ---------------------------------------------------------------------------------------------------------------

/** Player reset: in-progress session becomes abandoned/unranked. Terminal sessions are returned unchanged. */
export function abandonSession(state: GameState): GameState {
  if (state.status !== 'in_progress') return state;
  return {
    ...state,
    status: 'abandoned',
    phase: 'complete',
    prepared: null,
    finalScore: null,
    finalEggPoints: null,
    revision: state.revision + 1,
  };
}
