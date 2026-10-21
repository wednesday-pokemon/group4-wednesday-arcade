// MysteryRun — the deterministic simulation of one visit to "The Silent Evidence" (docs/MYSTERY_CONTRACT.md "Sim API").
// Fixed 60 Hz inner step; time advances only through update(), so a paused app (not calling update) never counts.
// Deterministic per (seed, inputs): no Math.random, no wall clock. Status: tutorial → playing → accusing (clock stops
// at the deposit) → finished | dnf.
//
// Input conventions (match src/app/mystery/input.ts): yaw += lookYawDelta (positive turns left, contract yaw);
// pitch += lookPitchDelta (positive looks up), clamped. Edge inputs (interact/power/move/hint) are latched until the
// next inner step runs, so a press is never lost on a short frame. `interactHeld` (E held down) drives the
// hold-to-set-down of the egg (UX ruling 4); without it the egg can only be dropped by grabs / impacts.
//
// Tutorial: the player can walk / crouch / sprint, search the pier practice crate (E) and try F/Q; the Hyde is
// inactive. Tutorial events are returned (seq 0) but not logged; endTutorial() resets the clock to 0, clears
// cooldowns/effects and spawns the Hyde ≥ minSpawnM away. The log holds gameplay events only, seq 1, 2, 3, …
import { AbilityInterpreter, createSlot, resetSlot, slotStatus, type AbilitySlot } from './abilities.ts';
import { verdictFor } from './caseLogic.ts';
import type { SimTuning } from './config.ts';
import { createEffectState, type EffectState, type SimContext } from './context.ts';
import { clueInteractLabel, defaultCase, defaultMap, defaultRegistries, defaultTuning, practiceCrateFor } from './defaults.ts';
import { buildCardFrom, type Registries } from './draft.ts';
import { damageEgg, createEgg, dropEgg, eggLossMult } from './egg.ts';
import { pointInPolygon, wrapAngle, yawTo, World } from './geometry.ts';
import { createHydeRuntime, HydeBrain } from './hyde.ts';
import { defaultPracticePoint, Interaction, type InteractKind } from './interact.ts';
import { navGridFor, type NavGrid } from './nav.ts';
import { hearingRadius } from './noise.ts';
import {
  createPlayer, createPlayerMemory, recentNoise, recordOwnNoise, stanceNoiseRadius, stepPlayer, type PlayerMemory,
} from './player.ts';
import { Rng } from './rng.ts';
import { round1, scoreFor } from './scoring.ts';
import { combineMods } from './stats.ts';
import {
  MYSTERY_RULES_VERSION, type AbilityStatus, type ActiveEffects, type CaseDef, type ClueId, type DnfReason, type Duo,
  type DuoCard, type EggRuntime, type GameEvent, type HydeRuntime, type MapDef, type MysteryInput, type NoiseSource,
  type Objective, type PlayerState, type PlayMods, type RoomDef, type RunResult, type RunStatus, type StampedEvent,
  type StateSnapshot, type SuspectId, type Vec2, type Verdict,
} from './types.ts';

export interface MysteryRunOptions {
  duo: Duo;
  seed: string;
  map?: MapDef;
  caseDef?: CaseDef;
  tutorial?: boolean;
  /** Extras (tests / bots / analytics): override tuning or registries. */
  tuning?: SimTuning;
  registries?: Registries;
}

export interface Interactable { kind: InteractKind; id: string; label: string; progress: number }

export const IDLE_INPUT: MysteryInput = {
  moveX: 0, moveZ: 0, lookYawDelta: 0, lookPitchDelta: 0, sprint: false, crouch: false, interact: false, power: false,
  move: false, hint: false, interactHeld: false,
};

export class MysteryRun implements SimContext {
  readonly map: MapDef;
  readonly caseDef: CaseDef;
  readonly duo: Duo;
  readonly card: DuoCard;
  readonly seed: string;
  status: RunStatus;
  t = 0;
  readonly player: PlayerState;
  readonly hyde: HydeRuntime;
  readonly egg: EggRuntime;
  readonly cluesFound: ClueId[] = [];
  readonly log: StampedEvent[] = [];

