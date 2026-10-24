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
// inactive. Tutorial events are returned (seq 0) but not logged; endTutorial() resets the clock to 0 and clears
// cooldowns/effects. The log holds gameplay events only, seq 1, 2, 3, …
//
// Overhaul (docs/overhaul/OVERHAUL_CONTRACT.md "Sim rules"):
// - Session layout: with a case (no explicit `map`) the run draws a SessionLayout (layout.ts drawLayout, PRF keys
//   'site:<clueId>' / 'site:egg') and plays on the session map = the case map with `clues` / `eggSpawn` at the drawn
//   sites (geometry arrays shared, so nav grids are not rebuilt). `run.layout` is HIDDEN truth (sim / bot internals /
//   renderer near-range glint only). An explicit `map` (tests, fixtures) is used as-is; its layout is matched from it.
// - Investigation: `investigation()` is the PUBLIC state (site checks, traces, examines, passage, Hyde emergence and
//   sightings) that minimap / HUD / analytics read. See investigation.ts.
// - Hyde emergence: on maps whose world has hydeSpawns the Hyde is ABSENT for tuning.hyde.emergeAfterS active seconds
//   (`hydeEmerged` false: it neither moves, hears nor sees; its runtime stays parked at map.hydeStart). RENDERER: hide the
//   Hyde while `run.hydeEmerged` is false and play the emergence effect on `hyde_emerged`. HUD: hide the Hyde meter /
//   bearing / threat edge before it (hydeBearing() and snapshot().hydeDistanceM report HYDE_ABSENT_DISTANCE_M = 999 m).
//   It then emerges at a spawn drawn with PRF 'hyde:spawn' from layout.ts spawnDistribution(world, player, minSpawnM)
//   (valid = >= minSpawnM from the player, weights renormalised; none valid -> farthest), snapped to the nav grid,
//   patrolling from the nearest waypoint (`hyde_emerged`). Maps without spawns (fixtures) start the Hyde at t = 0.
// - Hazards: noisy floors (player.ts) and searchlights (hazards.ts, checked every step after the player moves).
// - Player sees Hyde: emerged, line of sight (walls + high cover) and distance <= sight.playerSeesHydeM ->
//   snapshot().hydeVisible and investigation().lastHydeSighting.
//
// Enemy contract (docs/overhaul/ENEMY_CONTRACT.md): Joseph Crackstone (crackstone.ts) exists only when the map's world
// has `crackstone` (R2; null otherwise and every Crackstone field reports "absent"). He is active in 'playing' from t = 0
// at def.start (inactive in the tutorial; endTutorial starts him), steps every fixed step AFTER the Hyde (R6 sees the
// Hyde's current mode), draws only from his own Rng(seed, 'crackstone'). A landed curse (R7): HP − round(curseHp ×
// catchDamageMult) unless block_grab (consumed), slowed × curseSlowMult for curseSlowS, invulnerable for
// curseInvulnerableS (both enemies ignore the player), `curse {hit}` then `dnf {hp_depleted}` at 0 HP; never a catch,
// never the egg. The player sees him with LOS within playerSeesCrackstoneM (crackstoneVisible(),
// investigation().lastCrackstoneSighting). scanExposure() / curseExposure() use the sim's own hit tests (UX_ENEMIES §2).
import { AbilityInterpreter, createSlot, resetSlot, slotStatus, type AbilitySlot } from './abilities.ts';
import { evidenceSupports, isCorrectSuspect, sanitizeEvidence, solutionMatches, verdictFor } from './caseLogic.ts';
import type { SimTuning } from './config.ts';
import { createEffectState, type EffectState, type SimContext } from './context.ts';
import { caseMap, defaultCase, defaultRegistries, defaultTuning, practiceCrateFor } from './defaults.ts';
import { buildCardFrom, type Registries } from './draft.ts';
import { damageEgg, createEgg, dropEgg, eggLossMult } from './egg.ts';
import { pointInPolygon, wrapAngle, yawTo, World } from './geometry.ts';
import { searchlightSees, searchlightsOf, type SearchlightHazard } from './hazards.ts';
import { CrackstoneBrain, type EnemyExposure } from './crackstone.ts';
import { createHydeRuntime, HydeBrain } from './hyde.ts';
import { defaultPracticePoint, Interaction, type InteractKind } from './interact.ts';
import { InvestigationTracker } from './investigation.ts';
import { drawHydeSpawn, drawLayout, layoutFromMap, sessionMap } from './layout.ts';
import { navGridFor, type NavGrid } from './nav.ts';
import { hearingRadius } from './noise.ts';
import {
  createPlayer, createPlayerMemory, recentNoise, recordOwnNoise, stanceNoiseRadius, stepPlayer, type PlayerMemory,
} from './player.ts';
import { Rng } from './rng.ts';
import { round1, scoreFor } from './scoring.ts';
import { combineMods } from './stats.ts';
import {
  CRACKSTONE_ABSENT_SNAPSHOT, CRACKSTONE_NO_EFFECTS, MYSTERY_RULES_VERSION, type Accusation, type CrackstoneDef, type CrackstoneRuntime, type AbilityStatus, type ActiveEffects, type CaseDef, type CaseSolution, type ClueId, type DnfReason, type Duo,
  type DuoCard, type EggRuntime, type GameEvent, type HydeRuntime, type InvestigationState, type MapDef, type MysteryInput,
  type NoiseSource, type Objective, type PlayerState, type PlayMods, type RoomDef, type RunResult, type RunStatus,
  type SessionLayout, type StampedEvent, type StateSnapshot, type SuspectId, type Vec2, type Verdict,
} from './types.ts';

