// Stage 1 run (v3 corrections): real-time rowing on an open lake with land, a real Hyde pursuer following the
// boat's wake, encounter-driven pacing, data-driven Pokémon abilities, character stats + traits, and the
// interactive rescue window. Fixed 120 Hz step; time only advances through update(), so pausing (not calling
// update) never counts. During the rescue window the sim runs at STAGE_TUNING.rescue.timeScale of real time.
// Contract: docs/V3_STAGE1_CONTRACT.md "Run API". Deterministic: no Math.random, no wall clock.
import type { CharacterId, PokemonId } from '../game/types.ts';
import { PokemonAbilitySystem } from './abilities.ts';
import { characterDefFor, statMultipliers, statsFor } from './characterStats.ts';
import { clampToBounds, createCollisionMemory, findContacts, obstaclePosition, resolveCollisions, type ImpactHook, type ImpactInfo, type ImpactPolicy } from './collision.ts';
import { BOAT, FIXED_STEP_S, HYDE, MAX_FRAME_S, ROWING, RUN } from './config.ts';
import { defaultCourse } from './courseResolver.ts';
import { POKEMON_ABILITY_DEFS } from './data/pokemon.ts';
import { STAGE_TUNING } from './data/stages.ts';
import { EncounterDirector, progressAt } from './encounters.ts';
import { HydeAI, WakeTrail, type HydeModifiers } from './hyde.ts';
import { createLandMemory, resolveLand } from './land.ts';
import { resolveRescue } from './rescue.ts';
import { applyStroke, createBoatState, forwardVector, integrateBoat, topSpeed, type RowingModifiers } from './rowing.ts';
import type { SessionStats } from './session.ts';
import { SHOVABLE_KINDS, traitEffects, type TraitEffects } from './traits.ts';
import type {
  AbilityRuntime, ActionEvent, BoatState, CharacterActionDef, CourseDef, EncounterTrigger, HydeState, InputSnapshot,
  Obstacle, PokemonAbilityDef, RescueState, RowingConfig, RunStatus, Vec2,
} from './types.ts';

export interface RunStats extends SessionStats {
  hydeCloseCalls: number; // gap fell below HYDE.closeCallU and recovered past closeCallRecoverU without a catch
  abilitiesUsed: number; // successful Q activations + rescues
  rescues: number; // rescue windows resolved with Q (rescued or clean escape)
  cleanEscapes: number;
  timeInDangerS: number; // sim seconds with the hunting Hyde closer than HYDE.dangerGapU
}

export interface StageOneRunOptions {
  characterId: CharacterId;
  pokemonId: PokemonId;
  course?: CourseDef; // default: buildLakeCourse() (falls back to the crossing until lake.ts exists)
}

export type RunEffects = ReturnType<PokemonAbilitySystem['effects']>;

const NO_STEER = { forward: false, left: false, right: false, brake: false };
const IDLE_INPUT: InputSnapshot = { ...NO_STEER, interact: false, ability: false, strokes: 0, holdRow: false };

export function abilityDefFor(id: PokemonId): PokemonAbilityDef {
  const def = POKEMON_ABILITY_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`unknown pokemon ${id}`);
  return def;
}

export class StageOneRun {
  readonly course: CourseDef;
  readonly boat: BoatState;
  readonly hyde: HydeState;
  readonly rescue: RescueState;
  readonly ability: AbilityRuntime;
  readonly abilityDef: PokemonAbilityDef;
  readonly characterDef: CharacterActionDef;
  status: RunStatus = 'playing';
  catches: 0 | 1 | 2 = 0;
  t = 0;
  readonly stats: RunStats = {
    activeTimeS: 0, distance: 0, maxSpeed: 0, strokes: 0, missedStrokes: 0, collisions: 0, hpLost: 0, staminaUsed: 0,
    hydeCloseCalls: 0, abilitiesUsed: 0, rescues: 0, cleanEscapes: 0, timeInDangerS: 0,
  };