  // ---- extras (read-only for renderer / HUD / analytics / tests)
  readonly tuning: SimTuning;
  readonly world: World;
  readonly mods: PlayMods;
  readonly fx: EffectState = createEffectState();
  readonly rng: Rng;
  readonly hydeBrain: HydeBrain;
  readonly power: AbilitySlot;
  readonly move: AbilitySlot;
  readonly interaction: Interaction;
  readonly practicePoint: Vec2;
  accused: SuspectId | null = null;
  verdict: Verdict = 'not_accused';
  dnfReason: DnfReason | null = null;
  /** Active seconds at the deposit (the clock stops there). */
  deliveredAt: number | null = null;

  private readonly interpreter: AbilityInterpreter;
  private readonly closedWorld: World;
  private readonly mem: PlayerMemory = createPlayerMemory();
  private seq = 0;
  private acc = 0;
  private pending: StampedEvent[] = [];
  private edges = { interact: false, power: false, move: false, hint: false };
  private input: MysteryInput = IDLE_INPUT;
  private hintReadyAt = 0;
  private premonitionCache: { t: number; path: Vec2[] } | null = null;
  private scentCache: { t: number; path: Vec2[] } | null = null;

  constructor(o: MysteryRunOptions) {
    this.duo = { characterId: o.duo.characterId, pokemonId: o.duo.pokemonId };
    this.seed = o.seed;
    this.map = o.map ?? defaultMap();
    this.caseDef = o.caseDef ?? defaultCase();
    this.tuning = o.tuning ?? defaultTuning();
    const reg = o.registries ?? defaultRegistries();
    const n = reg.nightshades[this.duo.characterId];
    const p = reg.partners[this.duo.pokemonId];
    if (!n || !p) throw new Error(`unknown duo ${this.duo.characterId}+${this.duo.pokemonId}`);
    this.card = buildCardFrom(this.duo, reg).card;
    this.mods = combineMods(n, p);
    this.world = new World(this.map, this.tuning.nav.lowCoverBlocksMovement);
    this.closedWorld = new World(this.map, this.tuning.nav.lowCoverBlocksMovement);
    this.rng = new Rng(this.seed, 'sim');
    this.player = createPlayer(this.map, this.tuning);
    this.hyde = createHydeRuntime(this.map);
    this.egg = createEgg(this.map, this.seed, this.tuning);
    this.hydeBrain = new HydeBrain(this.hyde);
    this.interpreter = new AbilityInterpreter(this.hydeBrain);
    this.power = createSlot(n.power);
    this.move = createSlot(p.move);
    this.practicePoint = practiceCrateFor(this.map) ?? defaultPracticePoint(this.map);
    this.interaction = new Interaction((id) => clueInteractLabel(id) ?? `Search: ${this.clueTitle(id)}`, this.practicePoint);
    this.player.roomId = this.roomAt(this.player.x, this.player.z)?.id ?? null;
    this.status = o.tutorial ? 'tutorial' : 'playing';
    if (this.status === 'playing') this.hydeBrain.start(this);
  }

  // ------------------------------------------------------------------------------------------- SimContext

  emit(e: GameEvent): void {
    const logged = this.status !== 'tutorial';
    const stamped = { ...e, t: Math.round(this.t * 1000) / 1000, seq: logged ? ++this.seq : 0 } as StampedEvent;
    if (logged) this.log.push(stamped);
    this.pending.push(stamped);
  }

  noise(source: NoiseSource, x: number, z: number, loudness: number): number {
    const l = Math.max(0, Math.min(1, loudness));
    const radiusM = hearingRadius(l, this.tuning.noise.knots);
    this.emit({ type: 'noise', source, x: r2(x), z: r2(z), loudness: Math.round(l * 1000) / 1000, radiusM: r2(radiusM) });
    if (source !== 'decoy') {
      recordOwnNoise(this.mem, this.t, l, this.tuning.noise.recentWindowS);
      this.hydeBrain.hearNoise(this, source, x, z, l);
    }
    return radiusM;
  }

  playerNav(gatesClosed = false): NavGrid {
    const w = gatesClosed ? this.closedWorld : this.world;
    return navGridFor(this.map, w, this.tuning.player.radius, this.tuning.nav.cellM, this.tuning.nav.lowCoverBlocksMovement);
  }