/**
 * Reported as the Hyde distance (snapshot().hydeDistanceM, hydeBearing().distanceM) while the Hyde has not emerged yet:
 * a large constant (999 m) instead of a real distance, so models / HUD treat it as "absent".
 */
export const HYDE_ABSENT_DISTANCE_M = 999;

export interface MysteryRunOptions {
  duo: Duo;
  seed: string;
  map?: MapDef;
  caseDef?: CaseDef;
  tutorial?: boolean;
  /** Extras (tests / bots / analytics): override tuning or registries. */
  tuning?: SimTuning;
  registries?: Registries;
  /** Force the session layout (tests / analytics replays) instead of drawing it from the seed. Case-world maps only. */
  layout?: SessionLayout;
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
  /** Joseph Crackstone's PUBLIC runtime (null on maps without him). Position is public only per R4 (HUD rule). */
  readonly crackstone: CrackstoneRuntime | null;
  readonly crackstoneBrain: CrackstoneBrain | null;
  /** His haunt (public data: area name + outline, patrol, leash); null on maps without him. */
  readonly crackstoneDef: CrackstoneDef | null;
  readonly power: AbilitySlot;
  readonly move: AbilitySlot;
  readonly interaction: Interaction;
  readonly practicePoint: Vec2;
  /** HIDDEN truth: this session's drawn clue / egg sites (never shown to the player or used by analytics estimates). */
  readonly layout: SessionLayout;
  readonly inv: InvestigationTracker;
  /** Active seconds when the Hyde emerged (0 for maps without spawns); null before. */
  hydeEmergedAt: number | null = null;
  /** The HydeSpawnDef id it emerged at ('start' on maps without spawns); null before. */
  hydeSpawnId: string | null = null;
  accused: SuspectId | null = null;
  correct = false;
  deductionCorrect = false;
  evidence: string[] = [];
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
  private readonly usesEmergence: boolean;
  private readonly lights: SearchlightHazard[];
  private readonly lightReadyAt = new Map<string, number>();
  private hydeVisibleNow = false;
  private lastHydeSighting: { t: number; x: number; z: number } | null = null;
  private crackstoneVisibleNow = false;
  private lastCrackstoneSighting: { t: number; x: number; z: number } | null = null;
  private crackstonePremonitionCache: { t: number; path: Vec2[] } | null = null;

