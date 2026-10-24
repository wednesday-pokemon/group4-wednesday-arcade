// Encounter director (docs/final/FINAL_CONTRACT.md §4): spawns, despawns and respawns the Hyde, Joseph Crackstone and
// Slurp. Lifecycle per enemy: inactive → (first appearance) active → despawned → cooldown → respawn → active …
//
// Spawn choice — EXACT, the analytics show exactly `encounterSpawnDistribution` (pure, below):
//   eligible   distance from the player ≥ director.minSpawnM, AND not visible to the player: no line of sight within
//              sight.playerSeesHydeM, and outside the player's ±viewHalfDeg (60°) forward cone within viewRangeM (35 m)
//              (the cone rule holds even behind a wall — never "just round the corner in front of you").
//   weight     w′ = w × objectiveMult (1.5) when the spawn's zone contains the active objective's point (public: the tower
//              while carrying, the dropped egg, the egg's seen site, a known site of a missing clue; none → no boost)
//              × recentMult (0.3) when that spawn was used within recentSpawnS. P = w′ / Σ w′ over the eligible spawns.
//   draw       one value of the director's own Rng(seed, 'director') against the cumulative w′ (spawn order).
//   none       eligible → retry after retryS (2 s); a spawn is never forced.
// Schedule: first appearance at firstSpawnS[enemy] (the Hyde's = tuning.hyde.emergeAfterS); after a despawn, no respawn
// before respawnCooldownS[enemy]. Caps: ≤ maxActive (2) hostiles active; no spawn while any enemy is engaged (CHASE /
// ATTACK) — the brains themselves keep ≤ 1 engaged at a time (Hyde priority, others defer; see run.ts enemyEngaged).
// When a slot frees, the enemy that has been due longest spawns first.
// Despawn (only when): calm (not chasing / attacking / investigating the player), ≥ despawnM from the player, no line of
// sight between them for ≥ noLosBeforeDespawnS (4 s), alive ≥ minLifeS (10 s, hysteresis), and one of: its encounter
// resolved (it hunted and has calmed down, or Slurp is LEAVING) → 'encounter_resolved'; its patrol / wander cycle done →
// 'cycle_done'; alive ≥ minActiveS → 'far'. A despawn never touches HP, catches, the player's cooldowns or the log; the
// enemy's own stun / slow / distract timers are dropped.
// Spawn fallbacks when CaseWorldDef.encounterSpawns has none for an enemy: the Hyde → world.hydeSpawns, Crackstone → his
// def.start, Slurp → his wander waypoints (weight 1 each).
// Legacy mode (worlds WITHOUT encounterSpawns — fixtures): the run keeps the old one-shot Hyde emergence (PRF
// 'hyde:spawn') and Crackstone from t = 0; the director then only manages Slurp (if any) and never despawns.
import type { DirectorTuning } from './config.ts';
import type { SimContext } from './context.ts';
import { pointInPolygon, wrapAngle, yawTo } from './geometry.ts';
import { pickCumulative } from './layout.ts';
import type { Rng } from './rng.ts';
import type { CaseWorldDef, EncounterSpawnDef, EnemyId, Vec2 } from './types.ts';

/** The spawn rules the distribution needs (resolved from SimTuning by `spawnRulesFrom`). */
export interface SpawnRules {
  minSpawnM: number;
  recentSpawnS: number;
  recentMult: number;
  objectiveMult: number;
  /** The player sees an enemy with line of sight within this distance (sight.playerSeesHydeM). */
  playerSeesM: number;
  viewHalfDeg: number;
  viewRangeM: number;
}

/** Everything the spawn distribution depends on — PUBLIC information only (MysteryRun.directorState() builds it). */
export interface DirectorState {
  player: { x: number; z: number; yaw: number };
  t: number;
  /** The active objective's point (public), or null. */
  objective: Vec2 | null;
  /** Spawns used so far (spawnId, sim t of the spawn), any enemy. */
  recent: readonly { spawnId: string; t: number }[];
  /** Line of sight on the current map (walls + high cover, open gates respected). */
  lineOfSight(ax: number, az: number, bx: number, bz: number): boolean;
  rules: SpawnRules;
}

export type SpawnBlock = 'too_close' | 'visible' | 'in_view';

