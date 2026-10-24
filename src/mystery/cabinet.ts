// Hiding cabinets (docs/final/FINAL_CONTRACT.md §6). HidingSpotDef.kind === 'cabinet' (+ doorYaw) are ENTERED with E
// (they are not crouch spots). The state lives in PlayerState.cabinet = { spotId, phase, t } (t = seconds in the phase).
//
//   outside   E within cabinet.useM of the door (or the cabinet's centre), nothing of higher priority in reach (interact.ts:
//             deposit > clue > egg > lever > examine > cabinet > switch): ENTER — phase 'entering' for enterS, the player
//             stands in the cabinet (no movement), noise enterNoise (slamNoise when entering at a sprint),
//             `cabinet {enter, loud}`. → 'open'.
//   open      inside, door open: hidden like a crouch spot (seen only within the cabinet's revealM). E → the door closes
//             (closeS, noise closeNoise, `cabinet {close, loud}`) → 'closed'. WASD → steps out ('exiting').
//   closed    inside, door shut: invisible to sight and proximity for every enemy (scan / curse / grabs / lunges miss).
//             E → the door opens (noise openNoise, `cabinet {open, loud}`) → 'exiting'.
//   exiting   exitS, then the player stands at the exit point (door front = centre + forward(doorYaw) × exitM, else the
//             sides, else the back, else the nearest walkable cell — always a walkable cell on the player's nav grid),
//             `cabinet {exit}`.
// `loud` = the action's noise reached an enemy (it heard it and investigates the sound like any other noise).
// Witness: every enemy that could see the player at the moment they entered (in the open: sight / proximity) or closed
// the door (behind the open door: sight within the cabinet's revealM) remembers this cabinet: `enemy_detected {via:'witnessed_hide'}`, it walks to the exit
// point and pulls the player out on arrival → `cabinet {pulled_out}` + that enemy's hit (run.ts pullOut).
// No permanent invulnerability: after creakAfterS inside, the door creaks every creakEveryS (noise creakNoise at the
// cabinet); an enemy that hears a creak knows where it came from (`enemy_detected {via:'sound'}`) and comes to pull the
// player out the same way.
// While inside: no movement, no footsteps; E only drives the door; F / Q powers still work.
import type { CabinetTuning } from './config.ts';
import type { SimContext } from './context.ts';
import { forward } from './geometry.ts';
import type { EnemyId, HidingSpotDef, Vec2 } from './types.ts';

export type CabinetPhase = 'entering' | 'open' | 'closed' | 'exiting';

/** What the cabinet controller needs from the run. */
export interface CabinetHooks {
  /** Emits a noise at (x, z); returns the enemies that heard it. */
  cabinetNoise(x: number, z: number, loudness: number): EnemyId[];
  /** Enemies that could see the player right now (revealM null = in the open; else behind an open door with that revealM). */
  witnesses(revealM: number | null): EnemyId[];
  /** Sends `enemy` to the cabinet (false if it refuses, e.g. outside its leash). */
  remember(enemy: EnemyId, spotId: string, door: Vec2): boolean;
}

/** Public cabinet view (HUD / renderer). */
export interface CabinetStatus {
  spotId: string;
  phase: CabinetPhase;
  /** Seconds spent in the phase. */
  phaseT: number;
  /** Door openness 0 (shut) … 1 (open) — for the door animation. */
  door: number;
  /** The door is closing right now (UX "Closing…"). */
  closing: boolean;
  /** The first enemy that witnessed this hide (null = nobody saw it). */
  witnessedBy: EnemyId | null;
  /** Seconds until the next creak (null when not inside). */
  creakInS: number | null;
  /** Sim t of the last creak (null = none yet). */
  lastCreakAt: number | null;
  /** Where the player will step out. */
  exit: Vec2;
}

export function isCabinet(s: HidingSpotDef): boolean {
  return s.kind === 'cabinet';
}

/** The door point of a cabinet (the centre pushed out along doorYaw by its radius). */
export function cabinetDoor(s: HidingSpotDef): Vec2 {
  if (s.doorYaw === undefined) return { x: s.x, z: s.z };
  const f = forward(s.doorYaw);
  return { x: s.x + f.x * s.radius, z: s.z + f.z * s.radius };
}