  constructor(o: MysteryRunOptions) {
    this.duo = { characterId: o.duo.characterId, pokemonId: o.duo.pokemonId };
    this.seed = o.seed;
    this.caseDef = o.caseDef ?? defaultCase();
    const base = o.map ?? caseMap(this.caseDef.id);
    if (base.world && (!o.map || o.layout)) {
      this.layout = o.layout ?? drawLayout(base.world, this.seed);
      this.map = sessionMap(base, this.layout);
    } else {
      this.layout = layoutFromMap(base);
      this.map = base;
    }
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
    this.crackstoneDef = this.map.world?.crackstone ?? null;
    // his own random stream: maps without him keep the sim stream (and every log) byte-identical
    this.crackstoneBrain = this.crackstoneDef ? new CrackstoneBrain(this.crackstoneDef, this.tuning, new Rng(this.seed, 'crackstone')) : null;
    this.crackstone = this.crackstoneBrain?.c ?? null;
    this.interpreter = new AbilityInterpreter(this.hydeBrain, this.crackstoneBrain);
    this.power = createSlot(n.power);
    this.move = createSlot(p.move);
    this.practicePoint = practiceCrateFor(this.map) ?? defaultPracticePoint(this.map);
    this.interaction = new Interaction((id) => this.caseDef.clues.find((c) => c.id === id)?.interactLabel ?? `Search: ${this.clueTitle(id)}`, this.practicePoint);
    this.inv = new InvestigationTracker(this.map.world ?? null, this.layout, this.seed);
    this.usesEmergence = (this.map.world?.hydeSpawns.length ?? 0) > 0;
    this.lights = searchlightsOf(this.map.world?.hazards);
    this.player.roomId = this.roomAt(this.player.x, this.player.z)?.id ?? null;
    this.status = o.tutorial ? 'tutorial' : 'playing';
    if (this.status === 'playing' && !this.usesEmergence) this.startLegacyHyde();
    if (this.status === 'playing') this.crackstoneBrain?.start(this);
  }

