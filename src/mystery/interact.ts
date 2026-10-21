// E interaction. Taps start timed actions that complete on their own unless the player moves away (no holding):
//   - clue search: CluePlacement.searchS × interactTimeMult; walking away pauses it and the progress is kept
//     (clues.keepProgressOnCancel); a search noise (noise.clueSearch) at the start and every searchNoiseIntervalS;
//   - egg pickup: egg.pickupS × interactTimeMult (pickup noise on completion);
//   - deposit at Iago Tower while carrying: egg.depositS (not scaled) → delivered → the run enters `accusing`;
//   - tutorial practice crate (island PRACTICE_CRATE): player.practiceSearchS, no evidence, a real search noise ring.
// Setting the carried egg down needs a HOLD of E for player.eggDropHoldS while nothing else is interactable (a tap never drops
// it). The hold needs `interactHeld` on the input (an extension of MysteryInput — see run.ts).
import type { SimContext } from './context.ts';
import { deliverEgg, dropEgg, inTower, pickUpEgg } from './egg.ts';
import type { ClueId, MapDef, Vec2 } from './types.ts';

export const PRACTICE_ID = 'practice_crate';

export type InteractKind = 'clue' | 'egg' | 'tower' | 'switch' | 'practice';
export interface InteractTarget { kind: InteractKind; id: string; label: string; x: number; z: number; action: 'search' | 'pickup' | 'deposit' | 'drop' | 'none' }

interface Active { kind: 'clue' | 'egg' | 'deposit' | 'practice'; id: string; progress: number; nextNoiseT: number }

/** Fallback practice-crate spot for maps without one: 3 m ahead of the player start. */
export function defaultPracticePoint(map: MapDef): Vec2 {
  const s = map.playerStart;
  return { x: s.x - Math.sin(s.yaw) * 3, z: s.z - Math.cos(s.yaw) * 3 };
}

export class Interaction {
  active: Active | null = null;
  readonly clueProgress = new Map<ClueId, number>();
  dropHeld = 0;
  practiceDone = false;
  dropHoldS = 0.8;

  constructor(
    private readonly clueLabel: (id: ClueId) => string,
    private readonly practice: Vec2,
  ) {}

