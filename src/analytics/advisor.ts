// Wednesday's Strategic Advice — prescriptive layer (GDD 8.3).
// Maximise expected final score subject to cumulative P(DNF) <= 25 %, using seed-independent Monte Carlo
// continuations with common random numbers. Unknown egg tiers are integrated over their probabilities.
import {
  ADVISOR, EGG_POINTS, eggTierFromUniform, getPushOptions, LEGS, prepareLeg, resolvePreparedLeg, simulateFromState,
  createStream,
} from '../game/index.ts';
import type {
  Advice, AdviceCandidate, EggDecision, EggTier, GameState, LegChoice, LegContext, LegView, RacePolicy, RouteId,
} from '../game/index.ts';
import { FUTURE_POLICIES } from './policies.ts';

const ROUND_SIZE = 64;

export interface AdvisorOptions {
  rollouts?: number;
  timeBudgetMs?: number;
  riskCap?: number;
}

interface Tally { scoreSum: number; dnfCount: number; n: number }

interface FirstMove { choice: LegChoice; egg?: EggDecision }

/** Seed-independent key: the advisor must never depend on the secret session seed. */
export function adviceStateKey(state: GameState, view: LegView): string {
  const { characterId, pokemonId, legIndex, phase, hp, stamina, pursuitGapM, hydeCatchCount, bankedEggPoints,
    unbankedEggPoints, totalSimulatedTimeCs, flags, prepared } = state;
  return JSON.stringify([characterId, pokemonId, legIndex, phase, hp, stamina, pursuitGapM, hydeCatchCount,
    bankedEggPoints, unbankedEggPoints, totalSimulatedTimeCs, flags, prepared?.route, prepared?.pushLevel,
    view.weather, view.visibleOffers]);
}

function rolloutOnce(state: GameState, view: LegView, move: FirstMove, policy: RacePolicy, rng: () => number): GameState {
  // Always consume the same draws in the same order so every candidate sees common random numbers.
  const offerU = { safe: rng(), shortcut: rng() };
  const draws = { crash: rng(), eggFailure: rng(), hyde: rng() };
  const offerFor = (route: RouteId): EggTier =>
    view.visibleOffers[route] ?? eggTierFromUniform(offerU[route], route, state.legIndex);
  const ctx: LegContext = { legIndex: state.legIndex, weather: view.weather, offers: { safe: offerFor('safe'), shortcut: offerFor('shortcut') } };

  let current = state;
  if (current.phase === 'awaiting_route') {
    const prepared = prepareLeg(current, ctx, move.choice, current.revision);
    if (!prepared.ok) throw new Error(`Advisor evaluated an illegal move: ${prepared.error.message}`);
    current = prepared.state;
  }
  const offer = current.prepared?.selectedOffer ?? 'none';
  const egg = move.egg ?? (offer === 'none' ? 'skip' : 'collect');
  const resolved = resolvePreparedLeg(current, ctx, draws, egg, current.revision);
  if (!resolved.ok) throw new Error(`Advisor resolve failed: ${resolved.error.message}`);
  return resolved.state.phase === 'complete' ? resolved.state : simulateFromState(resolved.state, rng, policy);
}

function pick<T extends { pDnf: number; expectedScore: number }>(items: T[], cap: number): { best: T; meetsCap: boolean } {
  const within = items.filter((i) => i.pDnf <= cap);
  if (within.length > 0) return { best: within.reduce((a, b) => (b.expectedScore > a.expectedScore ? b : a)), meetsCap: true };
  const best = items.reduce((a, b) => (b.pDnf < a.pDnf || (b.pDnf === a.pDnf && b.expectedScore > a.expectedScore) ? b : a));
  return { best, meetsCap: false };
}

