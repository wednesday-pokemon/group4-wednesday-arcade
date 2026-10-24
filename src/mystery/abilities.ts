// ONE interpreter for every F power and Q move: it switches on `AbilityEffect.kind`, never on character / Pokémon ids.
// Activation: on cooldown → `ability_denied {cooldown}`; if no effect could apply (e.g. stun with the Hyde out of
// range / sight / cone) → `ability_denied {no_target}` and the cooldown is NOT spent; otherwise the cooldown starts,
// `ability_used` reports success (= every effect applied) with a human-readable detail, and the activation noise
// (`AbilityDef.noise`) is emitted at the player like any other sound.
//
// Kind semantics (parameter conventions agreed with src/mystery/data/nightshades.ts). Durations of effects on the Hyde
// are × hydeEffectDurationMult; every duration is capped at abilities.maxEffectDurationS; a stun starting within
// stunDiminishWindowS of the previous stun's end lasts × stunDiminishMult; slows never go below minHydeSpeedMult.
//   reveal_clues   the nearest `magnitude` (0 = all) uncollected clues within rangeM (0 = anywhere) highlighted for
//                  durationS (+ a resting / dropped egg in range). With visual 'scent_trail' it is drawn as a scent
//                  trail instead (nav path to the nearest such clue, else the egg / tower). Overhaul: a reveal is an
//                  exact observation for the investigation state (investigation.ts InvestigationTracker.revealed): the
//                  revealed clue's site becomes known, nearer candidate sites of other clues are checked empty, and a
//                  reveal with a range that does not light the resting egg checks the egg sites within that range.
//   premonition    the Hyde's predicted path for the next `magnitude` s (from its current plan), shown for durationS;
//                  needs the Hyde within rangeM (0 = anywhere)
//   speed_boost    movement × (1 + magnitude), footsteps × noiseMult, for durationS
//   lure           decoy at the aimed point ≤ rangeM ahead (stops short of walls); the Hyde goes there, ignoring the
//                  player, for durationS (breaks a chase), then searches the player's last known spot; a `decoy`
//                  noise of loudness magnitude (0 → abilities.defaultLureLoudness) is emitted at the point
//   distract       Hyde within rangeM (+ LOS if needsLineOfSight): no hearing, sight × 0.3, no grabs, for durationS
//   stun           Hyde within rangeM (+ line of sight if needsLineOfSight, + facing cone if coneDeg) frozen,
//                  interrupting a grab windup; visual 'petrify' | 'pin' (stun or slow) sets ActiveEffects.hydePetrified
//   slow           same targeting as stun; Hyde speed × (1 − magnitude) for durationS
//   block_grab     the next grab within durationS deals no HP / egg damage (the catch still counts)
//   egg_shield     egg security loss × (1 − magnitude) for durationS
//   dash           instant move of `magnitude` m along the facing direction, swept against walls (never through)
//   reveal_hazards walls / cover / hiding spots within rangeM outlined for durationS
//   power_switch   within rangeM of the map's power switch: opens its gate wall for openS (0 = permanently) and SKIPS
//                  the next effect; otherwise the next effect applies (if it is the last effect: a stun with its own
//                  duration / range / line-of-sight rules)
//   healHp         restores HP (capped at max) when the effect it is attached to lands.
//
// Two enemies (docs/overhaul/ENEMY_CONTRACT.md R8) — still effect-kind based, never id based:
//   stun / slow / distract / power_switch fallback stun apply to EVERY enemy passing the effect's targeting (range, line
//   of sight, facing cone): the Hyde first, then Joseph Crackstone when the map has him. Diminishing stuns are tracked
//   per enemy. `no_target` only when no enemy qualifies. The detail names who was hit ("Hyde stunned 3.0 s",
//   "Crackstone petrified 2.5 s", "Hyde and Crackstone stunned 3.0 s"); with only the Hyde on the map every detail
//   string is exactly the single-enemy text.
//   lure           the Hyde as above; Crackstone too when he is within crackstone.lureRangeM of the decoy point.
//   premonition    the predicted path of every active enemy within rangeM (Crackstone's: effects().crackstonePremonitionPath).
//   reveal_clues   without the scent visual it also reveals every enemy within rangeM (0 = anywhere) for durationS
//                  (effects().enemiesRevealed / enemyRevealRangeM; the detail text is unchanged).
//   block_grab     the next grab OR curse deals no damage (consumed by whichever lands first).
import type { SimContext } from './context.ts';
import type { CrackstoneBrain } from './crackstone.ts';
import { forward, wrapAngle, yawTo } from './geometry.ts';
import type { HydeBrain } from './hyde.ts';
import type { AbilityDef, AbilityEffect, AbilityEffectKind, AbilityStatus, Vec2 } from './types.ts';