/** The nearest cabinet the player can enter from here (within useM of its door or centre), or null. */
export function cabinetInReach(ctx: Pick<SimContext, 'map' | 'player' | 'tuning'>): HidingSpotDef | null {
  const p = ctx.player;
  if (p.cabinet) return null;
  const R = ctx.tuning.cabinet.useM;
  let best: HidingSpotDef | null = null;
  let bestD = Infinity;
  for (const s of ctx.map.hidingSpots) {
    if (!isCabinet(s)) continue;
    const door = cabinetDoor(s);
    const d = Math.min(Math.hypot(door.x - p.x, door.z - p.z), Math.hypot(s.x - p.x, s.z - p.z));
    if (d <= R && d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/**
 * Where the player steps out: door front (centre + forward(doorYaw) × exitM), else left / right side, else the back —
 * the first that is a walkable cell of the player's nav grid (snapped within 0.6 m) — else the nearest walkable cell
 * within 4 m of the cabinet, else the centre.
 */
export function cabinetExitPoint(ctx: Pick<SimContext, 'playerNav' | 'tuning'>, s: HidingSpotDef): Vec2 {
  const nav = ctx.playerNav();
  const base = s.doorYaw ?? 0;
  const dist = Math.max(ctx.tuning.cabinet.exitM, s.radius + ctx.tuning.player.radius + 0.1);
  for (const off of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const f = forward(base + off);
    const q = { x: s.x + f.x * dist, z: s.z + f.z * dist };
    if (nav.walkable(q.x, q.z)) return q;
    const snapped = nav.nearestWalkable(q, 0.6);
    if (snapped) return snapped;
  }
  return nav.nearestWalkable({ x: s.x, z: s.z }, 4) ?? { x: s.x, z: s.z };
}

export class CabinetController {
  witnessedBy: EnemyId | null = null;
  /** Total cabinet uses this run (telemetry). */
  uses = 0;
  private spot: HidingSpotDef | null = null;
  private exit: Vec2 = { x: 0, z: 0 };
  private closingLeft: number | null = null;
  private nextCreakAt = Infinity;
  private lastCreakAt: number | null = null;

  constructor(private readonly cfg: CabinetTuning) {}

  get inside(): boolean {
    return this.spot !== null;
  }

  status(ctx: SimContext): CabinetStatus | null {
    const cab = ctx.player.cabinet;
    const s = this.spot;
    if (!cab || !s) return null;
    const C = this.cfg;
    let door = 1;
    if (cab.phase === 'entering') door = 1;
    else if (cab.phase === 'closed') door = 0;
    else if (cab.phase === 'exiting') door = Math.min(1, cab.t / Math.max(0.05, C.exitS * 0.5));
    else if (this.closingLeft !== null) door = Math.max(0, this.closingLeft / Math.max(0.05, C.closeS));
    const inside = cab.phase === 'open' || cab.phase === 'closed';
    return {
      spotId: s.id, phase: cab.phase, phaseT: r3(cab.t), door: r3(door), closing: this.closingLeft !== null, witnessedBy: this.witnessedBy,
      creakInS: inside ? r1(Math.max(0, this.nextCreakAt - ctx.t)) : null, lastCreakAt: this.lastCreakAt, exit: { ...this.exit },
    };
  }

  /** E on a cabinet in reach: step in. */
  enter(ctx: SimContext, s: HidingSpotDef, hooks: CabinetHooks): void {
    const p = ctx.player;
    if (p.cabinet) return;
    const C = this.cfg;
    const slam = p.stance === 'sprint';
    // witnesses are judged BEFORE the player vanishes inside
    const saw = hooks.witnesses(null);
    this.spot = s;
    this.exit = cabinetExitPoint(ctx, s);
    this.closingLeft = null;
    this.witnessedBy = null;
    this.uses++;
    p.cabinet = { spotId: s.id, phase: 'entering', t: 0 };
    p.x = s.x;
    p.z = s.z;
    if (s.doorYaw !== undefined) p.yaw = s.doorYaw;
    p.speed = 0;
    p.crouched = false;
    p.hidden = true; // stepping in: hidden like an open door (enemies already watching were recorded as witnesses)
    p.interacting = null;
    if (ctx.egg.state === 'carried') {
      ctx.egg.x = p.x;
      ctx.egg.z = p.z;
    }
    const heard = hooks.cabinetNoise(s.x, s.z, slam ? C.slamNoise : C.enterNoise);
    ctx.emit({ type: 'cabinet', spotId: s.id, action: 'enter', loud: heard.length > 0 });
    this.markWitnesses(ctx, saw, hooks);
  }

  /** E while inside. */
  press(ctx: SimContext, hooks: CabinetHooks): void {
    const cab = ctx.player.cabinet;
    const s = this.spot;
    if (!cab || !s) return;
    const C = this.cfg;
    if (cab.phase === 'open' && this.closingLeft === null) {
      const saw = hooks.witnesses(s.revealM);
      this.closingLeft = C.closeS;
      const heard = hooks.cabinetNoise(s.x, s.z, C.closeNoise);
      ctx.emit({ type: 'cabinet', spotId: s.id, action: 'close', loud: heard.length > 0 });
      this.markWitnesses(ctx, saw, hooks);
    } else if (cab.phase === 'closed') {
      this.setPhase(ctx, 'exiting');
      const heard = hooks.cabinetNoise(s.x, s.z, C.openNoise);
      ctx.emit({ type: 'cabinet', spotId: s.id, action: 'open', loud: heard.length > 0 });
    }
  }

  /** One fixed step while inside (replaces stepPlayer): timers, WASD exit from an open door, creaks. */
  step(ctx: SimContext, dt: number, move: { moveX: number; moveZ: number }, hooks: CabinetHooks): void {
    const p = ctx.player;
    const cab = p.cabinet;
    const s = this.spot;
    if (!cab || !s) return;
    const C = this.cfg;
    cab.t += dt;
    p.speed = 0;
    p.crouched = false;
    if (p.stance !== 'idle') {
      p.stance = 'idle';
      ctx.emit({ type: 'stance', stance: 'idle' });
    }
    switch (cab.phase) {
      case 'entering':
        if (cab.t >= C.enterS - 1e-9) {
          this.setPhase(ctx, 'open');
          this.nextCreakAt = ctx.t + C.creakAfterS;
        }
        break;
      case 'open':
        if (this.closingLeft !== null) {
          this.closingLeft -= dt;
          if (this.closingLeft <= 1e-9) {
            this.closingLeft = null;
            this.setPhase(ctx, 'closed');
          }
        } else if (Math.hypot(move.moveX, move.moveZ) > 0.5) this.setPhase(ctx, 'exiting');
        break;
      case 'closed':
        break;
      case 'exiting':
        if (cab.t >= C.exitS - 1e-9) {
          this.stepOut(ctx);
          ctx.emit({ type: 'cabinet', spotId: s.id, action: 'exit', loud: false });
          return;
        }
        break;
    }
    p.hidden = p.cabinet !== null && p.cabinet?.phase !== 'exiting';
    // creaks: no permanent invulnerability
    if (p.hidden && ctx.t >= this.nextCreakAt - 1e-9) {
      this.nextCreakAt = ctx.t + Math.max(0.5, C.creakEveryS);
      this.lastCreakAt = Math.round(ctx.t * 1000) / 1000;
      const heard = hooks.cabinetNoise(s.x, s.z, C.creakNoise);
      for (const e of heard) {
        if (hooks.remember(e, s.id, this.exit)) ctx.emit({ type: 'enemy_detected', enemy: e, via: 'sound' });
      }
    }
  }

  /** Puts the player out at the exit point NOW (pulled out, grabbed, knocked back …). Emits nothing. */
  forceOut(ctx: SimContext): void {
    if (!ctx.player.cabinet) return;
    this.stepOut(ctx);
  }

  /** The tutorial ended / the run reset: forget everything. */
  reset(ctx: SimContext): void {
    if (ctx.player.cabinet) this.stepOut(ctx);
    this.witnessedBy = null;
  }

  private stepOut(ctx: SimContext): void {
    const p = ctx.player;
    p.x = this.exit.x;
    p.z = this.exit.z;
    p.cabinet = null;
    p.hidden = false;
    p.speed = 0;
    if (ctx.egg.state === 'carried') {
      ctx.egg.x = p.x;
      ctx.egg.z = p.z;
    }
    this.spot = null;
    this.closingLeft = null;
    this.nextCreakAt = Infinity;
  }

  private setPhase(ctx: SimContext, phase: CabinetPhase): void {
    const cab = ctx.player.cabinet;
    if (!cab) return;
    cab.phase = phase;
    cab.t = 0;
    ctx.player.hidden = phase !== 'exiting';
  }

  private markWitnesses(ctx: SimContext, saw: EnemyId[], hooks: CabinetHooks): void {
    const s = this.spot;
    if (!s) return;
    for (const e of saw) {
      if (!hooks.remember(e, s.id, this.exit)) continue;
      this.witnessedBy ??= e;
      ctx.emit({ type: 'enemy_detected', enemy: e, via: 'witnessed_hide' });
    }
  }
}

function r1(x: number): number {
  return Math.round(x * 10) / 10;
}

function r3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