  // ---- extras beyond the contract (read-only for the renderer / HUD / tests)
  readonly hydeAI: HydeAI;
  readonly abilities: PokemonAbilitySystem;
  readonly traits: TraitEffects;
  readonly director: EncounterDirector;
  readonly cfg: RowingConfig;
  readonly mods: RowingModifiers;
  /** Obstacles cut by an ability (no longer collide; hide them). */
  readonly removedObstacles = new Set<string>();
  /** Obstacles shoved aside by a trait: their x/z in `course.obstacles` changed (re-read obstaclePosition). */
  readonly displacedObstacles = new Set<string>();
  /** Increments whenever an obstacle is removed or displaced. */
  obstacleRevision = 0;
  bestProgress = 0;
  safeHarbour = false;
  /**
   * How the last rescue window resolved (HUD: rescue text + egg-protected badge). In Stage 1 no egg is aboard yet,
   * so `protectEgg` is informational here; Stage 3 applies it to egg security.
   */
  lastRescue: {
    outcome: Exclude<RescueState['outcome'], 'pending'>; counted: boolean; damage: number; knockbackU: number;
    negateDamage: boolean; protectEgg: boolean; text: string; t: number;
  } | null = null;

  private readonly trail: WakeTrail;
  private readonly collisionMemory = createCollisionMemory();
  private readonly landMemory = createLandMemory();
  private activeObstacles: Obstacle[];
  private accumulator = 0;
  private holdNextAt = 0;
  private lowStaminaWarned = false;
  private input: InputSnapshot = IDLE_INPUT;
  private cinematicLeft = 0;
  private cinematicShown = false;
  private rescueRealT = 0;
  private struggle = 0;
  private catchInvulnUntil = 0;
  private swampedUntil = -Infinity;
  private negationsLeft: number;
  private lastShoveAt = -Infinity;
  private closeCallArmed = false;
  private disturbance: { at: number; density: number; durationS: number } | null = null;
  private readonly maxFogDensity: number;
  private readonly pendingCuts = new Set<string>();

  constructor(o: StageOneRunOptions) {
    this.course = structuredClone(o.course ?? defaultCourse());
    this.characterDef = characterDefFor(o.characterId);
    this.abilityDef = abilityDefFor(o.pokemonId);
    this.traits = traitEffects(o.characterId);
    this.abilities = new PokemonAbilitySystem(this.abilityDef);
    this.ability = this.abilities.runtime;
    this.cfg = this.traits.regenDelayS !== null ? { ...ROWING, regenDelayS: this.traits.regenDelayS } : ROWING;
    this.mods = {
      ...statMultipliers(statsFor(o.characterId)),
      speedBoost: 1, staminaCost: 1, topSpeedBonus: 0,
      coastDragMult: this.traits.coastDragMult, coastAfterS: this.traits.coastAfterS,
    };
    const { x, z, heading } = this.course.start;
    this.boat = createBoatState(x, z, heading, STAGE_TUNING.hull.maxHp, this.mods.maxStamina);
    this.trail = new WakeTrail(x, z, heading);
    this.hydeAI = new HydeAI(this.trail, { tuning: STAGE_TUNING.hyde.stage1, telegraphBonusS: this.traits.surgeTelegraphBonusS, spawn: this.course.hydeSpawn });
    this.hyde = this.hydeAI.state;
    this.rescue = { active: false, startedAt: 0, windowS: 0, abilityAvailable: false, outcome: 'pending' };
    this.director = new EncounterDirector(this.course);
    this.activeObstacles = [...this.course.obstacles];
    this.negationsLeft = this.traits.negatedCollisions;
    this.maxFogDensity = this.course.fog.reduce((m, f) => Math.max(m, f.density), 0) || 0.03;
  }

  // ------------------------------------------------------------------------------------------- contract queries

  get progress(): number {
    return progressAt(this.course, this.boat.x, this.boat.z);
  }