export interface AbilitySlot {
  def: AbilityDef;
  readyAt: number;
  activeUntil: number;
  uses: number;
}

export function createSlot(def: AbilityDef): AbilitySlot {
  return { def, readyAt: 0, activeUntil: -Infinity, uses: 0 };
}

export function resetSlot(slot: AbilitySlot): void {
  slot.readyAt = 0;
  slot.activeUntil = -Infinity;
}

export function slotStatus(slot: AbilitySlot, t: number): AbilityStatus {
  return {
    ready: t >= slot.readyAt,
    cooldownLeftS: Math.max(0, round1(slot.readyAt - t)),
    activeLeftS: Math.max(0, round1(slot.activeUntil - t)),
  };
}

interface EffectOutcome { applied: boolean; detail: string }

type Targeting = Pick<AbilityEffect, 'rangeM' | 'needsLineOfSight' | 'coneDeg'>;

/** How an enemy is named in ability details / reasons. */
export interface EnemyNames { label: string; the: string; inactive: string }
export const HYDE_NAMES: EnemyNames = { label: 'Hyde', the: 'the Hyde', inactive: 'the Hyde is not hunting yet' };
export const CRACKSTONE_NAMES: EnemyNames = { label: 'Crackstone', the: 'Crackstone', inactive: 'Crackstone is not here yet' };

/** Is an enemy (active flag + position) a valid target for a targeted effect (range, line of sight, facing cone)? */
export function enemyTargetable(ctx: SimContext, enemy: { active: boolean; x: number; z: number }, names: EnemyNames, e: Targeting): { ok: boolean; why: string } {
  if (!enemy.active) return { ok: false, why: names.inactive };
  const p = ctx.player;
  const d = Math.hypot(enemy.x - p.x, enemy.z - p.z);
  if (e.rangeM > 0 && d > e.rangeM) return { ok: false, why: `${names.label} out of range (${d.toFixed(1)} m > ${e.rangeM} m)` };
  if (e.needsLineOfSight && !ctx.world.lineOfSight(p.x, p.z, enemy.x, enemy.z)) return { ok: false, why: `no line of sight to ${names.the}` };
  if (e.coneDeg && e.coneDeg > 0 && d > 0.3) {
    const off = Math.abs(wrapAngle(yawTo(p.x, p.z, enemy.x, enemy.z) - p.yaw));
    if (off > (e.coneDeg * Math.PI) / 360) return { ok: false, why: `${names.the} is not in front of you` };
  }
  return { ok: true, why: `${d.toFixed(1)} m` };
}

/** Is the Hyde a valid target for a targeted effect (range, line of sight, facing cone)? */
export function hydeTargetable(ctx: SimContext, hyde: HydeBrain, e: Targeting): { ok: boolean; why: string } {
  return enemyTargetable(ctx, { active: hyde.active, x: hyde.h.x, z: hyde.h.z }, HYDE_NAMES, e);
}

/** Is Joseph Crackstone a valid target for a targeted effect (same rules as the Hyde)? */
export function crackstoneTargetable(ctx: SimContext, crackstone: CrackstoneBrain, e: Targeting): { ok: boolean; why: string } {
  return enemyTargetable(ctx, { active: crackstone.active, x: crackstone.c.x, z: crackstone.c.z }, CRACKSTONE_NAMES, e);
}