/** One spawn's exact probability right now (world order). */
export interface EncounterChance {
  spawnId: string;
  enemy: EnemyId;
  name: string;
  zoneId: string;
  x: number;
  z: number;
  /** w′ (0 when not eligible). */
  weight: number;
  p: number;
  eligible: boolean;
  blocked: SpawnBlock | null;
}

export function spawnRulesFrom(d: DirectorTuning, playerSeesM: number): SpawnRules {
  return {
    minSpawnM: d.minSpawnM, recentSpawnS: d.recentSpawnS, recentMult: d.recentMult, objectiveMult: d.objectiveMult, playerSeesM,
    viewHalfDeg: d.viewHalfDeg, viewRangeM: d.viewRangeM,
  };
}

function zoneAt(world: CaseWorldDef, p: Vec2): string {
  return world.zones.find((z) => pointInPolygon(p.x, p.z, z.polygon))?.id ?? '';
}

/** The spawn points of one enemy (encounterSpawns, else the documented fallbacks). */
export function encounterSpawnsFor(world: CaseWorldDef, enemy: EnemyId): EncounterSpawnDef[] {
  const own = (world.encounterSpawns ?? []).filter((s) => s.enemy === enemy);
  if (own.length > 0) return own;
  if (enemy === 'hyde') return world.hydeSpawns.map((s) => ({ ...s, enemy: 'hyde' as const }));
  if (enemy === 'crackstone') {
    const c = world.crackstone;
    return c ? [{ id: 'crackstone_start', enemy, name: c.areaName, zoneId: zoneAt(world, c.start), x: c.start.x, z: c.start.z, yaw: c.start.yaw, weight: 1 }] : [];
  }
  const s = world.slurp;
  return s ? s.wander.map((w, i) => ({ id: `slurp_wander_${i}`, enemy, name: s.areaName, zoneId: zoneAt(world, w), x: w.x, z: w.z, yaw: 0, weight: 1 })) : [];
}

/** Why a spawn point is not eligible right now (null = eligible). */
export function spawnBlock(sp: Vec2, state: DirectorState): SpawnBlock | null {
  const p = state.player;
  const R = state.rules;
  const d = Math.hypot(sp.x - p.x, sp.z - p.z);
  if (d < R.minSpawnM) return 'too_close';
  if (d <= R.viewRangeM && d > 1e-6) {
    const off = Math.abs(wrapAngle(yawTo(p.x, p.z, sp.x, sp.z) - p.yaw));
    if (off <= (R.viewHalfDeg * Math.PI) / 180) return 'in_view';
  }
  if (d <= R.playerSeesM && state.lineOfSight(p.x, p.z, sp.x, sp.z)) return 'visible';
  return null;
}

/**
 * EXACT spawn distribution of `enemy` for the current state (all of its spawns, world order): eligible spawns get
 * w′ / Σ w′, the others 0 (with the reason). When none is eligible every p is 0 (the director waits). Pure.
 */
export function encounterSpawnDistribution(world: CaseWorldDef, enemy: EnemyId, state: DirectorState): EncounterChance[] {
  const R = state.rules;
  const spawns = encounterSpawnsFor(world, enemy);
  const zoneOf = new Map(world.zones.map((z) => [z.id, z]));
  const obj = state.objective;
  const rows = spawns.map((s) => {
    const blocked = spawnBlock(s, state);
    let w = blocked ? 0 : Math.max(0, s.weight);
    if (w > 0 && obj) {
      const z = zoneOf.get(s.zoneId);
      if (z && pointInPolygon(obj.x, obj.z, z.polygon)) w *= R.objectiveMult;
    }
    if (w > 0 && state.recent.some((r) => r.spawnId === s.id && state.t - r.t < R.recentSpawnS)) w *= R.recentMult;
    return { spawnId: s.id, enemy, name: s.name, zoneId: s.zoneId, x: s.x, z: s.z, weight: w, p: 0, eligible: blocked === null && w > 0, blocked };
  });
  const total = rows.reduce((a, r) => a + r.weight, 0);
  if (total > 0) for (const r of rows) r.p = r.weight / total;
  return rows;
}

