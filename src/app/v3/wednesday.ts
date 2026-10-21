// Wednesday's live advice line (GDD §13 + UX_V3_ACTION §7). Pure arbitration, no React:
//  * ≤ 48 chars, shown 2.5 s; ≥ 6 s between lines (start to start); each line ≤ 2× per run;
//  * ≥ 2 s after any toast; never during rescue, cinematic, tutorial steps or one-shot hints;
//  * highest priority wins; a higher one may replace the current line after it has shown ≥ 1 s;
//  * event triggers older than 1.5 s are dropped; queue depth 1.

export type WednesdayId =
  | 'surge' | 'close_ready' | 'close_not_ready' | 'first_catch' | 'stamina' | 'mashing' | 'collisions'
  | 'rocks' | 'fog' | 'current' | 'smug' | 'idle';

export const WEDNESDAY_LINES: Record<WednesdayId, { prio: number; text: string }> = {
  surge: { prio: 1, text: 'He’s surging. Row like you mean it.' },
  close_ready: { prio: 2, text: 'Use your Pokémon ability. Now.' },
  close_not_ready: { prio: 3, text: 'He’s close. Row, don’t think.' },
  first_catch: { prio: 4, text: 'One more grab and we’re his.' },
  stamina: { prio: 9, text: 'You’re spent. Glide with W, briefly.' },
  mashing: { prio: 10, text: 'Mashing isn’t rowing. Find a rhythm.' },
  collisions: { prio: 11, text: 'Fewer rocks. More lake.' },
  rocks: { prio: 12, text: 'Rocks ahead. Line up first.' },
  fog: { prio: 13, text: 'Fog. Slow hands, sharp eyes.' },
  current: { prio: 14, text: 'The current wants you. Steer against it.' },
  smug: { prio: 19, text: 'He’s falling behind. Don’t get smug.' },
  idle: { prio: 20, text: 'Rowing requires SPACE. Repeatedly.' },
};

export const WEDNESDAY_RULES = { showS: 2.5, minGapS: 6, maxPerRun: 2, afterToastS: 2, replaceAfterS: 1, eventTtlS: 1.5 } as const;

export interface AdviceInput {
  now: number; // real seconds
  suppressed: boolean; // rescue, cinematic, tutorial, hint visible
  lastToastAt: number; // real seconds, -Infinity if none
  /** Condition-based triggers currently true (event triggers go through `fire`). */
  active: WednesdayId[];
}

export class WednesdayAdvisor {
  private counts = new Map<WednesdayId, number>();
  private current: { id: WednesdayId; at: number } | null = null;
  private lastStart = -Infinity;
  private pending: { id: WednesdayId; at: number } | null = null;

  /** Event-style trigger (surge telegraph, first catch resolved). */
  fire(id: WednesdayId, now: number): void {
    if (!this.pending || WEDNESDAY_LINES[id].prio < WEDNESDAY_LINES[this.pending.id].prio) this.pending = { id, at: now };
  }

  /** Returns the line to show right now (or null). */
  update(i: AdviceInput): { id: WednesdayId; text: string } | null {
    if (this.pending && i.now - this.pending.at > WEDNESDAY_RULES.eventTtlS) this.pending = null;
    if (this.current && i.now - this.current.at >= WEDNESDAY_RULES.showS) this.current = null;
    if (i.suppressed) {
      this.current = null;
      return null;
    }
    const candidates: WednesdayId[] = [...i.active];
    if (this.pending) candidates.push(this.pending.id);
    const usable = candidates
      .filter((id) => (this.counts.get(id) ?? 0) < WEDNESDAY_RULES.maxPerRun)
      .sort((a, b) => WEDNESDAY_LINES[a].prio - WEDNESDAY_LINES[b].prio);
    const best = usable[0];
    if (best) {
      const canReplace = this.current !== null && WEDNESDAY_LINES[best].prio < WEDNESDAY_LINES[this.current.id].prio
        && i.now - this.current.at >= WEDNESDAY_RULES.replaceAfterS;
      const canStart = this.current === null && i.now - this.lastStart >= WEDNESDAY_RULES.minGapS
        && i.now - i.lastToastAt >= WEDNESDAY_RULES.afterToastS;
      if (canReplace || canStart) {
        this.current = { id: best, at: i.now };
        this.lastStart = i.now;
        this.counts.set(best, (this.counts.get(best) ?? 0) + 1);
        if (this.pending?.id === best) this.pending = null;
      }
    }
    return this.current ? { id: this.current.id, text: WEDNESDAY_LINES[this.current.id].text } : null;
  }
}
