// Simulation helpers for tests, synthetic data and the Monte Carlo advisor. Never used for trusted session rolls.
import { deriveLegContext, deriveLegDraws, eggTierFromUniform, weatherFromUniform } from './random.ts';
import { buildLegView, createInitialState, getPushOptions, prepareLeg, resolvePreparedLeg } from './rules.ts';
import type {
  CharacterId, EggDecision, EggTier, GameState, LegChoice, LegContext, LegDraws, LegIndex, LegView, PokemonId,
  PushOption, RouteId,
} from './types.ts';

export type RacePolicy = {
  chooseLeg(state: GameState, view: LegView, options: PushOption[]): LegChoice;
  chooseEgg(state: GameState, offer: EggTier): EggDecision;
};

/** Sampled leg context: consumes exactly 3 uniforms (weather, safe offer, shortcut offer). */
export function sampleLegContext(rng: () => number, leg: LegIndex): LegContext {
  const weather = weatherFromUniform(rng());
  const safe = eggTierFromUniform(rng(), 'safe', leg);
  const shortcut = eggTierFromUniform(rng(), 'shortcut', leg);
  return { legIndex: leg, weather, offers: { safe, shortcut } };
}

/** Sampled draws: consumes exactly 3 uniforms (crash, eggFailure, hyde) regardless of use. */
export function sampleLegDraws(rng: () => number): LegDraws {
  const crash = rng();
  const eggFailure = rng();
  const hyde = rng();
  return { crash, eggFailure, hyde };
}

function fail(message: string): never {
  throw new Error(`simulation: ${message}`);
}

/** Plays one leg (prepare + resolve) from awaiting_route. Throws on a rejected action (policy bug). */
function playLeg(state: GameState, ctx: LegContext, draws: LegDraws, policy: RacePolicy): GameState {
  const view = buildLegView(state, ctx);
  const choice = policy.chooseLeg(state, view, getPushOptions(state));
  const prepared = prepareLeg(state, ctx, choice, state.revision);
  if (!prepared.ok) fail(`${prepared.error.code}: ${prepared.error.message}`);
  return finishLeg(prepared.state, ctx, draws, policy);
}

/** Resolves a prepared leg (awaiting_egg). A collect on 'none' is coerced to skip. */
function finishLeg(state: GameState, ctx: LegContext, draws: LegDraws, policy: RacePolicy): GameState {
  const offer = state.prepared!.selectedOffer;
  const egg: EggDecision = offer === 'none' ? 'skip' : policy.chooseEgg(state, offer);
  const resolved = resolvePreparedLeg(state, ctx, draws, egg, state.revision);
  if (!resolved.ok) fail(`${resolved.error.code}: ${resolved.error.message}`);
  return resolved.state;
}

/** Full race reproducing a trusted session: contexts/draws come from the seed exactly like the Edge Functions. */
export function simulateRace(i: {
  seed: string;
  characterId: CharacterId;
  pokemonId: PokemonId;
  policy: RacePolicy;
  sessionId?: string;
  nickname?: string;
}): { state: GameState; contexts: LegContext[] } {
  let state = createInitialState({
    sessionId: i.sessionId ?? `sim-${i.seed}`,
    nickname: i.nickname ?? 'Simulator',
    characterId: i.characterId,
    pokemonId: i.pokemonId,
  });
  const contexts: LegContext[] = [];
  while (state.status === 'in_progress') {
    const leg = state.legIndex;
    const ctx = deriveLegContext(i.seed, leg);
    contexts.push(ctx);
    state = playLeg(state, ctx, deriveLegDraws(i.seed, leg), i.policy);
  }
  return { state, contexts };
}

/**
 * Monte Carlo rollout primitive: continues an in-progress state to completion with sampled (not seed-secret)
 * contexts and draws. Accepts phase awaiting_route (samples context then draws) or awaiting_egg (the prepared
 * weather/offer are already fixed; only draws are sampled). Each leg consumes exactly 6 (or 3) uniforms.
 */
export function simulateFromState(state: GameState, rng: () => number, policy: RacePolicy): GameState {
  let s = state;
  if (s.status === 'in_progress' && s.phase === 'awaiting_egg' && s.prepared) {
    const p = s.prepared;
    const other: RouteId = p.route === 'safe' ? 'shortcut' : 'safe';
    const ctx = { legIndex: p.legIndex, weather: p.weather, offers: { [p.route]: p.selectedOffer, [other]: 'none' } } as LegContext;
    s = finishLeg(s, ctx, sampleLegDraws(rng), policy);
  }
  while (s.status === 'in_progress') {
    if (s.phase !== 'awaiting_route') fail(`unexpected phase ${s.phase}`);
    const ctx = sampleLegContext(rng, s.legIndex);
    s = playLeg(s, ctx, sampleLegDraws(rng), policy);
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Reusable policies
// ---------------------------------------------------------------------------------------------------------------

function highestLegal(options: PushOption[]): PushOption {
  let best: PushOption | null = null;
  for (const o of options) if (o.isLegal && (!best || o.pushLevel > best.pushLevel)) best = o;
  return best ?? fail('no legal push level');
}

const collectIfEgg = (_state: GameState, offer: EggTier): EggDecision => (offer === 'none' ? 'skip' : 'collect');

/** Safe route every leg, highest legal push level, always collect an available egg. */
export const SAFE_POLICY: RacePolicy = {
  chooseLeg: (_state, _view, options) => ({ route: 'safe', pushLevel: highestLegal(options).pushLevel }),
  chooseEgg: collectIfEgg,
};

/** Shortcut every leg, highest legal push level, always collect an available egg. */
export const SHORTCUT_POLICY: RacePolicy = {
  chooseLeg: (_state, _view, options) => ({ route: 'shortcut', pushLevel: highestLegal(options).pushLevel }),
  chooseEgg: collectIfEgg,
};

const ROUTES: readonly RouteId[] = ['safe', 'shortcut'];

/** Uniform over legal (route x push level) pairs using the given stream; collects whenever an egg exists. */
export function randomLegalPolicy(rng: () => number): RacePolicy {
  return {
    chooseLeg: (_state, _view, options) => {
      const legal: LegChoice[] = [];
      for (const route of ROUTES) for (const o of options) if (o.isLegal) legal.push({ route, pushLevel: o.pushLevel });
      if (legal.length === 0) fail('no legal choice');
      return legal[Math.min(legal.length - 1, Math.floor(rng() * legal.length))];
    },
    chooseEgg: collectIfEgg,
  };
}

/** Convenience: fixed policy from a per-leg plan (index 0..2), collecting eggs by default. */
export function fixedPlanPolicy(plan: LegChoice[], egg: (offer: EggTier) => EggDecision = (o) => (o === 'none' ? 'skip' : 'collect')): RacePolicy {
  return {
    chooseLeg: (state) => plan[state.legIndex - 1] ?? fail(`no plan for leg ${state.legIndex}`),
    chooseEgg: (_state, offer) => egg(offer),
  };
}
