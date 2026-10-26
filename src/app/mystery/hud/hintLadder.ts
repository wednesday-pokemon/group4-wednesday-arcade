// Progressive hint ladder (UX_OVERHAUL §5, ruling R7). The frontend owns the no-progress timer and V; the analytics
// layer supplies each level's content + target (analytics.hint(level)).
//   L0 always: glints, shimmer, outlines, area circles.
//   L1 at 40 s idle (or V): THING'S LOG area line; area circles pulse once.
//   L2 at 80 s (or V again): ADVICE "Try the Greenhouse Annex. Clue chance 80%." — that area lantern on compass +
//      minimap for 16 s, its candidate pips appear.
//   L3 at 120 s (or V again): the most likely candidate site (Bayesian; may be wrong) + a dotted route for 10 s.
// The timer pauses in SEARCH / CHASE / overlays and resets on progress (clue found, egg pickup, site checked).
// V jumps one level (L3 repeats L3) with a 10 s cooldown.

export type HintLevel = 0 | 1 | 2 | 3;
export const HINT_IDLE_S = [40, 80, 120] as const;
export const HINT_V_COOLDOWN_S = 10;
/** How long an L2 area stays lantern / an L3 site + route stays drawn (seconds). */
export const HINT_SHOW_S = { 2: 16, 3: 10 } as const;

export class HintLadder {
  level: HintLevel = 0;
  idleS = 0;
  private lastV = -Infinity;

  /** Advance the idle timer. Returns the level just reached (1–3), or null. */
  tick(dt: number, paused: boolean): 1 | 2 | 3 | null {
    if (paused || dt <= 0) return null;
    this.idleS += dt;
    const reached: HintLevel = this.idleS >= HINT_IDLE_S[2] ? 3 : this.idleS >= HINT_IDLE_S[1] ? 2 : this.idleS >= HINT_IDLE_S[0] ? 1 : 0;
    if (reached > this.level) {
      this.level = reached;
      return reached as 1 | 2 | 3;
    }
    return null;
  }

  /** The visitor made progress: back to L0, the timer restarts. */
  progress(): void {
    this.level = 0;
    this.idleS = 0;
  }

  /** V: one level up (L3 repeats). null while the 10 s cooldown runs. */
  request(now: number): 1 | 2 | 3 | null {
    if (now - this.lastV < HINT_V_COOLDOWN_S) return null;
    this.lastV = now;
    const next = Math.min(3, this.level + 1) as 1 | 2 | 3;
    this.level = next;
    // keep the idle clock at (at least) this level's threshold so the timer does not re-announce it
    this.idleS = Math.max(this.idleS, HINT_IDLE_S[next - 1]);
    return next;
  }

  cooldownLeftS(now: number): number {
    return Math.max(0, Math.ceil(HINT_V_COOLDOWN_S - (now - this.lastV)));
  }

  /**
   * One V press. During a threat with a feasible action available, V answers with that advice (UX §6 P4) and the
   * ladder level stays put — but the 10 s cooldown starts in BOTH cases, so mashing V never stacks cards.
   */
  press(now: number, threatAdvice: boolean): { kind: 'advice' } | { kind: 'level'; level: 1 | 2 | 3 } | null {
    if (now - this.lastV < HINT_V_COOLDOWN_S) return null;
    if (threatAdvice) {
      this.lastV = now;
      return { kind: 'advice' };
    }
    const level = this.request(now);
    return level ? { kind: 'level', level } : null;
  }
}

/**
 * The idle timer pauses while nothing should nag (UX §5): not playing, the Hyde searching / chasing, nothing left to find
 * (deliver / accuse have their own route + tower marker), or the visitor is busy with a hold (search, egg, examine, lever).
 */
export function ladderPaused(s: {
  status: string; emerged: boolean; hydeMode: string; objective: string; interacting: { target: string } | null;
}): boolean {
  if (s.status !== 'playing') return true;
  if (s.emerged && (s.hydeMode === 'SEARCH' || s.hydeMode === 'CHASE')) return true;
  if (!(s.objective === 'find_clues' || s.objective === 'find_egg' || s.objective === 'retrieve_egg')) return true;
  return s.interacting !== null;
}