  distanceToDock(): number {
    const f = this.course.finish;
    return Math.max(0, Math.hypot(this.boat.x - f.x, this.boat.z - f.z) - f.radius);
  }

  canPause(): boolean {
    return this.status !== 'rescue';
  }

  cinematic(): { kind: 'hyde_reveal'; remainingS: number } | null {
    return this.cinematicLeft > 0 ? { kind: 'hyde_reveal', remainingS: this.cinematicLeft } : null;
  }

  skipCinematic(): void {
    this.cinematicLeft = 0;
  }

  abilityStatus(): { ready: boolean; cooldownLeftS: number; chargesLeft: number | null; activeLeftS: number } {
    return this.abilities.status(this.t);
  }

  effects(): RunEffects {
    const shielded = this.inCurrent() && this.traits.currentPushMult * this.abilities.currentPushMult() < 1;
    return this.abilities.effects(this.t, this.hydeAI, shielded, this.boat.x, this.boat.z);
  }

  /** Fog density at the boat (course fog banks + the disturbance), after traits and fog-clearing abilities. */
  fogAt(): number {
    if (this.abilities.fogCleared(this.t, this.boat.x, this.boat.z)) return 0;
    return this.rawFog() * this.traits.fogMult;
  }

  // ------------------------------------------------------------------------------------------- extra queries

  /**
   * The boat's forward speed over the ground this step: its displacement projected on its heading, so a current
   * carrying it along the course counts (the Hyde swims in the same water) while sideways drift and bounces don't.
   * Paces the Hyde, and his closing caps are relative to it.
   */
  private groundSpeed(before: { x: number; z: number }, dt: number): number {
    const b = this.boat;
    if (dt <= 0) return b.speed;
    const along = (-(b.x - before.x) * Math.sin(b.heading) - (b.z - before.z) * Math.cos(b.heading)) / dt;
    return Math.max(0, along);
  }

  /** True after the first counted catch (GDD 5.4 last-chance mercy). */
  get lastChance(): boolean {
    return this.catches >= 1;
  }

  /** Seconds left of a surge telegraph (0 when none): the HUD/renderer warning before the burst. */
  surgeTelegraphLeftS(): number {
    return this.hydeAI.telegraphLeftS;
  }

  /** Seconds left stalled after the hull was swamped (HP 0); 0 when rowing normally. */
  swampedLeftS(): number {
    return Math.max(0, this.swampedUntil - this.t);
  }

  /** Radius around the boat in which hazards are outlined right now (0 = none). */
  revealRadius(): number {
    return this.abilities.revealRadius(this.t);
  }

  /** Real seconds left in the rescue window (0 when closed). */
  rescueLeftS(): number {
    return this.rescue.active ? Math.max(0, this.rescue.windowS - this.rescueRealT) : 0;
  }

  /** Real-time clean-escape window for this run (base + trait bonus). */
  get cleanEscapeWindowS(): number {
    return STAGE_TUNING.rescue.cleanEscapeWindowS + this.traits.cleanEscapeBonusS;
  }

  // ------------------------------------------------------------------------------------------- update

  update(frameDt: number, input: InputSnapshot): ActionEvent[] {
    if (this.status === 'finished' || this.status === 'dnf' || this.status === 'intro') return [];
    const events: ActionEvent[] = [];
    const real = Math.min(MAX_FRAME_S, Math.max(0, frameDt));
    this.cinematicLeft = Math.max(0, this.cinematicLeft - real);
    this.input = input;
    if (this.status === 'rescue') {
      this.updateRescue(real, input, events);
      return events;
    }
    if (input.ability) this.useAbility(events);
    for (let i = 0; i < input.strokes; i++) this.stroke(events);
    this.accumulator += real;
    while (this.accumulator >= FIXED_STEP_S && this.status === 'playing') {
      this.step(FIXED_STEP_S, events);
      this.accumulator -= FIXED_STEP_S;
    }
    if (this.status !== 'playing') this.accumulator = 0;
    return events;
  }