  hydeNav(): NavGrid {
    return navGridFor(this.map, this.world, this.tuning.hyde.radius, this.tuning.nav.cellM, this.tuning.nav.lowCoverBlocksMovement);
  }

  roomAt(x: number, z: number): RoomDef | null {
    for (const r of this.map.rooms) if (pointInPolygon(x, z, r.polygon)) return r;
    return null;
  }

  inFog(x: number, z: number): boolean {
    return this.roomAt(x, z)?.fog === true;
  }

  // ------------------------------------------------------------------------------------------- public API

  update(frameDt: number, input: MysteryInput): StampedEvent[] {
    this.pending = [];
    if (this.status !== 'tutorial' && this.status !== 'playing') return [];
    this.applyLook(input);
    this.setInput(input);
    const dt = this.tuning.fixedStepS;
    this.acc += Math.max(0, Math.min(this.tuning.maxFrameS, finite(frameDt)));
    while (this.acc >= dt - 1e-9 && (this.status === 'tutorial' || this.status === 'playing')) {
      this.acc -= dt;
      this.step(dt);
    }
    if (this.status !== 'tutorial' && this.status !== 'playing') this.acc = 0;
    return this.pending;
  }

  /** Applies a frame's mouse / key look deltas to yaw and pitch. */
  applyLook(input: Pick<MysteryInput, 'lookYawDelta' | 'lookPitchDelta'>): void {
    const p = this.player;
    const P = this.tuning.player;
    p.yaw = wrapAngle(p.yaw + finite(input.lookYawDelta));
    p.pitch = Math.max(-P.pitchLimit, Math.min(P.pitchLimit, p.pitch + finite(input.lookPitchDelta)));
  }

  /** Sets the input used by the next step()s and latches its edges (bots call this + step() directly). */
  setInput(input: MysteryInput): void {
    this.input = input;
    this.edges.interact ||= input.interact;
    this.edges.power ||= input.power;
    this.edges.move ||= input.move;
    this.edges.hint ||= input.hint;
  }

  /** One fixed inner step (bots / tests call it directly after setInput + applyLook; events go to log + pending). */
  step(dt: number = this.tuning.fixedStepS): void {
    if (this.status !== 'tutorial' && this.status !== 'playing') return;
    const edges = this.edges;
    this.edges = { interact: false, power: false, move: false, hint: false };
    const input = this.input;
    const tutorial = this.status === 'tutorial';
    if (!tutorial && edges.hint && this.t >= this.hintReadyAt) {
      this.hintReadyAt = this.t + this.tuning.player.hintCooldownS;
      this.emit({ type: 'hint_requested' });
    }
    if (edges.power) this.interpreter.activate(this, this.power, 'F');
    if (edges.move) this.interpreter.activate(this, this.move, 'Q');
    if (edges.interact) this.interaction.press(this, tutorial);
    stepPlayer(this, this.mem, input, dt);
    if (this.interaction.step(this, dt, input.interactHeld === true, tutorial) === 'deposit') {
      this.deliveredAt = this.t;
      this.player.interacting = null;
      this.player.speed = 0;
      this.status = 'accusing';
      return;
    }
    if (!tutorial) {
      this.hydeBrain.step(this, dt, () => this.onCatch());
      if (this.status !== 'playing') return;
      this.updateGate();
    }
    this.t += dt;
  }

  /** 'tutorial' → 'playing': clock to 0, cooldowns/effects cleared, Hyde spawned ≥ minSpawnM away. */
  endTutorial(): void {
    if (this.status !== 'tutorial') return;
    this.status = 'playing';
    this.t = 0;
    this.acc = 0;
    resetSlot(this.power);
    resetSlot(this.move);
    Object.assign(this.fx, createEffectState());
    this.mem.noises = [];
    this.interaction.cancel(this);
    const gate = this.map.powerSwitch?.gateWallId;
    if (gate && this.world.isWallOpen(gate)) this.world.setWallOpen(gate, false);
    this.hydeBrain.start(this);
  }

  powerStatus(): AbilityStatus {
    return slotStatus(this.power, this.t);
  }

  moveStatus(): AbilityStatus {
    return slotStatus(this.move, this.t);
  }

