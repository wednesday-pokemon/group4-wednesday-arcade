// Vitals Tally row (docs/final/UX_FINAL.md §1b): "TALLY · Seen n · Hits n · Hints n" counted from the RULE events the
// score uses (enemy_detected / enemy_hit / hint_requested — FINAL_CONTRACT §1). Older sims without the final rule events
// fall back to the overhaul equivalents (Hyde CHASE onset / Crackstone encounter start, catch / curse hit) — never both:
// once the run emits any final event (or exposes a director), only the final events count. Each increment pulses once.
import type { StampedEvent } from '../../../mystery/types.ts';

export type TallyKey = 'seen' | 'hits' | 'hints';

export interface TallyView {
  seen: number;
  hits: number;
  hints: number;
  /** Bump ids (increment count) so the view re-keys a 600 ms pulse per increment. */
  bump: Record<TallyKey, number>;
}

const FINAL_TYPES: ReadonlySet<string> = new Set(['enemy_detected', 'enemy_hit', 'enemy_spawned', 'enemy_despawned', 'slurp_mode', 'cabinet']);

export class TallyTracker {
  private final = { seen: 0, hits: 0 };
  private legacy = { seen: 0, hits: 0 };
  hints = 0;
  private finalSim: boolean;
  readonly bump: Record<TallyKey, number> = { seen: 0, hits: 0, hints: 0 };
  private shown = { seen: 0, hits: 0, hints: 0 };

  constructor(finalSim = false) {
    this.finalSim = finalSim;
  }

  update(events: readonly StampedEvent[]): void {
    for (const e of events) {
      if (FINAL_TYPES.has(e.type)) this.finalSim = true;
      switch (e.type) {
        case 'enemy_detected':
          this.final.seen++;
          break;
        case 'enemy_hit':
          this.final.hits++;
          break;
        case 'hint_requested':
          this.hints++;
          break;
        case 'hyde_mode':
          if (e.to === 'CHASE') this.legacy.seen++;
          break;
        case 'crackstone_mode':
          if (e.to === 'CHASE' && e.from !== 'ATTACK' && (e.reason === 'saw_player' || e.reason === 'sensed_player' || e.reason === 'scan_hit')) this.legacy.seen++;
          break;
        case 'catch':
          this.legacy.hits++;
          break;
        case 'curse':
          if (e.phase === 'hit') this.legacy.hits++;
          break;
        default:
          break;
      }
    }
  }

  view(): TallyView {
    const src = this.finalSim ? this.final : this.legacy;
    const now = { seen: src.seen, hits: src.hits, hints: this.hints };
    for (const k of ['seen', 'hits', 'hints'] as const) {
      if (now[k] > this.shown[k]) this.bump[k]++;
      this.shown[k] = now[k];
    }
    return { ...now, bump: { ...this.bump } };
  }
}

export const TALLY_COPY = { head: 'TALLY', seen: 'Seen', hits: 'Hits', hints: 'Hints' } as const;