  private useAbility(events: ActionEvent[]): void {
    if (this.abilities.tryActivate({ t: this.t, boat: this.boat, hyde: this.hydeAI, events })) this.stats.abilitiesUsed++;
  }

  private stroke(events: ActionEvent[]): void {
    if (this.t < this.swampedUntil) return; // bailing water: the oars are down
    const b = this.boat;
    const tr = this.traits;
    let impulseMult = 1;
    if (tr.lowSpeedThreshold > 0 && b.speed < tr.lowSpeedThreshold) impulseMult *= tr.lowSpeedImpulseMult;
    if (tr.withCurrentImpulseMult !== 1) {
      const push = this.rawCurrent();
      const strength = Math.hypot(push.x, push.z);
      if (strength > 0.1) {
        const f = forwardVector(b.heading);
        const cos = (f.x * push.x + f.z * push.z) / strength;
        if (cos >= Math.cos(tr.withCurrentMaxAngleRad)) impulseMult *= tr.withCurrentImpulseMult;
      }
    }
    if (tr.nearHydeRangeU > 0 && this.hydeAI.hunting && this.hydeAI.gap <= tr.nearHydeRangeU) impulseMult *= tr.nearHydeImpulseMult;
    this.mods.topSpeedBonus = this.abilities.topSpeedBonus(this.t, this.hydeAI.gap, this.hydeAI.hunting);
    let costMult = this.abilities.strokeCostMult(this.t);
    if (b.speed >= tr.fastStrokeVmaxFraction * topSpeed(this.mods, this.cfg)) costMult *= tr.fastStrokeCostMult;
    const before = b.stamina;
    const result = applyStroke(b, this.mods, this.cfg, this.t, { impulseMult, costMult });
    if (!result.accepted) {
      this.stats.missedStrokes++;
      events.push({ type: 'missed_stroke', t: this.t });
      return;
    }
    this.stats.strokes++;
    this.stats.staminaUsed += before - b.stamina;
    events.push({ type: 'stroke', side: this.stats.strokes % 2 ? 'left' : 'right', power: result.power, t: this.t });
  }

  // ------------------------------------------------------------------------------------------- environment