  effects(): ActiveEffects {
    const t = this.t;
    const fx = this.fx;
    const p = this.player;
    const h = this.hyde;
    const revealing = t < fx.revealCluesUntil;
    const revealedClues = revealing ? fx.revealedClues.filter((id) => !this.cluesFound.includes(id)) : [];
    const eggInRange = fx.revealCluesRangeM <= 0 || Math.hypot(this.egg.x - p.x, this.egg.z - p.z) <= fx.revealCluesRangeM;
    return {
      revealedClues,
      revealEgg: revealing && (this.egg.state === 'resting' || this.egg.state === 'dropped') && eggInRange,
      revealHazards: t < fx.revealHazardsUntil,
      premonitionPath: t < fx.premonitionUntil ? this.premonition() : null,
      scentTrail: t < fx.scentUntil ? this.scent() : null,
      speedBoost: t < fx.speedBoostUntil,
      lurePoint: t < fx.lureUntil && fx.lurePoint ? { ...fx.lurePoint } : null,
      hydeDistracted: t < h.distractedUntil,
      hydeStunned: t < h.stunnedUntil,
      hydePetrified: t < fx.hydeVisualUntil,
      hydeSlowed: t < h.slowedUntil,
      blockGrab: t < fx.blockGrabUntil,
      eggShield: t < fx.eggShieldUntil,
      switchPowered: t < fx.switchPoweredUntil,
      last: fx.last ? { ...fx.last, kinds: [...fx.last.kinds] } : null,
    };
  }

  /** What E does right now (HUD prompt) with its progress 0..1 (search / pickup / deposit / hold-to-drop). */
  interactable(): Interactable | null {
    if (this.status !== 'playing' && this.status !== 'tutorial') return null;
    const target = this.interaction.target(this, this.status === 'tutorial');
    if (!target) return null;
    return { kind: target.kind, id: target.id, label: target.label, progress: this.interaction.progressFor(target) };
  }

  objective(): Objective {
    if (this.status === 'accusing') return 'accuse';
    if (this.status === 'finished' || this.status === 'dnf') return 'done';
    if (this.egg.state === 'carried') return 'deliver_egg';
    if (this.egg.state === 'dropped') return 'retrieve_egg';
    if (this.cluesFound.length < this.caseDef.clues.length) return 'find_clues';
    return 'find_egg';
  }

  isWallOpen(id: string): boolean {
    return this.world.isWallOpen(id);
  }

  /** Hearing radius (m, un-occluded) of the player's footsteps in the current stance; 0 when standing still. */
  noiseRadiusM(): number {
    return this.player.stance === 'idle' ? 0 : r2(stanceNoiseRadius(this));
  }

  /** The render-only look of the current Hyde effect ('petrify' stone, 'pin' shackled), or null. */
  hydeVisual(): 'petrify' | 'pin' | null {
    return this.t < this.fx.hydeVisualUntil ? this.fx.hydeVisual : null;
  }

  /** The evidence board may open (the app pauses the sim) except while the Hyde is chasing. */
  boardAllowed(): boolean {
    return this.hyde.mode !== 'CHASE';
  }

  /** Direction to the Hyde relative to where the player faces (rad; 0 = ahead, + = to the left) and its distance. */
  hydeBearing(): { angle: number; distanceM: number } {
    const p = this.player;
    const h = this.hyde;
    return { angle: wrapAngle(yawTo(p.x, p.z, h.x, h.z) - p.yaw), distanceM: r2(Math.hypot(h.x - p.x, h.z - p.z)) };
  }

  snapshot(): StateSnapshot {
    const p = this.player;
    const h = this.hyde;
    return {
      t: Math.round(this.t * 1000) / 1000,
      roomId: p.roomId,
      stance: p.stance,
      speed: r2(p.speed),
      hp: p.hp,
      catches: p.catches,
      hidden: p.hidden,
      eggState: this.egg.state,
      eggSecurity: this.egg.security,
      cluesFound: this.cluesFound.length,
      hydeMode: h.mode,
      hydeDistanceM: r2(Math.hypot(h.x - p.x, h.z - p.z)),
      hydeOccluded: !this.world.lineOfSight(p.x, p.z, h.x, h.z),
      hydeSuspicion: Math.round(h.suspicion * 1000) / 1000,
      recentNoise: Math.round(recentNoise(this.mem, this.t, this.tuning.noise.recentWindowS) * 1000) / 1000,
      powerReady: this.t >= this.power.readyAt,
      moveReady: this.t >= this.move.readyAt,
      objective: this.objective(),
    };
  }

