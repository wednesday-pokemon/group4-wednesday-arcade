// Death sequence (docs/final/UX_FINAL.md §3; FINAL_CONTRACT §7). Pure state machine on REAL time (ms, performance.now):
//   t0 (`dnf`, once)  input cut, Esc stops pausing (it skips), HUD fades 200 ms, letterbox 0→48 px (instant in reduced
//                     motion), SR assertive "Defeated by {Name}."
//   t0 + 0.5 s        Skip button (Enter / Esc / click) — only a keydown that STARTS after t0 counts (held keys and
//                     auto-repeat never skip)
//   cutscene          scene.playDeath(enemy) when the renderer has it (resolves → card), else a timed stand-in of the
//                     spec length (Hyde 3.2 · Crackstone 4.0 · Slurp 3.6 s); reduced motion: 1.2 s still + 300 ms
//   card              GAME-OVER card; "See results" (Enter) or the 12 s countdown → results
// Skipping changes nothing: the outcome was recorded at t0.
import type { EnemyId } from '../../../mystery/types.ts';
import { ENEMY_SHORT } from './enemies.ts';

export type DeathPhase = 'cutscene' | 'card' | 'done';

export const DEATH_SKIP_AFTER_MS = 500;
export const DEATH_CUTSCENE_MS: Record<EnemyId, number> = { hyde: 3200, crackstone: 4000, slurp: 3600 };
export const DEATH_REDUCED_MS = 1500;
/** Reduced motion: the renderer's still frame (1.2 s); the card then cross-fades in over 300 ms (≤ 1.5 s in total). */
export const DEATH_REDUCED_STILL_MS = 1200;
export const DEATH_CARD_S = 12;
/** If the renderer's playDeath never resolves, the card still comes (cutscene length + this). */
export const DEATH_SAFETY_MS = 2500;

export const DEATH_FLAVOUR: Record<EnemyId, string> = {
  hyde: 'It followed your sound out of the fog.',
  crackstone: 'His curse caught you in the open.',
  slurp: 'Slurp lurched out of the dark and grabbed you.',
};
export const DEATH_CAPTION: Record<EnemyId, string> = {
  hyde: '[The Hyde lunges]',
  crackstone: '[A curse flares]',
  slurp: '[Slurp groans and grabs]',
};

export interface DeathState {
  enemy: EnemyId;
  t0: number;
  phase: DeathPhase;
  reduced: boolean;
  /** When the cutscene ends by itself (stand-in / safety). */
  cutsceneEndsAt: number;
  cardAt: number | null;
  skipped: boolean;
  /** The renderer is playing it (scene.playDeath existed). */
  rendered: boolean;
  /** t0 on the KEYBOARD clock (KeyboardEvent.timeStamp = performance.now()): only keydowns starting after it skip. */
  keyT0: number;
  /** The renderer's playDeath() resolved at (ms), null before. The card waits for at least `minMs` after t0. */
  rendererDoneAt: number | null;
  /** Shortest cutscene shown when the renderer finishes early (reduced motion: 1.2 s still + 300 ms crossfade). */
  minMs: number;
  /** ms from t0 to the card (debug / tests). */
  cardAfterMs: number | null;
}

export class DeathSequence {
  state: DeathState | null = null;

  /** t0. Returns false when a sequence already ran (it triggers once). */
  start(enemy: EnemyId, now: number, o: { reduced: boolean; rendered: boolean; keyT0?: number }): boolean {
    if (this.state) return false;
    const len = o.reduced ? DEATH_REDUCED_MS : DEATH_CUTSCENE_MS[enemy];
    this.state = {
      enemy, t0: now, phase: 'cutscene', reduced: o.reduced, cutsceneEndsAt: now + len + (o.rendered ? DEATH_SAFETY_MS : 0), cardAt: null, skipped: false,
      rendered: o.rendered, keyT0: o.keyT0 ?? now, rendererDoneAt: null, minMs: o.reduced ? DEATH_REDUCED_STILL_MS : len - 400, cardAfterMs: null,
    };
    return true;
  }

  get active(): boolean {
    return this.state !== null && this.state.phase !== 'done';
  }

