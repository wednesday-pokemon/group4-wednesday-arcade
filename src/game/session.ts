// Seed wrappers: the same code runs in the LOCAL DEMO adapter and the trusted Edge Functions.
// The seed is the only secret; contexts and draws are derived from it with fixed keys.
import { deriveLegContext, deriveLegDraws } from './random.ts';
import { buildLegView, prepareLeg, resolvePreparedLeg } from './rules.ts';
import type { Result } from './rules.ts';
import type { EggDecision, GameState, LegChoice, LegResolution, SessionView } from './types.ts';

export function prepareWithSeed(
  state: GameState,
  seed: string,
  choice: LegChoice,
  expectedRevision: number,
): Result<{ state: GameState }> {
  return prepareLeg(state, deriveLegContext(seed, state.legIndex), choice, expectedRevision);
}

export function resolveWithSeed(
  state: GameState,
  seed: string,
  egg: EggDecision,
  expectedRevision: number,
): Result<{ state: GameState; resolution: LegResolution }> {
  const leg = state.legIndex;
  return resolvePreparedLeg(state, deriveLegContext(seed, leg), deriveLegDraws(seed, leg), egg, expectedRevision);
}

/** Client-safe view. Leg view only while in progress; the seed is revealed only once the session has ended. */
export function buildSessionView(
  state: GameState,
  seed: string,
  verified: boolean,
  seedCommitment: string | null,
): SessionView {
  const inProgress = state.status === 'in_progress';
  return {
    state,
    leg: inProgress ? buildLegView(state, deriveLegContext(seed, state.legIndex)) : null,
    verified,
    seedCommitment,
    revealedSeed: inProgress ? null : seed,
  };
}