  private rawCurrent(): Vec2 {
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

  private inCurrent(): boolean {
    return this.course.currents.some((c) => Math.hypot(this.boat.x - c.x, this.boat.z - c.z) < c.radius);
  }

  /** Current push on the boat after traits/passives, ability re-aiming and the lake-spirit assist. */
  private currentPush(): Vec2 {
    const raw = this.rawCurrent();
    const mult = this.traits.currentPushMult * this.abilities.currentPushMult();
    let push = this.abilities.ridePush(this.t, { x: raw.x * mult, z: raw.z * mult }, this.boat.heading);
    if (this.t > STAGE_TUNING.stage1.assistAfterS) {
      // lake-spirit assist: a gentle current along the heading whenever the bow points toward the dock
      const f = forwardVector(this.boat.heading);
      const dx = this.course.finish.x - this.boat.x;
      const dz = this.course.finish.z - this.boat.z;
      if (f.x * dx + f.z * dz > 0) {
        const a = STAGE_TUNING.stage1.assistCurrentUps;
        push = { x: push.x + f.x * a, z: push.z + f.z * a };
      }
    }
    return push;
  }

  private rawFog(): number {
    let density = 0;
    for (const f of this.course.fog) {
      const d = Math.hypot(this.boat.x - f.x, this.boat.z - f.z);
      if (d < f.radius) density = Math.max(density, f.density * (1 - d / f.radius));
    }
    if (this.disturbance) {
      const age = this.t - this.disturbance.at;
      const ramp = RUN.disturbanceFogRampS;
      const env = age < 0 || age > this.disturbance.durationS ? 0
        : Math.min(1, age / ramp, (this.disturbance.durationS - age) / (ramp * 2));
      density = Math.max(density, this.disturbance.density * env);
    }
    return density;
  }

  // ------------------------------------------------------------------------------------------- collisions

  private readonly impactHook: ImpactHook = (info: ImpactInfo): ImpactPolicy => {
    const a = this.abilities.impact(this.t, info.kind, info.canDamage, this.hydeAI);
    if (a.cut) {
      this.pendingCuts.add(info.id);
      return { damageMult: 0, speedLossMult: 0, minRetain: 1, pass: true };
    }
    const c = STAGE_TUNING.collision;
    if (a.absorbed) return { damageMult: 0, speedLossMult: 1, minRetain: STAGE_TUNING.abilities.shieldSpeedRetain };
    if (info.canDamage && this.negationsLeft > 0) {
      this.negationsLeft--;
      return { damageMult: 0, speedLossMult: 0, minRetain: 1 };
    }
    const glancing = info.headOn <= Math.sin((this.mods.glancingDeg * Math.PI) / 180);
    const soft = glancing || a.braced;
    return {
      damageMult: (soft ? c.glancingDamageMult : 1) * a.hullMult,
      speedLossMult: 1,
      minRetain: Math.max(this.traits.collisionMinRetain, soft ? c.glancingSpeedRetain : 0),
    };
  };

  private collide(dt: number, events: ActionEvent[]): void {
    const b = this.boat;
    const hpBefore = b.hp;
    const landHits = resolveLand(b, this.course.land ?? [], this.landMemory, this.mods.damageTaken, this.t, dt, this.impactHook);
    for (const h of landHits) {
      if (h.damage > 0 || h.absorbed) this.stats.collisions++;
      events.push({ type: 'collision', obstacleId: h.land.id, kind: 'land', damage: h.damage, impactSpeed: h.impactSpeed, x: b.x, z: b.z, t: this.t });
    }
    const ignored = this.abilities.ignoredKinds();
    const obstacles = ignored.size ? this.activeObstacles.filter((o) => !ignored.has(o.kind)) : this.activeObstacles;
    const hits = resolveCollisions(b, findContacts(b, obstacles, this.t), this.collisionMemory, this.mods.damageTaken, this.t, dt, this.impactHook);
    for (const h of hits) {
      if (this.pendingCuts.delete(h.obstacle.id)) {
        this.removeObstacle(h.obstacle);
        continue;
      }
      this.stats.collisions++;
      events.push({ type: 'collision', obstacleId: h.obstacle.id, kind: h.obstacle.kind, damage: h.damage, impactSpeed: h.impactSpeed, x: b.x, z: b.z, t: this.t });
    }
    this.stats.hpLost += hpBefore - b.hp;
  }

  private removeObstacle(o: Obstacle): void {
    this.activeObstacles = this.activeObstacles.filter((x) => x !== o);
    this.removedObstacles.add(o.id);
    this.obstacleRevision++;
  }

  /** Telekinetic shove (trait): every pushCooldownS, moves the nearest light obstacle ahead out of the line. */
  private shove(): void {
    const tr = this.traits;
    if (tr.pushRadiusU <= 0 || this.t - this.lastShoveAt < tr.pushCooldownS) return;
    const f = forwardVector(this.boat.heading);
    const bowX = this.boat.x + f.x * BOAT.hullCircles[0].offset;
    const bowZ = this.boat.z + f.z * BOAT.hullCircles[0].offset;
    let best: { o: Obstacle; ahead: number; side: number } | null = null;
    for (const o of this.activeObstacles) {
      if (!SHOVABLE_KINDS.has(o.kind)) continue;
      const p = obstaclePosition(o, this.t);
      const dx = p.x - bowX;
      const dz = p.z - bowZ;
      const ahead = dx * f.x + dz * f.z;
      const side = dx * -f.z + dz * f.x; // + = right of the bow
      const reach = o.radius + o.halfLength;
      if (ahead < -reach || ahead > tr.pushRadiusU + reach || Math.abs(side) > 1.6 + reach) continue;
      if (!best || ahead < best.ahead) best = { o, ahead, side };
    }
    if (!best) return;
    const dir = best.side >= 0 ? 1 : -1;
    const shift = best.o.radius + best.o.halfLength + 3;
    best.o.x += -f.z * dir * shift;
    best.o.z += f.x * dir * shift;
    this.displacedObstacles.add(best.o.id);
    this.obstacleRevision++;
    this.lastShoveAt = this.t;
  }

  // ------------------------------------------------------------------------------------------- the fixed step

  private hydeMods(): HydeModifiers {
    const m = STAGE_TUNING.mercy;
    const last = this.lastChance;
    const inFog = this.rawFog() > 0.25 * this.maxFogDensity;
    return {
      speedMult: this.abilities.hydeSpeedMult(this.t, inFog),
      surgeBoostMult: this.abilities.surgeBoostMult() * (last ? m.surgeBoostMult : 1),
      catchRadiusMult: this.abilities.catchRadiusMult(),
      floorPenalty: last ? m.floorPenalty : 0,
      maxClosingRel: last ? m.maxClosingRel : Infinity,
      canCatch: this.status === 'playing' && this.t >= this.catchInvulnUntil && !this.safeHarbour,
    };
  }

  private step(dt: number, events: ActionEvent[]): void {
    const held = this.status === 'rescue';
    const b = this.boat;
    const swamped = this.t < this.swampedUntil;
    if (!held && !swamped && this.input.holdRow && this.t >= this.holdNextAt) {
      this.stroke(events);
      this.holdNextAt = this.t + 1 / this.cfg.holdCadenceHz;
    }
    const before = { x: b.x, z: b.z, stamina: b.stamina };
    this.mods.topSpeedBonus = this.abilities.topSpeedBonus(this.t, this.hydeAI.gap, this.hydeAI.hunting);
    const steer = held ? NO_STEER : swamped ? { ...NO_STEER, brake: true } : this.input;
    integrateBoat(b, steer, this.mods, this.cfg, dt, this.t, this.currentPush());
    if (held) b.speed *= Math.exp(-HYDE.rescueHoldDragPerS * dt);
    clampToBounds(b, this.course.bounds, dt);
    this.collide(dt, events);
    if (!held) this.shove();
    this.trail.record(b.x, b.z);

    if (held) this.hydeAI.holdBoat(b.speed);
    else if (this.hydeAI.update(dt, this.t, this.groundSpeed(before, dt), this.hydeMods(), events)) this.onHydeReach(events);

    this.stats.staminaUsed += Math.max(0, before.stamina - b.stamina);
    this.stats.distance += Math.hypot(b.x - before.x, b.z - before.z);
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, b.speed);
    this.t += dt;
    this.stats.activeTimeS = this.t;
    this.bestProgress = Math.max(this.bestProgress, this.progress);
    this.abilities.update(this.t, events);
    this.trackDanger(dt);
    this.updateSwamp();
    if (!held && this.status === 'playing') {
      this.runEncounters(events);
      this.warnLowStamina(events);
      this.checkFinish(events);
    }
  }

