// Response redaction. Pure module; unit-tested under Node/Vitest.
//
// Why: the engine's keyed RNG (src/game/random.ts, FNV-1a + murmur3, 32-bit states) is NOT a cryptographic
// PRF. Each LegResolution carries the raw uniform `draws`; a 53-bit draw exposes ~27+26 bits of the two
// internal hash states after the `${seed}|` prefix, and two draws pin them down. From those states every
// future draw (weather, egg offers, crash, Hyde) of the SAME session can be computed offline without the
// seed. So while a session is in progress the server strips every draw value from what it returns/stores
// for clients. Once the session has ended the seed itself is revealed, so draws are returned in full.
// (docs/SECURITY.md T-06b; the long-term fix is an HMAC/SHA-256 based keyedUniform in a future rules version.)
import type { GameState, LegDraws, LegResolution, SessionView } from './game/index.ts';

export type PublicLegResolution = Omit<LegResolution, 'draws'> & { draws: LegDraws | null };
export type PublicGameState = Omit<GameState, 'legResults'> & { legResults: PublicLegResolution[] };
export type PublicSessionView = Omit<SessionView, 'state'> & { state: PublicGameState };

export function isSessionOpen(state: Pick<GameState, 'status'>): boolean {
  return state.status === 'in_progress';
}

export function redactResolution(resolution: LegResolution, sessionOpen: boolean): PublicLegResolution {
  return sessionOpen ? { ...resolution, draws: null } : { ...resolution };
}

/** Client-safe copy of an engine SessionView. Never mutates its input. */
export function redactView(view: SessionView): PublicSessionView {
  const open = isSessionOpen(view.state);
  return {
    ...view,
    revealedSeed: open ? null : view.revealedSeed,
    state: { ...view.state, legResults: view.state.legResults.map((r) => redactResolution(r, open)) },
  };
}