  /** What E acts on right now (HUD prompt). */
  target(ctx: SimContext, tutorial: boolean): InteractTarget | null {
    const p = ctx.player;
    const R = ctx.tuning.player.interactRangeM;
    if (tutorial) {
      const c = this.practice;
      if (!this.practiceDone && Math.hypot(c.x - p.x, c.z - p.z) <= R) {
        return { kind: 'practice', id: PRACTICE_ID, label: 'Search the crate', x: c.x, z: c.z, action: 'search' };
      }
      return null;
    }
    const egg = ctx.egg;
    if (egg.state === 'carried' && inTower(ctx.map, p)) {
      return { kind: 'tower', id: 'tower', label: 'Deposit the egg at Iago Tower', x: ctx.map.tower.x, z: ctx.map.tower.z, action: 'deposit' };
    }
    let best: InteractTarget | null = null;
    let bestD = Infinity;
    for (const c of ctx.map.clues) {
      if (ctx.cluesFound.includes(c.clueId)) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d <= R && d < bestD) {
        bestD = d;
        best = { kind: 'clue', id: c.clueId, label: this.clueLabel(c.clueId), x: c.x, z: c.z, action: 'search' };
      }
    }
    if (best) return best;
    if ((egg.state === 'resting' || egg.state === 'dropped') && Math.hypot(egg.x - p.x, egg.z - p.z) <= R) {
      return { kind: 'egg', id: 'egg', label: 'Pick up the egg', x: egg.x, z: egg.z, action: 'pickup' };
    }
    const sw = ctx.map.powerSwitch;
    if (sw && Math.hypot(sw.x - p.x, sw.z - p.z) <= R) {
      const powered = ctx.t < ctx.fx.switchPoweredUntil;
      return { kind: 'switch', id: sw.id, label: powered ? 'Gate switch (powered)' : 'Gate switch: needs an electric charge', x: sw.x, z: sw.z, action: 'none' };
    }
    if (egg.state === 'carried') return { kind: 'egg', id: 'egg', label: 'Hold E to set the egg down', x: p.x, z: p.z, action: 'drop' };
    return null;
  }

  /** Progress 0..1 of whatever the HUD prompt refers to. */
  progressFor(target: InteractTarget): number {
    if (target.action === 'drop') return Math.min(1, this.dropHeld / this.dropHoldS);
    const a = this.active;
    if (a && (a.id === target.id || (a.kind === 'deposit' && target.kind === 'tower'))) return a.progress;
    if (target.kind === 'clue') return this.clueProgress.get(target.id as ClueId) ?? 0;
    return 0;
  }

  /** E tap. Starts a timed action (never drops the egg). */
  press(ctx: SimContext, tutorial: boolean): void {
    if (this.active) return;
    const tg = this.target(ctx, tutorial);
    if (!tg) return;
    const T = ctx.tuning;
    switch (tg.action) {
      case 'search':
        if (tg.kind === 'practice') {
          this.active = { kind: 'practice', id: PRACTICE_ID, progress: 0, nextNoiseT: ctx.t + T.noise.searchNoiseIntervalS };
        } else {
          const id = tg.id as ClueId;
          const progress = T.clues.keepProgressOnCancel ? (this.clueProgress.get(id) ?? 0) : 0;
          this.active = { kind: 'clue', id, progress, nextNoiseT: ctx.t + T.noise.searchNoiseIntervalS };
          ctx.player.interacting = { target: 'clue', id, progress };
          ctx.emit({ type: 'clue_search_start', clueId: id });
        }
        ctx.noise('interact', ctx.player.x, ctx.player.z, T.noise.clueSearch);
        return;
      case 'pickup':
        this.active = { kind: 'egg', id: 'egg', progress: 0, nextNoiseT: Infinity };
        ctx.player.interacting = { target: 'egg', id: 'egg', progress: 0 };
        return;
      case 'deposit':
        this.active = { kind: 'deposit', id: 'tower', progress: 0, nextNoiseT: Infinity };
        return;
      default:
        return;
    }
  }

  cancel(ctx: SimContext): void {
    this.active = null;
    this.dropHeld = 0;
    ctx.player.interacting = null;
  }

  /**
   * Advances timed actions and the drop hold. Returns 'deposit' on the step the egg is delivered.
   * `held` = E currently held down (for the egg set-down).
   */
  step(ctx: SimContext, dt: number, held: boolean, tutorial: boolean): 'deposit' | null {
    const p = ctx.player;
    const T = ctx.tuning;
    // hold-E set-down: only while carrying, nothing else is interactable and no timed action runs
    const tg = this.target(ctx, tutorial);
    this.dropHoldS = T.player.eggDropHoldS;
    if (held && !this.active && tg?.action === 'drop') {
      this.dropHeld += dt;
      if (this.dropHeld >= T.player.eggDropHoldS) {
        this.dropHeld = 0;
        dropEgg(ctx, 'manual');
      }
    } else this.dropHeld = 0;

    const a = this.active;
    if (!a) return null;
    let tx: number;
    let tz: number;
    let duration: number;
    switch (a.kind) {
      case 'clue': {
        const c = ctx.map.clues.find((cl) => cl.clueId === a.id);
        if (!c || ctx.cluesFound.includes(c.clueId)) return this.stop(ctx);
        tx = c.x;
        tz = c.z;
        duration = (c.searchS > 0 ? c.searchS : T.clues.searchS) * ctx.mods.interactTimeMult;
        break;
      }
      case 'egg':
        if (ctx.egg.state !== 'resting' && ctx.egg.state !== 'dropped') return this.stop(ctx);
        tx = ctx.egg.x;
        tz = ctx.egg.z;
        duration = T.egg.pickupS * ctx.mods.interactTimeMult;
        break;
      case 'deposit':
        if (ctx.egg.state !== 'carried') return this.stop(ctx);
        if (!inTower(ctx.map, p)) return this.stop(ctx);
        tx = p.x;
        tz = p.z;
        duration = T.egg.depositS;
        break;
      case 'practice': {
        tx = this.practice.x;
        tz = this.practice.z;
        duration = T.player.practiceSearchS;
        break;
      }
    }
    if (Math.hypot(tx - p.x, tz - p.z) > T.player.interactBreakM) return this.stop(ctx);
    a.progress = Math.min(1, a.progress + dt / Math.max(0.05, duration));
    if (a.kind === 'clue') {
      this.clueProgress.set(a.id as ClueId, a.progress);
      if (p.interacting) p.interacting.progress = a.progress;
    } else if (a.kind === 'egg' && p.interacting) p.interacting.progress = a.progress;
    if (a.progress < 1 && ctx.t >= a.nextNoiseT) {
      a.nextNoiseT += T.noise.searchNoiseIntervalS;
      ctx.noise('interact', p.x, p.z, T.noise.clueSearch);
    }
    if (a.progress < 1) return null;
    this.active = null;
    p.interacting = null;
    switch (a.kind) {
      case 'clue':
        ctx.cluesFound.push(a.id as ClueId);
        this.clueProgress.delete(a.id as ClueId);
        ctx.emit({ type: 'clue_found', clueId: a.id as ClueId, cluesFound: ctx.cluesFound.length });
        return null;
      case 'egg':
        pickUpEgg(ctx);
        return null;
      case 'deposit':
        return deliverEgg(ctx) ? 'deposit' : null;
      case 'practice':
        this.practiceDone = true;
        return null;
    }
  }

  private stop(ctx: SimContext): null {
    this.active = null;
    ctx.player.interacting = null;
    return null;
  }
}