  /** Maps without hydeSpawns: the Hyde is there from t = 0 (>= minSpawnM away), no `hyde_emerged` event. */
  private startLegacyHyde(): void {
    this.hydeBrain.start(this);
    this.hydeEmergedAt = this.t;
    this.hydeSpawnId = 'start';
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

  openWallPermanently(id: string): void {
    this.world.setWallOpen(id, true);
    this.closedWorld.setWallOpen(id, true);
    this.hydeBrain.invalidatePath();
    this.crackstoneBrain?.invalidatePath();
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
    stepPlayer(this, this.mem, input, dt, !tutorial);
    if (!tutorial) {
      this.inv.observe(this);
      this.observeEffects();
      this.checkSearchlights();
    }
    if (this.interaction.step(this, dt, input.interactHeld === true, tutorial) === 'deposit') {
      this.deliveredAt = this.t;
      this.player.interacting = null;
      this.player.speed = 0;
      this.status = 'accusing';
      return;
    }
    if (!tutorial) {
      if (this.usesEmergence && this.hydeEmergedAt === null && this.t >= this.tuning.hyde.emergeAfterS - 1e-9) this.emergeHyde();
      this.hydeBrain.step(this, dt, () => this.onCatch());
      if (this.status !== 'playing') return;
      if (this.crackstoneBrain) {
        this.crackstoneBrain.step(this, dt, () => this.onCurse());
        if (this.status !== 'playing') return;
      }
      this.updateGate();
      this.updateSighting();
    }
    this.t += dt;
  }

  /**
   * The Hyde emerges NOW (normally called by step() at emergeAfterS; tests / debug may call it early): spawn drawn with
   * PRF 'hyde:spawn' from spawnDistribution(world, player, minSpawnM), snapped to nav, patrol from the nearest waypoint,
   * `hyde_emerged`. No-op once emerged or outside 'playing'.
   */
  emergeHyde(): void {
    if (this.hydeEmergedAt !== null || this.status !== 'playing') return;
    const w = this.map.world;
    const spawn = w ? drawHydeSpawn(w, this.seed, this.player, this.tuning.hyde.minSpawnM) : null;
    if (!spawn) {
      this.startLegacyHyde();
      return;
    }
    const at = this.hydeBrain.emerge(this, spawn);
    this.hydeEmergedAt = this.t;
    this.hydeSpawnId = spawn.id;
    this.emit({ type: 'hyde_emerged', spawnId: spawn.id, x: r2(at.x), z: r2(at.z) });
  }

  /** The Hyde is in play (emerged). False before emergence and during the tutorial on case maps. */
  get hydeEmerged(): boolean {
    return this.hydeEmergedAt !== null;
  }

  /** PUBLIC investigation state (a fresh copy): what the player has observed. Never exposes the hidden layout. */
  investigation(): InvestigationState {
    const emerged = this.hydeEmerged;
    const emergeIn = this.status === 'tutorial' ? this.tuning.hyde.emergeAfterS : Math.max(0, this.tuning.hyde.emergeAfterS - this.t);
    return {
      ...this.inv.core(),
      hydeEmerged: emerged,
      hydeEmergedAt: this.hydeEmergedAt === null ? null : Math.round(this.hydeEmergedAt * 1000) / 1000,
      hydeEmergesInS: emerged ? null : Math.round(emergeIn * 10) / 10,
      lastHydeSighting: this.lastHydeSighting ? { ...this.lastHydeSighting } : null,
      lastCrackstoneSighting: this.lastCrackstoneSighting ? { ...this.lastCrackstoneSighting } : null,
    };
  }

  /** The player can see the Hyde right now (emerged, line of sight, <= sight.playerSeesHydeM). */
  hydeVisible(): boolean {
    return this.hydeEmerged && this.hydeVisibleNow;
  }

  private updateSighting(): void {
    const p = this.player;
    const h = this.hyde;
    const visible = this.hydeEmerged && Math.hypot(h.x - p.x, h.z - p.z) <= this.tuning.sight.playerSeesHydeM && this.world.lineOfSight(p.x, p.z, h.x, h.z);
    this.hydeVisibleNow = visible;
    if (visible) this.lastHydeSighting = { t: Math.round(this.t * 1000) / 1000, x: r2(h.x), z: r2(h.z) };
    const cs = this.crackstoneBrain;
    if (!cs) return;
    const c = cs.c;
    const sees = cs.active && Math.hypot(c.x - p.x, c.z - p.z) <= cs.cfg.playerSeesCrackstoneM && this.world.lineOfSight(p.x, p.z, c.x, c.z);
    this.crackstoneVisibleNow = sees;
    if (sees) this.lastCrackstoneSighting = { t: Math.round(this.t * 1000) / 1000, x: r2(c.x), z: r2(c.z) };
  }

  /** Joseph Crackstone is in this case (his def exists), whether or not play has started. */
  get crackstonePresent(): boolean {
    return this.crackstoneBrain !== null;
  }

  /** The player can see Crackstone right now (active, line of sight, ≤ crackstone.playerSeesCrackstoneM). */
  crackstoneVisible(): boolean {
    return this.crackstoneBrain !== null && this.crackstoneBrain.active && this.crackstoneVisibleNow;
  }

  /**
   * Direction to Crackstone relative to where the player faces (rad; 0 = ahead, + = left) and his distance; without
   * an active Crackstone { angle: 0, distanceM: HYDE_ABSENT_DISTANCE_M }. The HUD shows it only per R4.
   */
  crackstoneBearing(): { angle: number; distanceM: number } {
    const cs = this.crackstoneBrain;
    if (!cs || !cs.active) return { angle: 0, distanceM: HYDE_ABSENT_DISTANCE_M };
    const p = this.player;
    const c = cs.c;
    return { angle: wrapAngle(yawTo(p.x, p.z, c.x, c.z) - p.yaw), distanceM: r2(Math.hypot(c.x - p.x, c.z - p.z)) };
  }

  /** The render-only look of the current Crackstone effect ('petrify' stone, 'pin' bound), or null. */
  crackstoneVisual(): 'petrify' | 'pin' | null {
    return this.crackstoneBrain && this.t < this.fx.crackstoneVisualUntil ? this.fx.crackstoneVisual : null;
  }

  /**
   * Pending scan warning: 'exposed' (the pulse would hit you now: inside scanRadiusM, line of sight from him, not
   * hidden — crouching does not help), 'covered' (inside but behind a wall / high cover, hidden or invulnerable), 'out'
   * (outside the ring); null when no warning is pending. The sim's own pulse test.
   */
  scanExposure(): EnemyExposure | null {
    return this.crackstoneBrain?.scanExposure(this) ?? null;
  }

  /** Pending curse circle: 'exposed' (it would land on you now), 'covered', 'out'; null when no curse is pending. */
  curseExposure(): EnemyExposure | null {
    return this.crackstoneBrain?.curseExposure(this) ?? null;
  }

  /** Reveal effects that keep showing the resting egg while active (reveal in range, scent trail ending at the egg). */
  private observeEffects(): void {
    const egg = this.egg;
    if (egg.state !== 'resting' || this.inv.eggSeenAt !== null) return;
    const fx = this.fx;
    const p = this.player;
    if (this.t < fx.revealCluesUntil && (fx.revealCluesRangeM <= 0 || Math.hypot(egg.x - p.x, egg.z - p.z) <= fx.revealCluesRangeM)) {
      this.inv.eggSeen(this);
    } else if (this.t < fx.scentUntil && fx.scentClues.every((id) => this.cluesFound.includes(id))) {
      this.inv.eggSeen(this); // the trail leads to the egg
    }
  }

  /** Searchlights: a visible, not-hidden player in a beam -> hazard_triggered + 'hazard' noise (per-light cooldown). */
  private checkSearchlights(): void {
    if (this.lights.length === 0) return;
    const p = this.player;
    for (const h of this.lights) {
      if (this.t < (this.lightReadyAt.get(h.id) ?? -Infinity)) continue;
      if (!searchlightSees(this.world, h, this.t, p)) continue;
      this.lightReadyAt.set(h.id, this.t + Math.max(0, h.cooldownS));
      this.emit({ type: 'hazard_triggered', hazardId: h.id });
      this.noise('hazard', p.x, p.z, h.loudness);
    }
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
    this.mem.floorId = null; // a noisy floor stepped on in the tutorial is announced again in play
    this.interaction.cancel(this);
    const gate = this.map.powerSwitch?.gateWallId;
    if (gate && this.world.isWallOpen(gate)) this.world.setWallOpen(gate, false);
    this.lightReadyAt.clear();
    if (!this.usesEmergence) this.startLegacyHyde(); // case maps: the Hyde emerges emergeAfterS after this point
    this.crackstoneBrain?.start(this); // Crackstone is there from t = 0 of play (R4)
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
      ...this.crackstoneEffects(),
    };
  }