function evaluateMoves(state: GameState, view: LegView, moves: FirstMove[], opts: Required<AdvisorOptions>) {
  const started = now();
  const policies = Object.entries(FUTURE_POLICIES);
  const tallies = moves.map(() => policies.map((): Tally => ({ scoreSum: 0, dnfCount: 0, n: 0 })));
  const key = adviceStateKey(state, view);
  let done = 0;
  while (done < opts.rollouts) {
    const roundEnd = Math.min(opts.rollouts, done + ROUND_SIZE);
    for (let i = done; i < roundEnd; i++) {
      moves.forEach((move, m) => policies.forEach(([, policy], p) => {
        const final = rolloutOnce(state, view, move, policy, createStream(`advisor|${key}|${i}`));
        const t = tallies[m][p];
        t.n++;
        if (final.status === 'dnf') t.dnfCount++;
        else t.scoreSum += final.finalScore ?? 0;
      }));
    }
    done = roundEnd;
    if (now() - started > opts.timeBudgetMs) break;
  }
  const results = moves.map((move, m) => {
    const perPolicy = policies.map(([name], p) => {
      const t = tallies[m][p];
      return { name, expectedScore: t.scoreSum / t.n, pDnf: t.dnfCount / t.n };
    });
    const { best, meetsCap } = pick(perPolicy, opts.riskCap);
    return { move, expectedScore: best.expectedScore, pDnf: best.pDnf, meetsRiskCap: meetsCap, bestFuturePolicy: best.name };
  });
  return { results, rollouts: done, elapsedMs: now() - started };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function withDefaults(o: AdvisorOptions): Required<AdvisorOptions> {
  return {
    rollouts: o.rollouts ?? ADVISOR.rolloutsPerCandidate,
    timeBudgetMs: o.timeBudgetMs ?? ADVISOR.timeBudgetMs,
    riskCap: o.riskCap ?? ADVISOR.maxDnfRisk,
  };
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const routeName = (r: RouteId) => (r === 'safe' ? 'Safe route' : 'Shortcut');

function routeReasons(state: GameState, view: LegView, best: AdviceCandidate, all: AdviceCandidate[]): string[] {
  const leg = LEGS[state.legIndex];
  const reasons: string[] = [];
  if (best.route === 'safe') {
    reasons.push('The Safe route has no crash risk and Hyde cannot roll a catch — only proximity can catch you.');
  } else {
    reasons.push(`The Shortcut is ${leg.safeBaseS - leg.shortcutBaseS} s shorter and carries richer eggs, but risks a crash (${pct(leg.shortcutCrashP)}) and a Hyde roll.`);
  }
  if (view.weather === 'heavy_fog' && best.route === 'shortcut') reasons.push('Heavy Fog makes the Shortcut riskier: +15 pts Hyde risk and 10 m less lead.');
  if (state.hydeCatchCount === 1) reasons.push('Hyde already caught you once — a second catch ends the race.');
  const remainingLegs = 3 - state.legIndex;
  if (remainingLegs > 0) reasons.push(`Push ${best.pushLevel} keeps enough stamina for the ${remainingLegs} remaining leg${remainingLegs > 1 ? 's' : ''}.`);
  const other = all.filter((c) => c.route !== best.route && c.isLegal).sort((a, b) => b.expectedScore - a.expectedScore)[0];
  if (other) reasons.push(`${routeName(other.route)} best case: ${Math.round(other.expectedScore)} expected points, ${pct(other.pDnf)} race-ending risk.`);
  return reasons;
}

function summarise(kind: Advice['kind'], candidates: AdviceCandidate[], recommendedEgg: EggDecision | undefined,
  rollouts: number, elapsedMs: number, opts: Required<AdvisorOptions>): Omit<Advice, 'reasons' | 'headline'> & { best: AdviceCandidate } {
  const legal = candidates.filter((c) => c.isLegal);
  const { best, meetsCap } = pick(legal, opts.riskCap);
  const approximate = rollouts < opts.rollouts;
  const warnings = [
    !meetsCap ? `Every option carries more than ${pct(opts.riskCap)} race-ending risk; this is the least risky choice.` : null,
    approximate ? `Quick estimate: ${rollouts} simulations per option (time limit reached).` : null,
  ].filter(Boolean);
  return {
    kind, best,
    recommended: { route: best.route, pushLevel: best.pushLevel, ...(recommendedEgg ? { eggDecision: recommendedEgg } : {}) },
    candidates, riskCap: opts.riskCap, constraintMet: meetsCap, warning: warnings.length ? warnings.join(' ') : null,
    method: 'monte_carlo', rolloutsPerCandidate: rollouts, elapsedMs: Math.round(elapsedMs),
  };
}

/** Advice before the route is chosen: every legal route × push level is a candidate first move. */
export function adviseRoute(state: GameState, view: LegView, options: AdvisorOptions = {}): Advice {
  const opts = withDefaults(options);
  const pushOptions = getPushOptions(state);
  const moves: FirstMove[] = (['safe', 'shortcut'] as RouteId[]).flatMap((route) =>
    pushOptions.filter((o) => o.isLegal).map((o) => ({ choice: { route, pushLevel: o.pushLevel } })));
  const { results, rollouts, elapsedMs } = evaluateMoves(state, view, moves, opts);
  const candidates: AdviceCandidate[] = results.map((r) => ({
    ...r.move.choice, isLegal: true, expectedScore: r.expectedScore, pDnf: r.pDnf, meetsRiskCap: r.meetsRiskCap, bestFuturePolicy: r.bestFuturePolicy,
  }));
  const s = summarise('route', candidates, undefined, rollouts, elapsedMs, opts);
  const { best, ...advice } = s;
  return {
    ...advice,
    headline: `${routeName(best.route)} with push ${best.pushLevel}`,
    reasons: routeReasons(state, view, best, candidates),
  };
}

/** Advice after the egg is revealed: Collect vs Skip on the locked route. */
export function adviseEgg(state: GameState, view: LegView, options: AdvisorOptions = {}): Advice {
  const opts = withDefaults(options);
  const prepared = state.prepared;
  if (!prepared) throw new Error('adviseEgg requires a prepared leg');
  const choice = { route: prepared.route, pushLevel: prepared.pushLevel };
  const decisions: EggDecision[] = prepared.selectedOffer === 'none' ? ['skip'] : ['collect', 'skip'];
  const { results, rollouts, elapsedMs } = evaluateMoves(state, view, decisions.map((egg) => ({ choice, egg })), opts);
  const candidates: AdviceCandidate[] = results.map((r) => ({
    ...choice, isLegal: true, expectedScore: r.expectedScore, pDnf: r.pDnf, meetsRiskCap: r.meetsRiskCap, bestFuturePolicy: r.bestFuturePolicy,
  }));
  const bestIndex = candidates.indexOf(pick(candidates, opts.riskCap).best);
  const egg = decisions[bestIndex];
  const s = summarise('egg', candidates, egg, rollouts, elapsedMs, opts);
  const { best: _best, ...advice } = s;
  const points = EGG_POINTS[prepared.selectedOffer];
  return {
    ...advice,
    headline: egg === 'collect' ? 'Collect the egg' : 'Skip it',
    reasons: prepared.selectedOffer === 'none'
      ? ['There is no egg on this route.']
      : [
          `Worth ${points} point${points > 1 ? 's' : ''} (${points * 100} score) for only +5 s.`,
          ...(prepared.route === 'shortcut' ? ['If you crash, there is a 25% chance the egg slips away (the 5 s are still spent).'] : []),
          'Eggs are only safe once you reach the dock — a Hyde catch can steal half of them.',
        ],
  };
}