  private trackDanger(dt: number): void {
    const h = this.hydeAI;
    if (!h.hunting) return;
    const gap = h.gap;
    if (gap < HYDE.dangerGapU) this.stats.timeInDangerS += dt;
    if (gap < HYDE.closeCallU) this.closeCallArmed = true;
    else if (this.closeCallArmed && gap > HYDE.closeCallRecoverU) {
      this.closeCallArmed = false;
      this.stats.hydeCloseCalls++;
    }
  }

  private updateSwamp(): void {
    const b = this.boat;
    if (this.t < this.swampedUntil) return;
    if (Number.isFinite(this.swampedUntil)) {
      // bailing finished: back in the race at swampedRestoreHp (HP never ends the run)
      b.hp = Math.max(b.hp, STAGE_TUNING.hull.swampedRestoreHp);
      this.swampedUntil = -Infinity;
      return;
    }
    if (b.hp <= 0) this.swampedUntil = this.t + STAGE_TUNING.hull.swampedStallS;
  }

  private warnLowStamina(events: ActionEvent[]): void {
    const low = this.boat.stamina / this.boat.maxStamina < this.cfg.lowStaminaThreshold;
    if (low && !this.lowStaminaWarned) events.push({ type: 'low_stamina', t: this.t });
    this.lowStaminaWarned = low;
  }

