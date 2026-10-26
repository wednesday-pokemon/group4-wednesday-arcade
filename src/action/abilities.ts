// Pokémon abilities: ONE data-driven interpreter. Active effects are keyed by `specialty` and read only
// magnitude / durationS / cooldownS / charges from POKEMON_ABILITY_DEFS; passives are keyed by `passive.kind`.
// There are no Pokémon-id branches anywhere in the action code. Stage 1 meaning of each specialty (GDD 9.1):
//   speed_boost        +mag u/s instantly, speed cap +mag for durationS
//   shield             absorbs the next mag obstacle/reef hits (0 damage, keeps 85 % speed) for durationS
//   hyde_distraction   Hyde chases a decoy at v × mag for durationS; cancels an active surge
//   pursuit_slow       Hyde v × mag for durationS, also during surges
//   obstacle_detection hazards within mag u are revealed: hits on revealed hazards are braced (glancing damage/speed)
//   egg_protection     hull damage × (1 − mag × eggProtectHullFactor) for durationS (collisions and the catch)
//   stamina_restore    +mag stamina instantly; strokes cost nothing for durationS
//   fog_clear          fog 0 within mag u of the flare point; hazards there are revealed (braced)
//   egg_sense          on water: hazard glints within mag × eggSenseWaterRadiusMult (revealed → braced)
//   current_ride       currents re-aimed along the heading × mag; outside currents +mag u/s forward push
import { HYDE, RUN } from './config.ts';
import { STAGE_TUNING } from './data/stages.ts';
import type { HydeAI } from './hyde.ts';
import type { ActionEvent, AbilityRuntime, BoatState, ObstacleKind, PokemonAbilityDef, Vec2 } from './types.ts';

/** Constants quoted in passive texts (no data field exists for them). */
const LEAD_BONUS_GAP_U = 25; // "With the Hyde 25 u+ behind, top speed +0.6 u/s" (was 50 before the D-32 Hyde retune)
const ROOT_SPEED_MULT = 0.5; // "Each collision roots the Hyde (50% speed)"
const CUTTABLE: ReadonlySet<ObstacleKind> = new Set<ObstacleKind>(['log', 'branch', 'buoy', 'debris']);

export interface AbilityContext {
  t: number;
  boat: BoatState;
  hyde: HydeAI;
  events: ActionEvent[];
}

export interface AbilityEffects {
  shield: boolean; speedBoost: boolean; hydeSlowed: boolean; hydeDistracted: boolean; decoy: Vec2 | null;
  fogCleared: boolean; obstaclesRevealed: boolean; currentShield: boolean; anchored: boolean; staminaSurge: boolean;
}

/** Ability-side modification of a fresh impact (the run combines it with traits and handling). */
export interface AbilityImpact { cut: boolean; absorbed: boolean; braced: boolean; hullMult: number }

export class PokemonAbilitySystem {
  readonly runtime: AbilityRuntime;
  used = 0; // successful activations (Q presses and rescues)
  private shieldHitsLeft = 0;
  private flare: { x: number; z: number; r: number } | null = null;
  private curseUntil = -Infinity;
  private effectLive = false;
  private decoySide = 1;

  constructor(readonly def: PokemonAbilityDef) {
    this.runtime = { pokemonId: def.id, chargesLeft: def.charges, cooldownUntil: 0, activeUntil: 0, lastActivatedAt: -1e6 };
  }

  /** Value of the passive if this Pokémon has one of that kind. */
  passive(kind: string): number | null {
    return this.def.passive?.kind === kind ? this.def.passive.value : null;
  }

  private get specialty() {
    return this.def.specialty;
  }

  isActive(t: number): boolean {
    return t < this.runtime.activeUntil;
  }

  private activeAs(t: number, s: PokemonAbilityDef['specialty']): boolean {
    return this.specialty === s && this.isActive(t);
  }

  ready(t: number): boolean {
    return this.runtime.chargesLeft !== 0 && t >= this.runtime.cooldownUntil;
  }

  status(t: number): { ready: boolean; cooldownLeftS: number; chargesLeft: number | null; activeLeftS: number } {
    return {
      ready: this.ready(t),
      cooldownLeftS: Math.max(0, this.runtime.cooldownUntil - t),
      chargesLeft: this.runtime.chargesLeft,
      activeLeftS: Math.max(0, this.runtime.activeUntil - t),
    };
  }

  /** Rescue readiness (GDD 6): a charge left and ≥ readyAtCooldownFraction of the cooldown elapsed. */
  rescueReady(t: number): boolean {
    if (this.runtime.chargesLeft === 0) return false;
    const early = (1 - STAGE_TUNING.rescue.readyAtCooldownFraction) * this.def.cooldownS;
    return t >= this.runtime.cooldownUntil - early;
  }