  /** Skip is offered from t0 + 0.5 s until the card. */
  skipVisible(now: number): boolean {
    const s = this.state;
    return !!s && s.phase === 'cutscene' && now - s.t0 >= DEATH_SKIP_AFTER_MS;
  }

  /**
   * A skip input (Enter / Esc keydown or a click). `startedAt` = the keydown's timeStamp (keyboard clock, see keyT0); a
   * repeat or a key that went down before t0 is ignored. Returns true when it jumped to the card.
   */
  skip(now: number, input: { startedAt: number; repeat?: boolean; click?: boolean }): boolean {
    const s = this.state;
    if (!s || s.phase !== 'cutscene') return false;
    if (!input.click && (input.repeat || input.startedAt < s.keyT0)) return false;
    if (now - s.t0 < DEATH_SKIP_AFTER_MS) return false;
    s.skipped = true;
    this.toCard(now);
    return true;
  }

  /** The renderer's cutscene finished: the card follows once the minimum length has passed (see tick). */
  cutsceneDone(now: number): void {
    const s = this.state;
    if (!s || s.phase !== 'cutscene') return;
    s.rendererDoneAt ??= now;
    if (now - s.t0 >= s.minMs) this.toCard(now);
  }

  /** Advance timers; returns 'continue' once the card's countdown runs out. */
  tick(now: number): 'continue' | null {
    const s = this.state;
    if (!s) return null;
    if (s.phase === 'cutscene' && (now >= s.cutsceneEndsAt || (s.rendererDoneAt !== null && now - s.t0 >= s.minMs))) this.toCard(now);
    if (s.phase === 'card' && s.cardAt !== null && now - s.cardAt >= DEATH_CARD_S * 1000) {
      s.phase = 'done';
      return 'continue';
    }
    return null;
  }

  /** "See results" pressed. Returns true the first time. */
  continue(): boolean {
    const s = this.state;
    if (!s || s.phase !== 'card') return false;
    s.phase = 'done';
    return true;
  }

  /** Seconds left on the card countdown ("Results in {n} s"). */
  countdownS(now: number): number | null {
    const s = this.state;
    if (!s || s.phase !== 'card' || s.cardAt === null) return null;
    return Math.max(0, Math.ceil(DEATH_CARD_S - (now - s.cardAt) / 1000));
  }

  private toCard(now: number): void {
    const s = this.state!;
    s.phase = 'card';
    s.cardAt = now;
    s.cardAfterMs = Math.round(now - s.t0);
  }
}

/** The enemy that ended the run: dnf.by, else the last monster hit, else the Hyde (second catch). */
export function defeatedBy(by: EnemyId | null | undefined, lastHit: EnemyId | null): EnemyId {
  return by ?? lastHit ?? 'hyde';
}

export function defeatedLine(e: EnemyId): string {
  return `Defeated by ${ENEMY_SHORT[e]}.`;
}

/** "2:14 played · 2/3 clues · 3 hits" */
export function deathTally(activeS: number, clues: number, total: number, hits: number): string {
  const v = Math.max(0, Math.floor(activeS));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')} played · ${clues}/${total} clues · ${hits} hit${hits === 1 ? '' : 's'}`;
}

/** "RUN OVER · CASE 02" */
export function deathKicker(caseNumber: string): string {
  return `RUN OVER · CASE ${caseNumber}`;
}

/**
 * WHY lines (≤ 52 chars each, ≤ 2): the diagnostic engine's dnf cause, else the rule fact (second catch / HP), plus the
 * last WHY card about that enemy when it is recent. Never invents a cause.
 */
export function deathWhy(o: { reason: 'second_catch' | 'hp_depleted' | null; enemy: EnemyId; hits: number; lastWhy: string | null; diag?: string | null }): string[] {
  const out: string[] = [];
  if (o.diag) out.push(o.diag);
  else if (o.reason === 'second_catch') out.push(`${ENEMY_SHORT[o.enemy]} caught you a second time.`);
  else if (o.reason === 'hp_depleted') out.push(`Your HP ran out after ${o.hits} hit${o.hits === 1 ? '' : 's'}.`);
  if (o.lastWhy && !out.includes(o.lastWhy)) out.push(o.lastWhy);
  return out.slice(0, 2).map((l) => (l.length <= 52 ? l : `${l.slice(0, 51).trimEnd()}…`));
}
