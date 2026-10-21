import {
  createInitialState, prepareLeg, resolvePreparedLeg,
} from '../../../src/game/index.ts';
import type {
  CharacterId, EggDecision, EggTier, GameState, LegChoice, LegContext, LegDraws, LegIndex, LegResolution, PokemonId,
  RouteId, WeatherId,
} from '../../../src/game/index.ts';

export function makeState(characterId: CharacterId, pokemonId: PokemonId, overrides: Partial<GameState> = {}): GameState {
  return { ...createInitialState({ sessionId: 's-1', nickname: 'Tester', characterId, pokemonId }), ...overrides };
}

export function ctx(
  legIndex: LegIndex,
  weather: WeatherId = 'clear',
  offers: Partial<Record<RouteId, EggTier>> = {},
): LegContext {
  return { legIndex, weather, offers: { safe: offers.safe ?? 'none', shortcut: offers.shortcut ?? 'none' } };
}

/** Draw helpers: 0 forces any p>0 event, 0.999999 prevents any p<=0.95 event. */
export const ALWAYS = 0;
export const NEVER = 0.999999;
export function draws(crash = NEVER, eggFailure = NEVER, hyde = NEVER): LegDraws {
  return { crash, eggFailure, hyde };
}

/** Prepare + resolve one leg; throws on rejection. */
export function play(
  state: GameState,
  context: LegContext,
  choice: LegChoice,
  egg: EggDecision = 'skip',
  d: LegDraws = draws(),
): { state: GameState; resolution: LegResolution } {
  const p = prepareLeg(state, context, choice, state.revision);
  if (!p.ok) throw new Error(`prepare rejected: ${p.error.code} ${p.error.message}`);
  const r = resolvePreparedLeg(p.state, context, d, egg, p.state.revision);
  if (!r.ok) throw new Error(`resolve rejected: ${r.error.code} ${r.error.message}`);
  return { state: r.state, resolution: r.resolution };
}

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

export const safe = (pushLevel: 1 | 2 | 3): LegChoice => ({ route: 'safe', pushLevel });
export const shortcut = (pushLevel: 1 | 2 | 3): LegChoice => ({ route: 'shortcut', pushLevel });