  private spend(t: number): void {
    if (this.runtime.chargesLeft !== null) this.runtime.chargesLeft = Math.max(0, this.runtime.chargesLeft - 1);
    this.runtime.cooldownUntil = t + this.def.cooldownS;
    this.runtime.lastActivatedAt = t;
    this.used++;
  }

  /** A rescue consumes a use exactly like a Q press and returns the Pokémon's rescue data. */
  consumeForRescue(t: number): PokemonAbilityDef['rescue'] {
    this.spend(t);
    return this.def.rescue;
  }

  /** Q pressed while playing. Pushes ability_used / ability_denied. */
  tryActivate(ctx: AbilityContext): boolean {
    const { t, boat, hyde, events } = ctx;
    if (this.runtime.chargesLeft === 0) {
      events.push({ type: 'ability_denied', reason: 'no_charges', t });
      return false;
    }
    if (t < this.runtime.cooldownUntil) {
      events.push({ type: 'ability_denied', reason: 'cooldown', t });
      return false;
    }
    const targetsHyde = this.specialty === 'hyde_distraction' || this.specialty === 'pursuit_slow';
    if (targetsHyde && !hyde.hunting) {
      events.push({ type: 'ability_denied', reason: 'not_applicable', t });
      return false;
    }
    this.spend(t);
    const mag = this.def.magnitude;
    const until = t + this.def.durationS;
    this.runtime.activeUntil = until;
    this.effectLive = true;
    switch (this.specialty) {
      case 'speed_boost':
        boat.speed += mag;
        break;
      case 'shield':
        this.shieldHitsLeft = mag;
        break;
      case 'hyde_distraction': {
        const h = hyde.state;
        const side = (this.decoySide = -this.decoySide);
        const decoy = { x: h.x + Math.cos(h.heading) * HYDE.distractDecoyU * side, z: h.z - Math.sin(h.heading) * HYDE.distractDecoyU * side };
        hyde.distract(mag, until, decoy, t, events);
        break;
      }
      case 'pursuit_slow':
        hyde.slow(mag, until);
        break;
      case 'stamina_restore':
        boat.stamina = Math.min(boat.maxStamina, boat.stamina + mag);
        break;
      case 'fog_clear': {
        this.flare = { x: boat.x, z: boat.z, r: mag };
        const stunS = this.passive('flare_stuns_hyde_s');
        if (stunS !== null && hyde.hunting && hyde.gap <= mag / 2) hyde.stun(stunS, t, events);
        break;
      }
      case 'obstacle_detection':
      case 'egg_sense':
      case 'egg_protection':
      case 'current_ride':
        break; // duration effects, queried below
    }
    events.push({ type: 'ability_used', pokemonId: this.def.id, specialty: this.specialty, t });
    return true;
  }

  /** Emits ability_end once the active effect expires (or a shield runs out of hits). */
  update(t: number, events: ActionEvent[]): void {
    if (this.effectLive && t >= this.runtime.activeUntil) {
      this.effectLive = false;
      this.shieldHitsLeft = 0;
      this.flare = null;
      events.push({ type: 'ability_end', pokemonId: this.def.id, t });
    }
  }

  // ------------------------------------------------------------------------------------------- queries

  topSpeedBonus(t: number, hydeGap: number, hydeHunting: boolean): number {
    let bonus = this.activeAs(t, 'speed_boost') ? this.def.magnitude : 0;
    const lead = this.passive('lead_top_speed_bonus');
    if (lead !== null && hydeHunting && hydeGap >= LEAD_BONUS_GAP_U) bonus += lead;
    return bonus;
  }

  strokeCostMult(t: number): number {
    if (this.activeAs(t, 'stamina_restore')) return 0;
    const boostCost = this.passive('boost_stroke_cost_mult');
    if (boostCost !== null && this.activeAs(t, 'speed_boost')) return boostCost;
    return 1;
  }

  /** Passive multiplier on current push (always on). */
  currentPushMult(): number {
    return this.passive('current_push_mult') ?? 1;
  }

  /** current_ride: re-aims the current along the heading × mag; outside currents adds a +mag u/s push. */
  ridePush(t: number, push: Vec2, heading: number): Vec2 {
    if (!this.activeAs(t, 'current_ride')) return push;
    const fx = -Math.sin(heading);
    const fz = -Math.cos(heading);
    const strength = Math.hypot(push.x, push.z);
    const along = strength > 0.05 ? strength * this.def.magnitude : this.def.magnitude;
    return { x: fx * along, z: fz * along };
  }