/** One enemy as the interpreter sees it (effect kinds only — no ids). */
interface EnemyHandle {
  names: EnemyNames;
  active: boolean;
  x: number;
  z: number;
  lastStunEnd: number;
  slowMult(): number;
  stun(ctx: SimContext, d: number): void;
  slow(ctx: SimContext, d: number, mult: number): void;
  distract(ctx: SimContext, d: number): void;
  setVisual(ctx: SimContext, visual: 'petrify' | 'pin', until: number): void;
}

/** "Hyde stunned 3.0 s" / "Hyde and Crackstone stunned 3.0 s" / "Hyde stunned 1.5 s (diminished), Crackstone stunned 3.0 s". */
function joinHits(hits: { label: string; part: string }[]): string {
  if (hits.every((h) => h.part === hits[0].part)) return `${hits.map((h) => h.label).join(' and ')} ${hits[0].part}`;
  return hits.map((h) => `${h.label} ${h.part}`).join(', ');
}

export class AbilityInterpreter {
  constructor(private readonly hyde: HydeBrain, private readonly crackstone: CrackstoneBrain | null = null) {}

  /** The enemies on this map, Hyde first. */
  private enemies(): EnemyHandle[] {
    const hy = this.hyde;
    const out: EnemyHandle[] = [{
      names: HYDE_NAMES, active: hy.active, x: hy.h.x, z: hy.h.z, lastStunEnd: hy.lastStunEnd, slowMult: () => hy.h.slowMult,
      stun: (ctx, d) => hy.stun(ctx, d), slow: (ctx, d, m) => hy.slow(ctx, d, m), distract: (ctx, d) => hy.distract(ctx, d),
      setVisual: (ctx, v, until) => {
        ctx.fx.hydeVisual = v;
        ctx.fx.hydeVisualUntil = Math.max(ctx.fx.hydeVisualUntil, until);
      },
    }];
    const cs = this.crackstone;
    if (cs) {
      out.push({
        names: CRACKSTONE_NAMES, active: cs.active, x: cs.c.x, z: cs.c.z, lastStunEnd: cs.lastStunEnd, slowMult: () => cs.c.slowMult,
        stun: (ctx, d) => cs.stun(ctx, d), slow: (ctx, d, m) => cs.slow(ctx, d, m), distract: (ctx, d) => cs.distract(ctx, d),
        setVisual: (ctx, v, until) => {
          ctx.fx.crackstoneVisual = v;
          ctx.fx.crackstoneVisualUntil = Math.max(ctx.fx.crackstoneVisualUntil, until);
        },
      });
    }
    return out;
  }

  /** Enemies passing a targeted effect's targeting, plus the reasons of those that did not. */
  private targets(ctx: SimContext, e: Targeting): { hit: EnemyHandle[]; why: string } {
    const hit: EnemyHandle[] = [];
    const whys: string[] = [];
    for (const en of this.enemies()) {
      const tg = enemyTargetable(ctx, en, en.names, e);
      if (tg.ok) hit.push(en);
      else whys.push(tg.why);
    }
    return { hit, why: whys.join('; ') };
  }

  /** Handles an F or Q press for `slot`. Emits ability_used / ability_denied (+ noise) through ctx. */
  activate(ctx: SimContext, slot: AbilitySlot, key: 'F' | 'Q'): boolean {
    const def = slot.def;
    if (ctx.t < slot.readyAt) {
      ctx.emit({ type: 'ability_denied', key, reason: 'cooldown' });
      return false;
    }
    const kinds: AbilityEffectKind[] = def.effects.map((e) => e.kind);
    const outcomes: EffectOutcome[] = [];
    for (let i = 0; i < def.effects.length; i++) {
      const e = def.effects[i];
      if (e.kind === 'power_switch') {
        const hasNext = i + 1 < def.effects.length;
        const o = this.powerSwitch(ctx, e, !hasNext);
        if (o.applied && hasNext) {
          outcomes.push(o);
          i++; // the switch was powered: skip the fallback effect
          continue;
        }
        if (!o.applied && hasNext) continue; // not in reach: the next effect is the fallback
        outcomes.push(o);
        continue;
      }
      outcomes.push(this.apply(ctx, e));
    }
    if (!outcomes.some((o) => o.applied)) {
      ctx.emit({ type: 'ability_denied', key, reason: 'no_target' });
      return false;
    }
    slot.readyAt = ctx.t + def.cooldownS;
    slot.activeUntil = ctx.t + Math.max(0, ...def.effects.map((e) => this.duration(ctx, e)));
    slot.uses++;
    ctx.fx.last = { key, abilityId: def.id, kinds, t: ctx.t };
    ctx.emit({
      type: 'ability_used', key, abilityId: def.id, kinds, success: outcomes.every((o) => o.applied),
      detail: outcomes.map((o) => o.detail).join('; '),
    });
    if (def.noise > 0) ctx.noise('ability', ctx.player.x, ctx.player.z, def.noise);
    return true;
  }