  private checkFinish(events: ActionEvent[]): void {
    const f = this.course.finish;
    if (Math.hypot(this.boat.x - f.x, this.boat.z - f.z) > f.radius) return;
    this.status = 'finished';
    this.hydeAI.retreat(this.t, events);
    events.push({ type: 'finish', t: this.t });
  }

  // ------------------------------------------------------------------------------------------- encounters

  private hydeStartGap(): number {
    return STAGE_TUNING.hyde.stage1.startGapU + this.traits.hydeStartGapBonusU;
  }

  private runEncounters(events: ActionEvent[]): void {
    for (const e of this.director.update(this.boat.x, this.boat.z, this.bestProgress)) this.fire(e, events);
    // time fallbacks so an idling or wandering player still meets the Hyde
    const h = this.hydeAI.state;
    if (h.phase === 'dormant' && this.t >= HYDE.dormantMaxS) {
      const e = this.director.force('disturbance');
      if (e) this.fire(e, events);
      else this.hydeAI.wake(this.hydeStartGap(), this.t, events);
    }
    if (h.phase === 'stalking' && h.phaseT >= HYDE.stalkMaxS) {
      const e = this.director.force('hyde_emerge');
      if (e) this.fire(e, events);
      else this.emerge(events);
    }
  }

  private emerge(events: ActionEvent[]): void {
    const wasHidden = this.hydeAI.state.phase === 'dormant' || this.hydeAI.state.phase === 'stalking';
    this.hydeAI.emerge(this.hydeStartGap(), this.t, events);
    if (wasHidden && this.hydeAI.state.phase === 'emerging' && !this.cinematicShown) {
      this.cinematicShown = true;
      this.cinematicLeft = RUN.cinematicS;
    }
  }

  private fire(e: EncounterTrigger, events: ActionEvent[]): void {
    events.push({ type: 'encounter', encounterId: e.id, kind: e.kind, t: this.t });
    switch (e.kind) {
      case 'calm':
        break;
      case 'disturbance':
        this.disturbance = {
          at: this.t,
          density: e.params?.fogDensity ?? e.params?.fog ?? this.maxFogDensity,
          durationS: e.params?.durationS ?? RUN.disturbanceFogS,
        };
        this.hydeAI.wake(this.hydeStartGap(), this.t, events);
        break;
      case 'hyde_emerge':
        this.emerge(events);
        break;
      case 'surge':
        this.hydeAI.requestSurge(this.t, e.params?.boost ?? e.params?.surgeBoost, e.params?.durationS);
        break;
      case 'safe_harbour':
        this.safeHarbour = true;
        this.hydeAI.retreat(this.t, events);
        break;
    }
  }

  // ------------------------------------------------------------------------------------------- catch + rescue