  /** Kinds the hull passes through untouched (e.g. a shadowy hull slipping through sunken branches). */
  ignoredKinds(): ReadonlySet<ObstacleKind> {
    return this.passive('phase_sunken_branches') !== null ? new Set<ObstacleKind>(['branch']) : new Set<ObstacleKind>();
  }

  /** Hazards are revealed while a detection/sense/flare effect is up. */
  revealing(t: number): boolean {
    return this.activeAs(t, 'obstacle_detection') || this.activeAs(t, 'egg_sense') || this.activeAs(t, 'fog_clear');
  }

  /** Fresh impact. Consumes shield hits only for hits that would actually damage. */
  impact(t: number, kind: ObstacleKind | 'land', canDamage: boolean, hyde: HydeAI): AbilityImpact {
    const out: AbilityImpact = { cut: false, absorbed: false, braced: false, hullMult: 1 };
    if (kind !== 'land' && CUTTABLE.has(kind) && this.passive('boost_cuts_debris') !== null && this.activeAs(t, 'speed_boost')) {
      out.cut = true;
      return out;
    }
    if (canDamage && this.activeAs(t, 'shield') && this.shieldHitsLeft > 0) {
      out.absorbed = true;
      this.shieldHitsLeft--;
      if (this.shieldHitsLeft <= 0) this.runtime.activeUntil = t; // ability_end on the next update
    }
    const outline = this.passive('hazard_outline_range_u');
    out.braced = this.revealing(t) || (outline !== null && kind === 'branch');
    out.hullMult = this.hullDamageMult(t);
    const rootS = this.passive('collision_roots_hyde_s');
    if (canDamage && rootS !== null && hyde.hunting) hyde.slow(ROOT_SPEED_MULT, t + rootS);
    return out;
  }

  /** egg_protection: hull damage multiplier (collisions and the Hyde's catch). */
  hullDamageMult(t: number): number {
    return this.activeAs(t, 'egg_protection') ? Math.max(0, 1 - this.def.magnitude * STAGE_TUNING.abilities.eggProtectHullFactor) : 1;
  }

  /** An active shield with the grab-blocking passive repels the Hyde: knockback in u, or null. */
  grabBlockU(t: number): number | null {
    const u = this.passive('shield_blocks_hyde_knockback_u');
    return u !== null && this.activeAs(t, 'shield') ? u : null;
  }

  hydeSpeedMult(t: number, inFog: boolean): number {
    let m = 1;
    const fog = this.passive('fog_hyde_speed_mult');
    if (fog !== null && inFog) m *= fog;
    const curse = this.passive('curse_on_catch_hyde_speed_mult');
    if (curse !== null && t < this.curseUntil) m *= curse;
    return m;
  }

  surgeBoostMult(): number {
    return this.passive('surge_closing_mult') ?? 1;
  }

  catchRadiusMult(): number {
    return this.passive('hyde_catch_radius_mult') ?? 1;
  }

  /** Called after every catch (counted or not). */
  onCatch(t: number): void {
    if (this.passive('curse_on_catch_hyde_speed_mult') !== null) this.curseUntil = t + RUN.corsolaCurseS;
  }

  curseActive(t: number): boolean {
    return t < this.curseUntil;
  }

  fogCleared(t: number, x: number, z: number): boolean {
    return !!this.flare && this.activeAs(t, 'fog_clear') && Math.hypot(x - this.flare.x, z - this.flare.z) <= this.flare.r;
  }

  effects(t: number, hyde: HydeAI, inCurrentShielded: boolean, boatX: number, boatZ: number): AbilityEffects {
    const h = hyde.state;
    return {
      shield: this.activeAs(t, 'shield') && this.shieldHitsLeft > 0,
      speedBoost: this.activeAs(t, 'speed_boost') || this.activeAs(t, 'current_ride'),
      hydeSlowed: t < h.slowedUntil,
      hydeDistracted: h.phase === 'distracted',
      decoy: h.phase === 'distracted' ? h.decoy : null,
      fogCleared: this.fogCleared(t, boatX, boatZ),
      obstaclesRevealed: this.revealing(t),
      currentShield: inCurrentShielded,
      anchored: this.activeAs(t, 'egg_protection'),
      staminaSurge: this.activeAs(t, 'stamina_restore'),
    };
  }

  /** Radius around the boat in which hazards are revealed right now (0 = none); for the renderer. */
  revealRadius(t: number): number {
    if (this.activeAs(t, 'obstacle_detection')) return this.def.magnitude;
    if (this.activeAs(t, 'egg_sense')) return this.def.magnitude * STAGE_TUNING.abilities.eggSenseWaterRadiusMult;
    if (this.activeAs(t, 'fog_clear')) return this.def.magnitude;
    return this.passive('hazard_outline_range_u') ?? 0;
  }
}