  /** Duration after hydeEffectDurationMult (Hyde-targeted kinds) and the global cap. */
  duration(ctx: SimContext, e: AbilityEffect): number {
    const cap = ctx.tuning.abilities.maxEffectDurationS;
    switch (e.kind) {
      case 'stun':
      case 'slow':
      case 'distract':
      case 'power_switch':
        return Math.min(cap, e.durationS * ctx.mods.hydeEffectDurationMult);
      default:
        return Math.min(cap, e.durationS);
    }
  }

  private apply(ctx: SimContext, e: AbilityEffect): EffectOutcome {
    const out = this.applyKind(ctx, e);
    if (out.applied && e.healHp && e.healHp > 0) {
      const p = ctx.player;
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + e.healHp);
      out.detail += `; healed ${Math.round((p.hp - before) * 10) / 10} HP`;
    }
    return out;
  }

  private applyKind(ctx: SimContext, e: AbilityEffect): EffectOutcome {
    const t = ctx.t;
    const fx = ctx.fx;
    const p = ctx.player;
    const dur = this.duration(ctx, e);
    switch (e.kind) {
      case 'reveal_clues': {
        const inRange = ctx.map.clues
          .filter((c) => !ctx.cluesFound.includes(c.clueId))
          .map((c) => ({ id: c.clueId, d: Math.hypot(c.x - p.x, c.z - p.z) }))
          .filter((c) => e.rangeM <= 0 || c.d <= e.rangeM)
          .sort((a, b) => a.d - b.d);
        const picked = (e.magnitude >= 1 ? inRange.slice(0, Math.floor(e.magnitude)) : inRange).map((c) => c.id);
        ctx.inv.revealed(ctx, picked, e.rangeM, e.magnitude >= 1 ? Math.floor(e.magnitude) : 0);
        if (e.visual !== 'scent_trail' && ctx.egg.state === 'resting') {
          const eggD = Math.hypot(ctx.egg.x - p.x, ctx.egg.z - p.z);
          if (e.rangeM <= 0 || eggD <= e.rangeM) ctx.inv.eggSeen(ctx);
          else ctx.inv.eggNotRevealed(ctx, e.rangeM);
        }
        if (e.visual === 'scent_trail') {
          fx.scentUntil = Math.max(fx.scentUntil, t + dur);
          fx.scentClues = picked;
          return { applied: true, detail: picked.length ? 'scent trail to the nearest clue' : 'scent trail to the next objective' };
        }
        fx.revealCluesUntil = Math.max(fx.revealCluesUntil, t + dur);
        fx.revealCluesRangeM = e.rangeM;
        // supernatural scouting (R8): every enemy within rangeM is shown for the duration
        fx.enemyRevealUntil = Math.max(fx.enemyRevealUntil, t + dur);
        fx.enemyRevealRangeM = e.rangeM;
        fx.revealedClues = picked;
        return { applied: true, detail: picked.length > 0 ? `${picked.length} piece(s) of evidence revealed` : 'no missing evidence within range' };
      }
      case 'premonition': {
        const seen: string[] = [];
        const whys: string[] = [];
        for (const en of this.enemies()) {
          if (!en.active) {
            whys.push(en.names.inactive);
            continue;
          }
          const d = Math.hypot(en.x - p.x, en.z - p.z);
          if (e.rangeM > 0 && d > e.rangeM) {
            whys.push(`${en.names.label} too far to foresee (${d.toFixed(1)} m > ${e.rangeM} m)`);
            continue;
          }
          if (en.names === HYDE_NAMES) fx.premonitionUntil = Math.max(fx.premonitionUntil, t + dur);
          else fx.crackstonePremonitionUntil = Math.max(fx.crackstonePremonitionUntil, t + dur);
          seen.push(en.names.label);
        }
        if (seen.length === 0) return { applied: false, detail: whys.join('; ') };
        fx.premonitionAheadS = e.magnitude;
        return { applied: true, detail: `${seen.join(' and ')} ${seen.length > 1 ? 'paths' : 'path'} foreseen ${e.magnitude} s ahead` };
      }
      case 'speed_boost': {
        fx.speedBoostUntil = Math.max(fx.speedBoostUntil, t + dur);
        fx.speedBoostMult = 1 + e.magnitude;
        fx.speedBoostNoiseMult = e.noiseMult ?? 1;
        return { applied: true, detail: `speed +${Math.round(e.magnitude * 100)}% for ${dur} s` };
      }
      case 'lure': {
        const cs = this.crackstone;
        if (!this.hyde.active && !cs?.active) return { applied: false, detail: 'the Hyde is not hunting yet' };
        const point = this.aimPoint(ctx, e.rangeM);
        const lured: string[] = [];
        const whys: string[] = [];
        if (!this.hyde.active) whys.push(HYDE_NAMES.inactive);
        else if (this.hyde.lure(ctx, point, dur)) lured.push(HYDE_NAMES.label);
        else whys.push('the Hyde ignores decoys while chasing');
        if (cs) {
          const dc = Math.hypot(point.x - cs.c.x, point.z - cs.c.z);
          if (!cs.active) whys.push(CRACKSTONE_NAMES.inactive);
          else if (cs.lure(ctx, point, dur)) lured.push(CRACKSTONE_NAMES.label);
          else whys.push(`Crackstone too far from the decoy (${dc.toFixed(1)} m > ${cs.cfg.lureRangeM} m)`);
        }
        if (lured.length === 0) return { applied: false, detail: whys.join('; ') };
        fx.lurePoint = point;
        fx.lureUntil = t + dur;
        ctx.noise('decoy', point.x, point.z, e.magnitude > 0 ? Math.min(1, e.magnitude) : ctx.tuning.abilities.defaultLureLoudness);
        return { applied: true, detail: `${lured.join(' and ')} lured ${Math.hypot(point.x - p.x, point.z - p.z).toFixed(1)} m ahead for ${dur} s` };
      }
      case 'distract': {
        const tg = this.targets(ctx, e);
        if (tg.hit.length === 0) return { applied: false, detail: tg.why };
        for (const en of tg.hit) en.distract(ctx, dur);
        return { applied: true, detail: joinHits(tg.hit.map((en) => ({ label: en.names.label, part: `distracted ${dur.toFixed(1)} s` }))) };
      }
      case 'stun':
        return this.stun(ctx, e, dur);
      case 'slow': {
        const tg = this.targets(ctx, e);
        if (tg.hit.length === 0) return { applied: false, detail: tg.why };
        const hits = tg.hit.map((en) => {
          en.slow(ctx, dur, 1 - e.magnitude);
          this.markVisual(ctx, e, dur, en);
          return { label: en.names.label, part: `slowed to ${Math.round(en.slowMult() * 100)}% speed for ${dur.toFixed(1)} s` };
        });
        return { applied: true, detail: joinHits(hits) };
      }
      case 'block_grab': {
        fx.blockGrabUntil = Math.max(fx.blockGrabUntil, t + dur);
        if (this.crackstone) return { applied: true, detail: `next grab or curse blocked for ${dur} s (a grab's catch still counts)` };
        return { applied: true, detail: `next grab blocked for ${dur} s (the catch still counts)` };
      }
      case 'egg_shield': {
        fx.eggShieldUntil = Math.max(fx.eggShieldUntil, t + dur);
        fx.eggShieldMag = Math.max(0, Math.min(1, e.magnitude));
        return { applied: true, detail: `egg security loss −${Math.round(e.magnitude * 100)}% for ${dur} s` };
      }
      case 'dash': {
        const f = forward(p.yaw);
        const r = ctx.world.move(p.x, p.z, f.x * e.magnitude, f.z * e.magnitude, ctx.tuning.player.radius);
        const moved = Math.hypot(r.x - p.x, r.z - p.z);
        p.x = r.x;
        p.z = r.z;
        if (ctx.egg.state === 'carried') {
          ctx.egg.x = p.x;
          ctx.egg.z = p.z;
        }
        return { applied: true, detail: `dashed ${moved.toFixed(1)} m` };
      }
      case 'reveal_hazards': {
        fx.revealHazardsUntil = Math.max(fx.revealHazardsUntil, t + dur);
        fx.revealHazardsRangeM = e.rangeM;
        return { applied: true, detail: `hazards and hiding spots outlined for ${dur} s` };
      }
      case 'power_switch':
        return this.powerSwitch(ctx, e, true);
    }
  }

  /** Powers the gate switch if in reach; else (when `fallbackStun`) stuns with this effect's parameters. */
  private powerSwitch(ctx: SimContext, e: AbilityEffect, fallbackStun: boolean): EffectOutcome {
    const sw = ctx.map.powerSwitch;
    const p = ctx.player;
    const reach = Math.max(e.rangeM, ctx.tuning.player.interactRangeM);
    if (sw && Math.hypot(sw.x - p.x, sw.z - p.z) <= reach) {
      ctx.fx.switchPoweredUntil = sw.openS > 0 ? ctx.t + sw.openS : Infinity;
      ctx.world.setWallOpen(sw.gateWallId, true);
      this.hyde.invalidatePath();
      this.crackstone?.invalidatePath();
      return { applied: true, detail: sw.openS > 0 ? `gate opened for ${sw.openS} s` : 'gate opened' };
    }
    if (!fallbackStun) return { applied: false, detail: 'no switch in reach' };
    const res = this.stun(ctx, e, this.duration(ctx, e));
    return { ...res, detail: `no switch in reach; ${res.detail}` };
  }

  private stun(ctx: SimContext, e: AbilityEffect, dur: number): EffectOutcome {
    const tg = this.targets(ctx, e);
    if (tg.hit.length === 0) return { applied: false, detail: tg.why };
    const A = ctx.tuning.abilities;
    const word = e.visual === 'petrify' ? 'petrified' : e.visual === 'pin' ? 'pinned' : 'stunned';
    const hits = tg.hit.map((en) => {
      let d = dur;
      const diminished = ctx.t - en.lastStunEnd < A.stunDiminishWindowS; // per enemy
      if (diminished) d *= A.stunDiminishMult;
      d = Math.min(A.maxEffectDurationS, d);
      en.stun(ctx, d);
      this.markVisual(ctx, e, d, en);
      return { label: en.names.label, part: `${word} ${d.toFixed(1)} s${diminished ? ' (diminished)' : ''}` };
    });
    return { applied: true, detail: joinHits(hits) };
  }

  private markVisual(ctx: SimContext, e: AbilityEffect, d: number, en: EnemyHandle): void {
    if (e.visual !== 'petrify' && e.visual !== 'pin') return;
    en.setVisual(ctx, e.visual, ctx.t + d);
  }

  /** Point up to `rangeM` along the facing direction, stopping short of walls, snapped to the Hyde's nav grid. */
  aimPoint(ctx: SimContext, rangeM: number): Vec2 {
    const p = ctx.player;
    const f = forward(p.yaw);
    const free = ctx.world.rayFree(p.x, p.z, f.x, f.z, Math.max(0.5, rangeM), ctx.tuning.player.radius);
    const raw = { x: p.x + f.x * free, z: p.z + f.z * free };
    const nav = ctx.hydeNav();
    const comp = nav.componentAt(this.hyde.h, 3);
    return nav.nearestWalkable(raw, 6, comp) ?? nav.nearestWalkable(raw, 6) ?? raw;
  }
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