/** Draws a spawn from the distribution with one uniform `u` ∈ [0, 1) (null when none is eligible). */
export function drawEncounterSpawn(world: CaseWorldDef, enemy: EnemyId, state: DirectorState, u: number): EncounterSpawnDef | null {
  const dist = encounterSpawnDistribution(world, enemy, state);
  if (!dist.some((r) => r.weight > 0)) return null;
  const i = pickCumulative(dist, (r) => r.weight, u);
  const id = dist[i]?.spawnId;
  return encounterSpawnsFor(world, enemy).find((s) => s.id === id) ?? null;
}

// ------------------------------------------------------------------------------------------------------- lifecycle

/** What the director needs from each enemy brain. */
export interface DirectedEnemy {
  readonly id: EnemyId;
  isActive(): boolean;
  position(): Vec2;
  /** CHASE / ATTACK (the player is being hunted). */
  engaged(): boolean;
  /** Not chasing, attacking or investigating the player (a despawn is safe). */
  calm(): boolean;
  cycleDone(): boolean;
  encounterResolved(): boolean;
  spawn(ctx: SimContext, at: { x: number; z: number; yaw: number }): Vec2;
  despawn(ctx: SimContext): void;
}

export type LifePhase = 'inactive' | 'active' | 'cooldown';

export interface EnemyLife {
  enemy: EnemyId;
  phase: LifePhase;
  /** The director owns this enemy's spawns / despawns (false = legacy: the run starts it once and never despawns it). */
  managed: boolean;
  spawnedAt: number | null;
  despawnedAt: number | null;
  /** Earliest next spawn attempt (first appearance, cooldown end, or a retry after "no eligible spawn"). */
  dueAt: number;
  spawnId: string | null;
  lastLosT: number;
  spawns: number;
  despawns: number;
}

/** Public lifecycle view (HUD / analytics). */
export interface EnemyLifeView {
  enemy: EnemyId;
  phase: LifePhase;
  managed: boolean;
  spawnId: string | null;
  spawnedAt: number | null;
  despawnedAt: number | null;
  /** Seconds until the next spawn attempt may happen (null while active / unmanaged). Attempts still need an eligible spawn and a free slot. */
  nextSpawnInS: number | null;
}

export interface DirectorHooks {
  /** Called right after an enemy spawned (the run emits hyde_emerged for the Hyde's first appearance). */
  onSpawn?(enemy: EnemyId, spawn: EncounterSpawnDef, at: Vec2, first: boolean): void;
}

export class EncounterDirector {
  readonly lives = new Map<EnemyId, EnemyLife>();
  readonly recent: { spawnId: string; t: number }[] = [];
  private readonly enemies = new Map<EnemyId, DirectedEnemy>();

  constructor(
    readonly world: CaseWorldDef | null,
    readonly cfg: DirectorTuning,
    private readonly rng: Rng,
    /** Dynamic = the world has encounterSpawns: the director owns every enemy. */
    readonly dynamic: boolean,
    private readonly hooks: DirectorHooks = {},
  ) {}

  /** Registers an enemy present on this map. `managed` false = legacy (the run starts it; never despawned). */
  add(enemy: DirectedEnemy, managed: boolean): void {
    this.enemies.set(enemy.id, enemy);
    this.lives.set(enemy.id, {
      enemy: enemy.id, phase: 'inactive', managed, spawnedAt: null, despawnedAt: null, dueAt: this.cfg.firstSpawnS[enemy.id],
      spawnId: null, lastLosT: -Infinity, spawns: 0, despawns: 0,
    });
  }

  has(enemy: EnemyId): boolean {
    return this.enemies.has(enemy);
  }

  life(enemy: EnemyId): EnemyLife | null {
    return this.lives.get(enemy) ?? null;
  }

  view(enemy: EnemyId, t: number): EnemyLifeView | null {
    const l = this.lives.get(enemy);
    if (!l) return null;
    return {
      enemy, phase: l.phase, managed: l.managed, spawnId: l.spawnId, spawnedAt: l.spawnedAt, despawnedAt: l.despawnedAt,
      nextSpawnInS: l.phase === 'active' || !l.managed ? null : Math.max(0, Math.round((l.dueAt - t) * 10) / 10),
    };
  }

  activeCount(): number {
    let n = 0;
    for (const e of this.enemies.values()) if (e.isActive()) n++;
    return n;
  }

  anyEngaged(): boolean {
    for (const e of this.enemies.values()) if (e.isActive() && e.engaged()) return true;
    return false;
  }