  /** One-shot accusation after the deposit. `null` = leave the case unsolved (verdict 'not_accused'). */
  accuse(suspect: SuspectId | null): StampedEvent[] {
    this.pending = [];
    if (this.status !== 'accusing') return [];
    if (suspect !== null && !this.caseDef.suspects.some((s) => s.id === suspect)) return [];
    this.accused = suspect;
    this.verdict = verdictFor(this.caseDef, this.cluesFound, suspect);
    this.emit({ type: 'accusation', suspectId: suspect, correct: suspect !== null && suspect === this.caseDef.culprit, cluesFound: this.cluesFound.length });
    this.status = 'finished';
    this.emit({ type: 'finish', verdict: this.verdict, score: scoreFor(this.egg.points, this.activeTimeS()) });
    return this.pending;
  }

  result(): RunResult | null {
    if (this.status !== 'finished' && this.status !== 'dnf') return null;
    const finished = this.status === 'finished';
    const activeTimeS = this.activeTimeS();
    return {
      rulesVersion: MYSTERY_RULES_VERSION,
      outcome: finished ? 'finished' : 'dnf',
      dnfReason: finished ? null : this.dnfReason,
      verdict: finished ? this.verdict : 'not_accused',
      accused: this.accused,
      correct: this.accused !== null && this.accused === this.caseDef.culprit,
      cluesFound: [...this.cluesFound],
      eggTier: this.egg.tier,
      eggPoints: finished && this.egg.state === 'delivered' ? this.egg.points : 0,
      eggSecurity: this.egg.security,
      activeTimeS,
      score: finished ? scoreFor(this.egg.points, activeTimeS) : null,
      catches: this.player.catches,
      hp: this.player.hp,
      duo: { ...this.duo },
    };
  }

  // ------------------------------------------------------------------------------------------- internals

  activeTimeS(): number {
    return round1(this.deliveredAt ?? this.t);
  }

  clueTitle(id: ClueId): string {
    return this.caseDef.clues.find((c) => c.id === id)?.title ?? id;
  }

  private onCatch(): void {
    const p = this.player;
    const T = this.tuning;
    const blocked = this.t < this.fx.blockGrabUntil;
    if (blocked) this.fx.blockGrabUntil = -Infinity; // consumed
    p.catches = Math.min(2, p.catches + 1) as 0 | 1 | 2;
    const hpLost = blocked ? 0 : Math.round(T.grab.hpLoss * this.mods.catchDamageMult);
    p.hp = Math.max(0, p.hp - hpLost);
    const carrying = this.egg.state === 'carried';
    const eggLoss = carrying && !blocked ? Math.min(this.egg.security, Math.round(T.grab.eggSecurityLoss * eggLossMult(this) * 10) / 10) : 0;
    this.emit({ type: 'catch', catchNumber: p.catches as 1 | 2, hpLost, eggSecurityLost: eggLoss, blocked });
    if (eggLoss > 0) damageEgg(this, T.grab.eggSecurityLoss, 'grab');
    this.interaction.cancel(this);
    if (carrying && !blocked) dropEgg(this, 'grab');
    if (p.catches >= T.grab.maxCatches) return this.dnf('second_catch');
    if (p.hp <= 0) return this.dnf('hp_depleted');
    this.release();
  }

  private dnf(reason: DnfReason): void {
    this.dnfReason = reason;
    this.status = 'dnf';
    this.emit({ type: 'dnf', reason });
  }

