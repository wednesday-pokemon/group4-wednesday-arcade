// ONE message stack for Thing (UX_OVERHAUL §6): at most 1 card (WHY or ADVICE) + 1 THING'S LOG line visible.
// The analytics layer already rate-limits what it emits (codes, per-minute caps, advice gaps); this class enforces the
// VISIBLE-SLOT rules only:
//   * LOG: own slot, 3.5 s, ≥ 2.5 s between lines; a newer log waiting for the slot replaces the waiting one (latest wins).
//   * Cards: WHY 4.5 s, ADVICE 6 s. A shown card holds ≥ 1.2 s before a HIGHER priority may pre-empt it (equal waits);
//     1.5 s gap before the next automatic card (P5 exempt). Queue length 2 (highest priority first, then oldest);
//     a WHY older than 4 s when its turn comes is dropped.
//   * Nothing automatic while `blocked` (tutorial, first 2 s of a ClueCard, catch toast, deposit moment, overlays);
//     items the visitor asked for (V) are not automatic.
// Priority: P5 HYDE ALERT (chase start / catch) · P4 ADVICE during a threat or V-requested · P3 WHY egg damage /
// escape · P2 routine ADVICE · P1 INVESTIGATION / PATTERN · P0 LOG.

export type StackKind = 'log' | 'why' | 'advice';

export interface StackItem {
  id: string;
  kind: StackKind;
  /** Tag / headword: "THING'S LOG", "HYDE ALERT", "POWER STATUS", "EGG STATUS", "INVESTIGATION", "PATTERN", "THING'S ADVICE". */
  head: string;
  text: string;
  why?: string | null;
  /** Diagnostic basis: rule-verified (solid border) vs pattern (dashed + "≈"). */
  basis?: 'rule' | 'pattern';
  priority: number;
  /** Real seconds when the item was produced. */
  t: number;
  /** false = the visitor asked for it (V): shown even while automatic cards are blocked, no gap. */
  auto?: boolean;
  target?: { x: number; z: number; label: string } | null;
}

export interface ShownItem { item: StackItem; shownAt: number; until: number }

export const LOG_S = 3.5;
export const LOG_GAP_S = 2.5;
export const WHY_S = 4.5;
export const ADVICE_S = 6;
export const MIN_HOLD_S = 1.2;
export const CARD_GAP_S = 1.5;
export const QUEUE_MAX = 2;
export const WHY_MAX_WAIT_S = 4;
/** Automatic advice goes stale too (its situation changes); not in the spec's table, a conservative 10 s. */
export const ADVICE_MAX_WAIT_S = 10;
export const SAME_TEXT_S = 30;

export class ThingStack {
  log: ShownItem | null = null;
  card: ShownItem | null = null;
  private pendingLog: StackItem | null = null;
  private queue: StackItem[] = [];
  private lastLogAt = -Infinity;
  private lastCardEndAt = -Infinity;
  private recent = new Map<string, number>();
  /** Every item ever shown (newest last, capped) — render_game_to_text + the in-world Thing pose. */
  readonly history: { kind: StackKind; head: string; text: string; t: number }[] = [];

  push(item: StackItem, now: number): void {
    // Duplicate guards: the same text shown within 30 s is noise (the analytics already de-duplicates codes) — unless the
    // visitor asked for it again (V); the same text already on screen or already waiting is never queued twice.
    const key = `${item.kind}|${item.text}`;
    const seen = this.recent.get(key);
    if (seen !== undefined && now - seen < SAME_TEXT_S && item.priority < 5 && item.auto !== false) return;
    if (item.kind === 'log') {
      this.pendingLog = item; // latest wins
      return;
    }
    if (this.card && now < this.card.until && this.card.item.kind === item.kind && this.card.item.text === item.text) return;
    const dup = this.queue.findIndex((q) => q.kind === item.kind && q.text === item.text);
    if (dup >= 0) {
      if (this.queue[dup]!.priority >= item.priority) return;
      this.queue.splice(dup, 1); // keep the higher-priority copy only
    }
    this.queue.push(item);
    this.queue.sort((a, b) => b.priority - a.priority || a.t - b.t);
    if (this.queue.length > QUEUE_MAX) this.queue.length = QUEUE_MAX;
  }

  /** Advance the slots; returns what is visible. */
  update(now: number, blocked = false): { log: ShownItem | null; card: ShownItem | null } {
    if (this.log && now >= this.log.until) this.log = null;
    if (this.card && now >= this.card.until) {
      this.card = null;
      this.lastCardEndAt = now;
    }
    // ---- log slot
    if (this.pendingLog && now - this.lastLogAt >= LOG_GAP_S && (!blocked || this.pendingLog.auto === false)) {
      this.show('log', this.pendingLog, now);
      this.pendingLog = null;
    }
    // ---- card slot
    this.queue = this.queue.filter((q) => !(q.kind === 'why' && now - q.t > WHY_MAX_WAIT_S) && !(q.kind === 'advice' && q.auto !== false && now - q.t > ADVICE_MAX_WAIT_S));
    const next = this.queue.find((q) => !blocked || q.auto === false);
    if (next) {
      const urgent = next.priority >= 5 || next.auto === false;
      if (this.card) {
        const held = now - this.card.shownAt;
        if (next.priority > this.card.item.priority && held >= MIN_HOLD_S) this.take(next, now);
      } else if (urgent || now - this.lastCardEndAt >= CARD_GAP_S) {
        this.take(next, now);
      }
    }
    return { log: this.log, card: this.card };
  }

  /** Drop everything queued (new run phase, results). */
  clear(): void {
    this.queue = [];
    this.pendingLog = null;
    this.card = null;
    this.log = null;
  }

  get queued(): readonly StackItem[] {
    return this.queue;
  }

  private take(item: StackItem, now: number): void {
    this.queue = this.queue.filter((q) => q !== item);
    if (this.card) this.lastCardEndAt = now;
    this.show('card', item, now);
  }

  private show(slot: 'log' | 'card', item: StackItem, now: number): void {
    const dur = item.kind === 'log' ? LOG_S : item.kind === 'why' ? WHY_S : ADVICE_S;
    const shown = { item, shownAt: now, until: now + dur };
    if (slot === 'log') {
      this.log = shown;
      this.lastLogAt = now;
    } else this.card = shown;
    this.recent.set(`${item.kind}|${item.text}`, now);
    this.history.push({ kind: item.kind, head: item.head, text: item.text, t: Math.round(now * 10) / 10 });
    if (this.history.length > 40) this.history.shift();
  }
}

/** Map an analytics LiveMessage kind to the stack kind. */
export function stackKindOf(kind: 'log' | 'diagnostic' | 'advice'): StackKind {
  return kind === 'diagnostic' ? 'why' : kind;
}