  /** Resets the schedule to t = 0 of play (endTutorial). */
  reset(): void {
    for (const l of this.lives.values()) {
      Object.assign(l, { phase: 'inactive', spawnedAt: null, despawnedAt: null, dueAt: this.cfg.firstSpawnS[l.enemy], spawnId: null, lastLosT: -Infinity, spawns: 0, despawns: 0 });
    }
    this.recent.length = 0;
  }

  /** Marks an enemy started outside the director (legacy start / emergence) as active. */
  markSpawned(enemy: EnemyId, spawnId: string, t: number): void {
    const l = this.lives.get(enemy);
    if (!l) return;
    l.phase = 'active';
    l.spawnedAt = t;
    l.spawnId = spawnId;
    l.spawns++;
    l.lastLosT = t;
    this.recent.push({ spawnId, t });
  }

  /** One fixed step (after the brains): despawns, then due spawns. `state` is only built when a spawn is due. */
  step(ctx: SimContext, state: () => DirectorState): void {
    const t = ctx.t;
    const p = ctx.player;
    // line-of-sight bookkeeping + despawns
    for (const [id, e] of this.enemies) {
      const l = this.lives.get(id)!;
      if (!e.isActive()) continue;
      const at = e.position();
      if (ctx.world.lineOfSight(p.x, p.z, at.x, at.z)) l.lastLosT = t;
      if (!this.dynamic || !l.managed) continue;
      const reason = this.despawnReason(e, l, t, Math.hypot(at.x - p.x, at.z - p.z));
      if (!reason) continue;
      e.despawn(ctx);
      l.phase = 'cooldown';
      l.despawnedAt = t;
      l.despawns++;
      l.dueAt = t + this.cfg.respawnCooldownS[id];
      ctx.emit({ type: 'enemy_despawned', enemy: id, reason });
    }
    // spawns (earliest due first)
    const due = [...this.lives.values()]
      .filter((l) => l.managed && l.phase !== 'active' && t >= l.dueAt - 1e-9 && this.world)
      .sort((a, b) => a.dueAt - b.dueAt);
    let st: DirectorState | null = null;
    for (const l of due) {
      if (this.dynamic && this.activeCount() >= this.cfg.maxActive) break;
      if (this.anyEngaged()) {
        l.dueAt = t + this.cfg.retryS;
        continue;
      }
      const u = this.rng.next();
      st ??= state();
      const spawn = drawEncounterSpawn(this.world!, l.enemy, st, u);
      if (!spawn) {
        l.dueAt = t + this.cfg.retryS;
        continue;
      }
      this.spawnAt(ctx, l.enemy, spawn);
    }
  }

  /** Spawns `enemy` at `spawn` now (also used by tests / emergeHyde()). */
  spawnAt(ctx: SimContext, enemy: EnemyId, spawn: EncounterSpawnDef): Vec2 | null {
    const e = this.enemies.get(enemy);
    const l = this.lives.get(enemy);
    if (!e || !l || e.isActive()) return null;
    const first = l.spawns === 0;
    const at = e.spawn(ctx, { x: spawn.x, z: spawn.z, yaw: spawn.yaw });
    l.phase = 'active';
    l.spawnedAt = ctx.t;
    l.spawnId = spawn.id;
    l.spawns++;
    l.lastLosT = ctx.t;
    this.recent.push({ spawnId: spawn.id, t: ctx.t });
    ctx.emit({ type: 'enemy_spawned', enemy, spawnId: spawn.id, x: r2(at.x), z: r2(at.z) });
    this.hooks.onSpawn?.(enemy, spawn, at, first);
    return at;
  }

  private despawnReason(e: DirectedEnemy, l: EnemyLife, t: number, dPlayer: number): 'far' | 'cycle_done' | 'encounter_resolved' | null {
    const C = this.cfg;
    const alive = t - (l.spawnedAt ?? t);
    if (alive < C.minLifeS) return null;
    if (!e.calm() || e.engaged()) return null;
    if (dPlayer < C.despawnM) return null;
    if (t - l.lastLosT < C.noLosBeforeDespawnS) return null;
    if (e.encounterResolved()) return 'encounter_resolved';
    if (e.cycleDone()) return 'cycle_done';
    if (alive >= C.minActiveS) return 'far';
    return null;
  }
}

function r2(x: number): number {
  return Math.round(x * 100) / 100;
}