  private crackstoneEffects(): typeof CRACKSTONE_NO_EFFECTS {
    const t = this.t;
    const fx = this.fx;
    const c = this.crackstone;
    return {
      ...CRACKSTONE_NO_EFFECTS,
      crackstoneDistracted: c !== null && t < c.distractedUntil,
      crackstoneStunned: c !== null && t < c.stunnedUntil,
      crackstonePetrified: c !== null && t < fx.crackstoneVisualUntil,
      crackstoneSlowed: c !== null && t < c.slowedUntil,
      crackstonePremonitionPath: c !== null && t < fx.crackstonePremonitionUntil ? this.crackstonePremonition() : null,
      enemiesRevealed: t < fx.enemyRevealUntil,
      enemyRevealRangeM: t < fx.enemyRevealUntil ? fx.enemyRevealRangeM : 0,
      cursed: t < fx.cursedUntil,
    };
  }

  /**
   * What E does right now (HUD prompt) with its progress 0..1. Kinds: clue (search), egg (pickup / hold-to-set-down),
   * tower (deposit), lever (open the passage), examine (suspicious object), switch (gate), practice (tutorial crate).
   * Priority when several are in reach: clue > egg > tower > lever > examine > switch (see interact.ts).
   */
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

  /**
   * The evidence board may open (the app pauses the sim) except while the Hyde is chasing or Crackstone is chasing /
   * cursing / has a scan warning or a curse circle pending.
   */
  boardAllowed(): boolean {
    return this.hyde.mode !== 'CHASE' && !(this.crackstoneBrain?.threatening() ?? false);
  }