  /**
   * Release at the safe point nearest to the grab spot among those ≥ safeReleaseMinHydeDistM from the Hyde (and
   * reachable); if none qualifies, the reachable one farthest from the Hyde. Brief invulnerability follows.
   */
  private release(): void {
    const p = this.player;
    const nav = this.playerNav();
    const here = { x: p.x, z: p.z };
    const cands: { pt: Vec2; dHyde: number; dHere: number }[] = [];
    for (const s of this.map.safeReleasePoints) {
      const snapped = nav.nearestWalkable(s, 4);
      if (!snapped || !nav.reachable(snapped, this.map.tower, this.map.tower.radius + 2)) continue;
      cands.push({ pt: snapped, dHyde: Math.hypot(snapped.x - this.hyde.x, snapped.z - this.hyde.z), dHere: Math.hypot(snapped.x - here.x, snapped.z - here.z) });
    }
    const far = cands.filter((c) => c.dHyde >= this.tuning.grab.safeReleaseMinHydeDistM).sort((a, b) => a.dHere - b.dHere);
    const best = far[0]?.pt ?? cands.sort((a, b) => b.dHyde - a.dHyde)[0]?.pt ?? nav.nearestWalkable(here, 6) ?? here;
    p.x = best.x;
    p.z = best.z;
    p.speed = 0;
    this.mem.vx = 0;
    this.mem.vz = 0;
    p.invulnerableUntil = this.t + this.tuning.grab.invulnerableS;
    const room = this.roomAt(p.x, p.z)?.id ?? null;
    if (room !== p.roomId) {
      p.roomId = room;
      if (room) this.emit({ type: 'room_enter', roomId: room });
    }
    p.hidden = false;
  }

  /** A timed gate closes when its time is up — but never onto the player, the Hyde or the egg. */
  private updateGate(): void {
    const sw = this.map.powerSwitch;
    if (!sw || !this.world.isWallOpen(sw.gateWallId)) return;
    if (this.t < this.fx.switchPoweredUntil) return;
    const wall = this.world.walls.find((w) => w.id === sw.gateWallId);
    if (!wall) return;
    const clear = (x: number, z: number, r: number) => {
      const lx = wall.bx - wall.ax;
      const lz = wall.bz - wall.az;
      const len2 = lx * lx + lz * lz || 1;
      const tt = Math.max(0, Math.min(1, ((x - wall.ax) * lx + (z - wall.az) * lz) / len2));
      return Math.hypot(x - (wall.ax + lx * tt), z - (wall.az + lz * tt)) > wall.r + r + 0.05;
    };
    if (!clear(this.player.x, this.player.z, this.tuning.player.radius)) return;
    if (!clear(this.hyde.x, this.hyde.z, this.tuning.hyde.radius)) return;
    if (this.egg.state === 'dropped' && !clear(this.egg.x, this.egg.z, 0.3)) return;
    this.world.setWallOpen(sw.gateWallId, false);
    this.hyde.path = [];
  }

  private premonition(): Vec2[] {
    if (!this.premonitionCache || this.t - this.premonitionCache.t >= 0.25 || this.premonitionCache.t > this.t) {
      this.premonitionCache = { t: this.t, path: this.hydeBrain.predict(this, this.fx.premonitionAheadS) };
    }
    return this.premonitionCache.path.map((p) => ({ ...p }));
  }

  /** Scent trail: nav path to the nearest still-missing picked clue, else the egg (or the tower while carrying). */
  private scent(): Vec2[] {
    if (this.scentCache && this.t - this.scentCache.t < 0.5 && this.scentCache.t <= this.t) return this.scentCache.path.map((q) => ({ ...q }));
    const p = this.player;
    let goal: Vec2 | null = null;
    let bestD = Infinity;
    for (const c of this.map.clues) {
      if (this.cluesFound.includes(c.clueId) || !this.fx.scentClues.includes(c.clueId)) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < bestD) {
        bestD = d;
        goal = { x: c.x, z: c.z };
      }
    }
    if (!goal && (this.egg.state === 'resting' || this.egg.state === 'dropped')) goal = { x: this.egg.x, z: this.egg.z };
    if (!goal && this.egg.state === 'carried') goal = { x: this.map.tower.x, z: this.map.tower.z };
    const path = goal ? [{ x: p.x, z: p.z }, ...(this.playerNav().findPath(p, goal) ?? [])] : [];
    this.scentCache = { t: this.t, path };
    return path.map((q) => ({ ...q }));
  }
}

function finite(x: number): number {
  return Number.isFinite(x) ? x : 0;
}

function r2(x: number): number {
  return Math.round(x * 100) / 100;
}
