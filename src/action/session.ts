// One real-time rowing session: fixed-step simulation of input → rowing → currents → collisions → stats.
// Time only advances through update(), so pausing (not calling update) never counts as active play time.
import type { CharacterId, PokemonId } from '../game/types.ts';
import { statMultipliers, statsFor } from './characterStats.ts';
import { clampToBounds, createCollisionMemory, findContacts, resolveCollisions } from './collision.ts';
import { BOAT, FIXED_STEP_S, MAX_FRAME_S, ROWING } from './config.ts';
import { courseProgress } from './course.ts';
import { applyStroke, createBoatState, integrateBoat, type RowingModifiers } from './rowing.ts';
import type { ActionEvent, BoatState, CourseDef, InputSnapshot, RowingConfig } from './types.ts';

export interface SessionStats {
  activeTimeS: number;
  distance: number;
  maxSpeed: number;
  strokes: number;
  missedStrokes: number;
  collisions: number;
  hpLost: number;
  staminaUsed: number;
}

export interface SessionOptions {
  characterId: CharacterId | null;
  pokemonId: PokemonId | null;
  course: CourseDef;
  rowing?: RowingConfig;
}

const IDLE_INPUT: InputSnapshot = { forward: false, left: false, right: false, brake: false, interact: false, ability: false, strokes: 0, holdRow: false };

export class RowingSession {
  readonly course: CourseDef;
  readonly cfg: RowingConfig;
  readonly mods: RowingModifiers;
  readonly boat: BoatState;
  t = 0;
  finished = false;
  readonly stats: SessionStats = { activeTimeS: 0, distance: 0, maxSpeed: 0, strokes: 0, missedStrokes: 0, collisions: 0, hpLost: 0, staminaUsed: 0 };
  private readonly collisionMemory = createCollisionMemory();
  private accumulator = 0;
  private holdNextAt = 0;
  private lowStaminaWarned = false;
  private held: InputSnapshot = IDLE_INPUT;

  constructor(readonly options: SessionOptions) {
    this.course = options.course;
    this.cfg = options.rowing ?? ROWING;
    this.mods = { ...statMultipliers(statsFor(options.characterId)), speedBoost: 1, staminaCost: 1 };
    const { x, z, heading } = this.course.start;
    this.boat = createBoatState(x, z, heading, BOAT.maxHp, this.mods.maxStamina);
  }

  get progress(): number {
    return courseProgress(this.course, this.boat.z);
  }

  /** Advance by one rendered frame. Strokes are applied once at the frame's start; physics runs at 120 Hz. */
  update(frameDt: number, input: InputSnapshot): ActionEvent[] {
    if (this.finished) return [];
    const events: ActionEvent[] = [];
    this.held = input;
    for (let i = 0; i < input.strokes; i++) this.stroke(events);
    this.accumulator += Math.min(MAX_FRAME_S, Math.max(0, frameDt));
    while (this.accumulator >= FIXED_STEP_S && !this.finished) {
      this.step(FIXED_STEP_S, events);
      this.accumulator -= FIXED_STEP_S;
    }
    return events;
  }

  private stroke(events: ActionEvent[]): void {
    const before = this.boat.stamina;
    const result = applyStroke(this.boat, this.mods, this.cfg, this.t);
    if (!result.accepted) {
      this.stats.missedStrokes++;
      events.push({ type: 'missed_stroke', t: this.t });
      return;
    }
    this.stats.strokes++;
    this.stats.staminaUsed += before - this.boat.stamina;
    events.push({ type: 'stroke', side: this.stats.strokes % 2 ? 'left' : 'right', power: result.power, t: this.t });
  }

  private currentPush(): { x: number; z: number } {
    const push = { x: 0, z: 0 };
    for (const c of this.course.currents) {
      const d = Math.hypot(this.boat.x - c.x, this.boat.z - c.z);
      if (d >= c.radius) continue;
      const falloff = 1 - d / c.radius;
      push.x += c.pushX * falloff;
      push.z += c.pushZ * falloff;
    }
    return push;
  }

  private step(dt: number, events: ActionEvent[]): void {
    if (this.held.holdRow && this.t >= this.holdNextAt) {
      this.stroke(events);
      this.holdNextAt = this.t + 1 / this.cfg.holdCadenceHz;
    }
    const before = { x: this.boat.x, z: this.boat.z, stamina: this.boat.stamina };
    integrateBoat(this.boat, this.held, this.mods, this.cfg, dt, this.t, this.currentPush());
    clampToBounds(this.boat, this.course.bounds, dt);
    const hpBefore = this.boat.hp;
    const hits = resolveCollisions(this.boat, findContacts(this.boat, this.course.obstacles, this.t), this.collisionMemory, this.mods.damageTaken, this.t, dt);
    for (const h of hits) {
      this.stats.collisions++;
      events.push({ type: 'collision', obstacleId: h.obstacle.id, kind: h.obstacle.kind, damage: h.damage, impactSpeed: h.impactSpeed, x: this.boat.x, z: this.boat.z, t: this.t });
    }
    this.stats.hpLost += hpBefore - this.boat.hp;
    this.stats.staminaUsed += Math.max(0, before.stamina - this.boat.stamina);
    this.stats.distance += Math.hypot(this.boat.x - before.x, this.boat.z - before.z);
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, this.boat.speed);
    this.t += dt;
    this.stats.activeTimeS = this.t;
    this.warnLowStamina(events);
    this.checkFinish(events);
  }

  private warnLowStamina(events: ActionEvent[]): void {
    const low = this.boat.stamina / this.boat.maxStamina < this.cfg.lowStaminaThreshold;
    if (low && !this.lowStaminaWarned) events.push({ type: 'low_stamina', t: this.t });
    this.lowStaminaWarned = low;
  }

  private checkFinish(events: ActionEvent[]): void {
    const f = this.course.finish;
    if (Math.hypot(this.boat.x - f.x, this.boat.z - f.z) > f.radius) return;
    this.finished = true;
    events.push({ type: 'finish', t: this.t });
  }

  /** Fog density at the boat (0 = clear), used by the renderer and advice. */
  fogAt(): number {
    let density = 0;
    for (const f of this.course.fog) {
      const d = Math.hypot(this.boat.x - f.x, this.boat.z - f.z);
      if (d < f.radius) density = Math.max(density, f.density * (1 - d / f.radius));
    }
    return density;
  }
}