  /**
   * Direction to the Hyde relative to where the player faces (rad; 0 = ahead, + = to the left) and its distance. Before
   * emergence: { angle: 0, distanceM: HYDE_ABSENT_DISTANCE_M }.
   */
  hydeBearing(): { angle: number; distanceM: number } {
    if (!this.hydeEmerged) return { angle: 0, distanceM: HYDE_ABSENT_DISTANCE_M };
    const p = this.player;
    const h = this.hyde;
    return { angle: wrapAngle(yawTo(p.x, p.z, h.x, h.z) - p.yaw), distanceM: r2(Math.hypot(h.x - p.x, h.z - p.z)) };
  }

  snapshot(): StateSnapshot {
    const p = this.player;
    const h = this.hyde;
    const emerged = this.hydeEmerged;
    return {
      hydeEmerged: emerged,
      hydeVisible: this.hydeVisible(),
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
      // before emergence: HYDE_ABSENT_DISTANCE_M (999 m) and occluded (there is nothing to see)
      hydeDistanceM: emerged ? r2(Math.hypot(h.x - p.x, h.z - p.z)) : HYDE_ABSENT_DISTANCE_M,
      hydeOccluded: emerged ? !this.world.lineOfSight(p.x, p.z, h.x, h.z) : true,
      hydeSuspicion: Math.round(h.suspicion * 1000) / 1000,
      recentNoise: Math.round(recentNoise(this.mem, this.t, this.tuning.noise.recentWindowS) * 1000) / 1000,
      powerReady: this.t >= this.power.readyAt,
      moveReady: this.t >= this.move.readyAt,
      objective: this.objective(),
      ...this.crackstoneSnapshot(),
    };
  }

  private crackstoneSnapshot(): typeof CRACKSTONE_ABSENT_SNAPSHOT {
    const cs = this.crackstoneBrain;
    if (!cs) return { ...CRACKSTONE_ABSENT_SNAPSHOT };
    const p = this.player;
    const c = cs.c;
    return {
      crackstonePresent: true,
      crackstoneMode: c.mode,
      crackstoneDistanceM: cs.active ? r2(Math.hypot(c.x - p.x, c.z - p.z)) : HYDE_ABSENT_DISTANCE_M,
      crackstoneOccluded: cs.active ? !this.world.lineOfSight(p.x, p.z, c.x, c.z) : true,
      crackstoneVisible: this.crackstoneVisible(),
      crackstoneSuspicion: Math.round(c.suspicion * 1000) / 1000,
    };
  }