  private onHydeReach(events: ActionEvent[]): void {
    const block = this.abilities.grabBlockU(this.t);
    if (block !== null) {
      // an active grab-blocking shield repels him: no catch at all
      this.hydeAI.pushBack(block);
      this.hydeAI.stun(HYDE.aegisStunS, this.t, events);
      this.catchInvulnUntil = this.t + HYDE.aegisStunS;
      return;
    }
    const r = STAGE_TUNING.rescue;
    this.status = 'rescue';
    this.rescueRealT = 0;
    this.struggle = 0;
    this.closeCallArmed = false;
    this.rescue.active = true;
    this.rescue.startedAt = this.t;
    this.rescue.windowS = r.windowS + this.traits.rescueWindowBonusS + (this.lastChance ? STAGE_TUNING.mercy.rescueWindowBonusS : 0);
    this.rescue.abilityAvailable = this.abilities.rescueReady(this.t);
    this.rescue.outcome = 'pending';
    events.push({ type: 'hyde_catch', catchNumber: (this.catches + 1) as 1 | 2, t: this.t });
    events.push({ type: 'rescue_start', abilityAvailable: this.rescue.abilityAvailable, t: this.t });
  }

  private updateRescue(real: number, input: InputSnapshot, events: ActionEvent[]): void {
    const pressedAt = this.rescueRealT;
    this.rescueRealT += real;
    this.struggle += input.strokes;
    if (input.ability) {
      if (this.rescue.abilityAvailable) {
        this.resolveCatch(true, pressedAt, events);
        return;
      }
      events.push({ type: 'ability_denied', reason: this.ability.chargesLeft === 0 ? 'no_charges' : 'cooldown', t: this.t });
    }
    this.accumulator += real * STAGE_TUNING.rescue.timeScale;
    while (this.accumulator >= FIXED_STEP_S) {
      this.step(FIXED_STEP_S, events);
      this.accumulator -= FIXED_STEP_S;
    }
    if (this.rescueRealT >= this.rescue.windowS) this.resolveCatch(false, this.rescueRealT, events);
  }

  private resolveCatch(qUsed: boolean, qAtRealS: number, events: ActionEvent[]): void {
    const k = STAGE_TUNING.hyde.stage1;
    const rescueData = qUsed ? this.abilities.consumeForRescue(this.t) : this.abilityDef.rescue;
    if (qUsed) this.stats.abilitiesUsed++;
    const res = resolveRescue({
      qUsed, qAtRealS,
      cleanEscapeWindowS: this.cleanEscapeWindowS,
      cleanEscapesLeft: STAGE_TUNING.rescue.maxCleanEscapesPerRun - this.stats.cleanEscapes,
      rescue: rescueData,
      strugglePresses: this.struggle,
      baseDamage: k.catchHullDamage,
      hullMult: this.abilities.hullDamageMult(this.t),
      baseKnockbackU: k.postCatchGapU + this.traits.catchKnockbackBonusU,
    });
    if (qUsed) this.stats.rescues++;
    if (res.outcome === 'clean_escape') this.stats.cleanEscapes++;
    this.abilities.onCatch(this.t);
    this.rescue.active = false;
    this.rescue.outcome = res.outcome;
    this.accumulator = 0;
    const dnf = res.counted && this.catches + 1 >= STAGE_TUNING.catches.catchLimit;
    const damage = dnf ? 0 : res.damage; // the DNF itself is the penalty (D-13)
    this.lastRescue = {
      outcome: res.outcome, counted: res.counted, damage, knockbackU: res.knockbackU,
      negateDamage: qUsed && rescueData.negateDamage, protectEgg: qUsed && rescueData.protectEgg,
      text: qUsed ? rescueData.text : '', t: this.t,
    };
    events.push({ type: 'rescue_end', outcome: res.outcome, damage, t: this.t });
    if (res.counted) this.catches = Math.min(2, this.catches + 1) as 0 | 1 | 2;
    if (dnf) {
      this.status = 'dnf';
      events.push({ type: 'dnf', reason: 'second_catch', t: this.t });
      return;
    }
    this.boat.hp = Math.max(0, this.boat.hp - damage);
    this.stats.hpLost += damage;
    this.updateSwamp();
    this.hydeAI.knockBack(res.knockbackU, k.recoverStunS, this.t, events);
    this.catchInvulnUntil = this.t + k.postCatchInvulnS;
    this.status = 'playing';
  }
}