  /**
   * One-shot accusation after the deposit: a suspect (`null` = leave the case unsolved → 'not_accused') and the evidence
   * cited for it. `solution` is the case's answer key, which the app loads only now (after the visitor committed);
   * a key for another case/version is refused. Uncitable evidence ids are dropped.
   */
  accuse(accusation: Accusation, solution: CaseSolution): StampedEvent[] {
    this.pending = [];
    if (this.status !== 'accusing' || !solutionMatches(this.caseDef, solution)) return [];
    const suspect = accusation.suspectId;
    if (suspect !== null && !this.caseDef.suspects.some((s) => s.id === suspect)) return [];
    const evidence = suspect === null ? [] : sanitizeEvidence(this.caseDef, this.cluesFound, accusation.evidence);
    this.accused = suspect;
    this.evidence = evidence;
    this.correct = isCorrectSuspect(solution, suspect);
    this.deductionCorrect = suspect !== null && evidenceSupports(solution, evidence);
    this.verdict = verdictFor(this.caseDef, solution, this.cluesFound, { suspectId: suspect, evidence });
    this.emit({
      type: 'accusation', suspectId: suspect, correct: this.correct, cluesFound: this.cluesFound.length, evidence: [...evidence],
      deductionCorrect: this.deductionCorrect,
    });
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
      caseId: this.caseDef.id,
      caseVersion: this.caseDef.version,
      outcome: finished ? 'finished' : 'dnf',
      dnfReason: finished ? null : this.dnfReason,
      verdict: finished ? this.verdict : 'not_accused',
      accused: this.accused,
      correct: this.correct,
      evidence: [...this.evidence],
      deductionCorrect: this.deductionCorrect,
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

  /**
   * A Crackstone curse landed (R7): HP − round(curseHp × catchDamageMult) unless block_grab (consumed, no damage, no
   * slow); slowed × curseSlowMult for curseSlowS; invulnerable for curseInvulnerableS; `curse {hit}` (hpLost = HP
   * actually deducted), then `dnf {hp_depleted}` at 0 HP. Never a catch, never the egg. Returns false when the run ended.
   */
  private onCurse(): boolean {
    const cs = this.crackstoneBrain;
    if (!cs || this.status !== 'playing') return false;
    const p = this.player;
    const cfg = cs.cfg;
    const blocked = this.t < this.fx.blockGrabUntil;
    if (blocked) this.fx.blockGrabUntil = -Infinity; // consumed
    const dmg = blocked ? 0 : Math.round(cfg.curseHp * this.mods.catchDamageMult);
    const before = p.hp;
    p.hp = Math.max(0, p.hp - dmg);
    const hpLost = Math.round((before - p.hp) * 1000) / 1000;
    this.emit({ type: 'curse', phase: 'hit', hpLost, blocked });
    if (!blocked) {
      this.fx.cursedUntil = this.t + cfg.curseSlowS;
      this.fx.curseSlowMult = cfg.curseSlowMult;
    }
    p.invulnerableUntil = Math.max(p.invulnerableUntil, this.t + cfg.curseInvulnerableS);
    if (p.hp <= 0) {
      this.dnf('hp_depleted');
      return false;
    }
    return true;
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
    // Crackstone (if any): prefer points also ≥ releaseMinDistM from him and outside his cursed area
    const cs = this.crackstoneBrain;
    const awayFromCrackstone = cs ? far.filter((c) => Math.hypot(c.pt.x - cs.c.x, c.pt.z - cs.c.z) >= cs.cfg.releaseMinDistM && !cs.inArea(c.pt.x, c.pt.z)) : far;
    const best = awayFromCrackstone[0]?.pt ?? far[0]?.pt ?? cands.sort((a, b) => b.dHyde - a.dHyde)[0]?.pt ?? nav.nearestWalkable(here, 6) ?? here;
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
    const cs = this.crackstoneBrain;
    if (cs && !clear(cs.c.x, cs.c.z, cs.cfg.radius)) return;
    if (this.egg.state === 'dropped' && !clear(this.egg.x, this.egg.z, 0.3)) return;
    this.world.setWallOpen(sw.gateWallId, false);
    this.hydeBrain.invalidatePath();
    cs?.invalidatePath();
  }

  private premonition(): Vec2[] {
    if (!this.premonitionCache || this.t - this.premonitionCache.t >= 0.25 || this.premonitionCache.t > this.t) {
      this.premonitionCache = { t: this.t, path: this.hydeBrain.predict(this, this.fx.premonitionAheadS) };
    }
    return this.premonitionCache.path.map((p) => ({ ...p }));
  }

  private crackstonePremonition(): Vec2[] {
    const cs = this.crackstoneBrain;
    if (!cs) return [];
    const cache = this.crackstonePremonitionCache;
    if (!cache || this.t - cache.t >= 0.25 || cache.t > this.t) {
      this.crackstonePremonitionCache = { t: this.t, path: cs.predict(this, this.fx.premonitionAheadS) };
    }
    return this.crackstonePremonitionCache!.path.map((p) => ({ ...p }));
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
