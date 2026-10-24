// Encounter probabilities by area for all three enemies (FINAL_CONTRACT §4 / §9, FINAL_BRIEF §10 "Predictive") and the
// compact THREAT MAP the HUD draws. Pure module: inputs are public design data (zones, encounter spawns, Slurp's wander
// set, patrol loops), the director's public rules / tuning and PUBLIC observations only.
//
// INACTIVE enemy (not spawned yet, or despawned and cooling down) — the director's EXACT spawn distribution
//   (src/mystery/director.ts encounterSpawnDistribution via run.encounterDistribution(enemy); public inputs only: the
//   player's pose, line of sight, the public objective point, the recently used spawns, the director tuning). Zone odds =
//   Σ of P(s) over the spawns of each zone; area odds = Σ over the spawns inside each case area. "Rule-based estimate ·
//   spawn rules" (it is the rule itself, not a model).
// ACTIVE Hyde — the zone filter (hydeZones.ts; restarted from the spawn distribution on every (re)spawn).
// ACTIVE Crackstone — his rule-based sight-risk cells (crackstoneRisk.ts), zone p = max cell p in the zone.
// ACTIVE Slurp — a rule-based zone filter over his wander set ("wander rules"): he walks between uniformly drawn
//   waypoints of SlurpDef.wander with pauses, so his long-run position is the time share of the straight legs between all
//   ordered waypoint pairs (+ pauses at the waypoints) per zone (`slurpOccupancy`). The chain relaxes to that occupancy at
//   rate 1/τ (τ = mean leg + pause time): Q(i→j) = occ_j / τ (stationary = occupancy). Observations exactly as for the
//   Hyde: seen → collapse; CHASE / ATTACK → near the player; INVESTIGATE / SEARCH → within alertNearM; unseen → β in the
//   player's zone. Never ML; never his hidden position.
import { pointInPolygon } from '../geometry.ts';
import type { CaseWorldDef, EnemyId, HydeMode, SlurpMode, Vec2, ZoneDef } from '../types.ts';
import {
  distToZone, observationLikelihood, observeZones, predictZones, ZONE_FILTER_DEFAULTS, ZONE_FLOOR, zoneAdjacency, zoneIndexAt,
  type ZoneFilterParams, type ZoneModel,
} from './hydeZones.ts';
import type { EnemyThreatLayer, SpawnProb, ThreatMap, ThreatZone } from './types.ts';
export type { EnemyThreatLayer, ThreatBasis, ThreatMap, ThreatMeaning, ThreatZone } from './types.ts';

export const LABEL_SPAWN_RULES = 'Rule-based estimate · spawn rules' as const;
export const LABEL_ZONE_FILTER = 'Bayesian estimate · zone filter' as const;
export const LABEL_SIGHT_RULES = 'Rule-based estimate · sight rules' as const;
export const LABEL_WANDER_RULES = 'Rule-based estimate · wander rules' as const;
export const LABEL_NOISE_RULE = 'Rule-based estimate · zone odds × hearing radius' as const;
export const ENCOUNTER_MODEL_VERSION = 'encounter-rule-1';

// ----------------------------------------------------------------------------------------------------- spawn odds

/** Zone distribution of spawn odds (unknown zone ids → the zone at the spawn point). All zero stays all zero. */
export function spawnOddsByZone(zones: readonly ZoneDef[], spawns: readonly SpawnProb[]): number[] {
  const p = new Array<number>(zones.length).fill(0);
  for (const s of spawns) {
    let i = zones.findIndex((z) => z.id === s.zoneId);
    if (i < 0) i = zoneIndexAt(zones, s.x, s.z);
    if (i >= 0) p[i] += s.p;
  }
  return p;
}

// ----------------------------------------------------------------------------------------------------- Slurp wander model

/** Time share per zone of a walker drawing uniformly random next waypoints (legs i → j, i ≠ j, + pauses). */
export function slurpOccupancy(zones: readonly ZoneDef[], wander: readonly Vec2[], speedMps: number, pauseS: number, stepM = 0.5): number[] {
  const n = zones.length;
  const occ = new Array<number>(n).fill(0);
  if (n === 0) return occ;
  if (wander.length === 0) return occ.map(() => 1 / n);
  const v = Math.max(0.1, speedMps);
  for (let i = 0; i < wander.length; i++) {
    const a = wander[i];
    const za = zoneIndexAt(zones, a.x, a.z);
    if (za >= 0) occ[za] += Math.max(0, pauseS) * Math.max(1, wander.length - 1);
    for (let j = 0; j < wander.length; j++) {
      if (j === i) continue;
      const b = wander[j];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(len / stepM));
      for (let k = 0; k < steps; k++) {
        const f = (k + 0.5) / steps;
        const zi = zoneIndexAt(zones, a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f);
        if (zi >= 0) occ[zi] += len / steps / v;
      }
    }
  }
  const z = occ.reduce((x, y) => x + y, 0);
  return z > 0 ? occ.map((x) => x / z) : occ.map(() => 1 / n);
}

/** Mean seconds per wander leg (uniform ordered pairs) + pause. */
export function slurpLegS(wander: readonly Vec2[], speedMps: number, pauseS: number): number {
  if (wander.length < 2) return Math.max(5, pauseS);
  let total = 0;
  let k = 0;
  for (let i = 0; i < wander.length; i++) {
    for (let j = 0; j < wander.length; j++) {
      if (i === j) continue;
      total += Math.hypot(wander[j].x - wander[i].x, wander[j].z - wander[i].z);
      k++;
    }
  }
  return total / k / Math.max(0.1, speedMps) + Math.max(0, pauseS);
}

/** Slurp's observation parameters: his sight (~10 m) and the same β as the Hyde's filter. */
export const SLURP_FILTER_DEFAULTS: ZoneFilterParams = {
  ...ZONE_FILTER_DEFAULTS,
  chaseNearM: 10,
  alertNearM: 20,
  beta: 0.5,
};

/** A reset-to-occupancy chain over the zones (see the header); stationary distribution = `occupancy`. */
export function buildSlurpModel(zones: readonly ZoneDef[], wander: readonly Vec2[], speedMps: number, pauseS: number, params: ZoneFilterParams = SLURP_FILTER_DEFAULTS): ZoneModel {
  const n = zones.length;
  const occupancy = slurpOccupancy(zones, wander, speedMps, pauseS);
  const tau = Math.max(1, slurpLegS(wander, speedMps, pauseS));
  const rates = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  let maxExit = 0;
  for (let i = 0; i < n; i++) {
    let out = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      rates[i][j] = occupancy[j] / tau;
      out += rates[i][j];
    }
    rates[i][i] = -out;
    maxExit = Math.max(maxExit, out);
  }
  return { zones, rates, occupancy, adjacency: zoneAdjacency(zones), maxExit, params };
}

/** Slurp's mode as the generic zone observation sees it. */
export function slurpObsMode(mode: SlurpMode): HydeMode {
  if (mode === 'CHASE' || mode === 'ATTACK') return 'CHASE';
  if (mode === 'INVESTIGATE' || mode === 'SEARCH') return 'SEARCH';
  return 'PATROL';
}

// ----------------------------------------------------------------------------------------------------- tracker

function normalise(p: readonly number[]): number[] {
  const z = p.reduce((a, b) => a + b, 0);
  if (!(z > 0)) return p.map(() => 1 / Math.max(1, p.length));
  const q = p.map((x) => Math.max(ZONE_FLOOR, x / z));
  const z2 = q.reduce((a, b) => a + b, 0);
  return q.map((x) => x / z2);
}

/**
 * One enemy's zone belief across its lifecycle: while inactive it remembers the latest spawn-zone odds; on a spawn the
 * filter starts from them (at the spawn time); while active it predicts + observes at every sample; on a despawn it stops.
 */
export class EnemyZoneTracker {
  private p: number[] | null = null;
  private lastT = 0;
  private pending: number[] | null = null;

  constructor(readonly model: ZoneModel) {}

  get active(): boolean {
    return this.p !== null;
  }

  /** The spawn-zone odds the next spawn starts from (inactive phase). */
  noteSpawnOdds(zoneP: readonly number[]): void {
    if (zoneP.some((x) => x > 0)) this.pending = [...zoneP];
  }

  spawn(t: number): void {
    this.p = normalise(this.pending ?? this.model.occupancy);
    this.lastT = t;
  }

  despawn(): void {
    this.p = null;
  }

  step(t: number, obs: { player: Vec2; mode: HydeMode; visible: boolean; pos: Vec2 | null }): number[] {
    if (!this.p) this.spawn(t);
    const dt = Math.max(0, t - this.lastT);
    this.lastT = Math.max(this.lastT, t);
    this.p = observeZones(predictZones(this.model, this.p!, dt), observationLikelihood(this.model, {
      player: obs.player, mode: obs.mode, visible: obs.visible, hydePos: obs.visible ? obs.pos : null,
    }));
    return [...this.p];
  }

  probs(): number[] | null {
    return this.p ? [...this.p] : null;
  }
}

// ----------------------------------------------------------------------------------------------------- threat map

/** Zone p of Crackstone's sight cells: max cell p among cells whose centre lies in the zone (nearest zone otherwise). */
export function crackCellsByZone(zones: readonly ZoneDef[], cells: readonly { x: number; z: number; p: number }[]): number[] {
  const p = new Array<number>(zones.length).fill(0);
  for (const c of cells) {
    let i = -1;
    for (let k = 0; k < zones.length; k++) if (pointInPolygon(c.x, c.z, zones[k].polygon)) { i = k; break; }
    if (i < 0) i = zoneIndexAt(zones, c.x, c.z);
    if (i >= 0) p[i] = Math.max(p[i], c.p);
  }
  return p;
}

export function assembleThreatMap(zones: readonly ZoneDef[], layers: readonly EnemyThreatLayer[], player: Vec2): ThreatMap {
  const own = zones.length > 0 ? zoneIndexAt(zones, player.x, player.z) : -1;
  const enemies: Partial<Record<EnemyId, EnemyThreatLayer>> = {};
  for (const l of layers) enemies[l.enemy] = l;
  const out: ThreatZone[] = zones.map((z, i) => {
    const p: Partial<Record<EnemyId, number>> = {};
    let max = 0;
    let top: EnemyId | null = null;
    for (const l of layers) {
      const v = l.zones[i]?.p ?? 0;
      p[l.enemy] = v;
      if (l.state === 'active' && v > max) {
        max = v;
        top = l.enemy;
      }
    }
    return { zoneId: z.id, name: z.name, polygon: z.polygon.map((q) => ({ x: q.x, z: q.z })), p, max: r3(max), top };
  });
  let hereMax = 0;
  let hereTop: EnemyId | null = null;
  for (const l of layers) {
    if (l.state !== 'active') continue;
    const v = l.here ?? (own >= 0 ? l.zones[own]?.p ?? 0 : 0);
    if (v > hereMax) {
      hereMax = v;
      hereTop = l.enemy;
    }
  }
  return {
    zones: out, enemies, ownZoneId: own >= 0 ? zones[own].id : null, here: { max: r3(hereMax), top: hereTop },
    label: 'Rule-based estimates · spawn / sight / wander rules + Bayesian zone filter',
  };
}

/** Fraction of a zone's box within `r` m of `at` (sampled on a 1.5 m grid; cached grid per zone list). */
const gridCache = new WeakMap<readonly ZoneDef[], Vec2[][]>();
export function zoneFractionsWithin(zones: readonly ZoneDef[], at: Vec2, r: number): number[] {
  let grid = gridCache.get(zones);
  if (!grid) {
    grid = zones.map((z) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const q of z.polygon) {
        minX = Math.min(minX, q.x);
        maxX = Math.max(maxX, q.x);
        minZ = Math.min(minZ, q.z);
        maxZ = Math.max(maxZ, q.z);
      }
      const pts: Vec2[] = [];
      for (let x = minX + 0.75; x < maxX; x += 1.5) for (let zz = minZ + 0.75; zz < maxZ; zz += 1.5) if (pointInPolygon(x, zz, z.polygon)) pts.push({ x, z: zz });
      return pts.length > 0 ? pts : [{ x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 }];
    });
    gridCache.set(zones, grid);
  }
  return grid.map((pts, i) => {
    if (r <= 0) return 0;
    if (distToZone(zones[i], at.x, at.z) > r) return 0;
    let k = 0;
    for (const q of pts) if (Math.hypot(q.x - at.x, q.z - at.z) <= r) k++;
    return k / pts.length;
  });
}

/** P(enemy within r of the player) from zone odds, assuming a uniform position within its zone. */
export function withinRadiusP(zones: readonly ZoneDef[], zoneP: readonly number[], at: Vec2, r: number): number {
  const f = zoneFractionsWithin(zones, at, r);
  let s = 0;
  for (let i = 0; i < f.length; i++) s += (zoneP[i] ?? 0) * f[i];
  return Math.min(1, Math.max(0, s));
}

export function r3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

// ----------------------------------------------------------------------------------------------------- Slurp cells

/** Slurp's detection geometry (contract §5): proximity all around, sight in a ~90° cone (as a 1/4 share of the disc). */
export const SLURP_SENSE = { proximityM: 3, sightM: 10, coneShare: 0.25, horizonS: 15, looksS: [0, 5, 10, 15] as readonly number[], cellM: 4 } as const;

/** His senses from the sim tuning (tuning.slurp: proximityM, sight.rangeM, sight.coneDeg), else the contract values. */
export interface SlurpSenses { proximityM: number; sightM: number; coneShare: number }

export interface SlurpCellGeometry {
  cells: { x: number; z: number }[];
  /** Per cell, per zone: share of the zone within proximityM / sightM of the cell centre. */
  near: number[][];
  far: number[][];
}

const slurpGeoCache = new WeakMap<readonly ZoneDef[], Map<string, SlurpCellGeometry>>();

/** 4 m cells over the zones (centre inside a zone), optionally cut to a disc (his haunt + sight range). */
export function slurpCellGeometry(zones: readonly ZoneDef[], disc: { x: number; z: number; r: number } | null, senses: SlurpSenses = SLURP_SENSE): SlurpCellGeometry {
  const key = `${disc ? `${disc.x.toFixed(1)},${disc.z.toFixed(1)},${disc.r.toFixed(1)}` : 'all'}|${senses.proximityM}|${senses.sightM}`;
  let m = slurpGeoCache.get(zones);
  if (!m) {
    m = new Map();
    slurpGeoCache.set(zones, m);
  }
  const hit = m.get(key);
  if (hit) return hit;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const z of zones) for (const q of z.polygon) {
    minX = Math.min(minX, q.x);
    maxX = Math.max(maxX, q.x);
    minZ = Math.min(minZ, q.z);
    maxZ = Math.max(maxZ, q.z);
  }
  const s = SLURP_SENSE.cellM;
  const cells: { x: number; z: number }[] = [];
  for (let x = minX + s / 2; x < maxX; x += s) {
    for (let z = minZ + s / 2; z < maxZ; z += s) {
      if (!zones.some((zz) => pointInPolygon(x, z, zz.polygon))) continue;
      if (disc && Math.hypot(x - disc.x, z - disc.z) > disc.r) continue;
      cells.push({ x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 });
    }
  }
  const geo: SlurpCellGeometry = {
    cells,
    near: cells.map((c) => zoneFractionsWithin(zones, c, senses.proximityM)),
    far: cells.map((c) => zoneFractionsWithin(zones, c, senses.sightM)),
  };
  m.set(key, geo);
  return geo;
}

/**
 * P(Slurp finds a player standing at a point within 15 s) — RULE-BASED: his zone odds now are propagated with the wander
 * chain to the looks at +0, +5, +10, +15 s; at each look P(encounter) = Σ_z q_z · (near_z + coneShare · (far_z − near_z))
 * (uniform position inside a zone; walls ignored); the four looks combine as 1 − Π (1 − p_k). `nearOnly` = the player is
 * hidden (crouch spot / open cabinet): only his proximity sense counts.
 */
export function slurpLooks(model: ZoneModel, zoneP: readonly number[]): number[][] {
  return SLURP_SENSE.looksS.map((h) => (h > 0 ? predictZones(model, zoneP, h) : [...zoneP]));
}

export function slurpEncounterP(looks: readonly (readonly number[])[], near: readonly number[], far: readonly number[], nearOnly = false, coneShare: number = SLURP_SENSE.coneShare): number {
  let miss = 1;
  for (const q of looks) {
    let p = 0;
    for (let i = 0; i < q.length; i++) {
      const n = near[i] ?? 0;
      p += q[i] * (nearOnly ? n : n + coneShare * Math.max(0, (far[i] ?? 0) - n));
    }
    miss *= 1 - Math.min(1, Math.max(0, p));
  }
  return 1 - miss;
}

/**
 * The same combination along a PATH: look k uses the zone shares around the player's position at that look (e.g. "if
 * you keep moving like this": p + velocity × h). `nears[k]` / `fars[k]` per look.
 */
export function slurpEncounterPath(looks: readonly (readonly number[])[], nears: readonly (readonly number[])[], fars: readonly (readonly number[])[], nearOnly = false, coneShare: number = SLURP_SENSE.coneShare): number {
  let miss = 1;
  looks.forEach((q, k) => {
    const near = nears[Math.min(k, nears.length - 1)];
    const far = fars[Math.min(k, fars.length - 1)];
    let p = 0;
    for (let i = 0; i < q.length; i++) {
      const n = near[i] ?? 0;
      p += q[i] * (nearOnly ? n : n + coneShare * Math.max(0, (far[i] ?? 0) - n));
    }
    miss *= 1 - Math.min(1, Math.max(0, p));
  });
  return 1 - miss;
}

/** Spawn odds grouped by AREA name (UX "Next: {area} %"): the case area whose circle holds the spawn, else its zone's name. */
export function spawnOddsByArea(world: Pick<CaseWorldDef, 'areas' | 'zones'>, spawns: readonly SpawnProb[]): { name: string; areaId: string | null; x: number; z: number; p: number }[] {
  const m = new Map<string, { name: string; areaId: string | null; x: number; z: number; p: number }>();
  for (const s of spawns) {
    if (!(s.p > 0)) continue;
    let best: { id: string; name: string; x: number; z: number } | null = null;
    let bestD = Infinity;
    for (const a of world.areas) {
      const d = Math.hypot(a.x - s.x, a.z - s.z);
      if (d <= a.radiusM && d < bestD) {
        bestD = d;
        best = a;
      }
    }
    const zone = world.zones.find((z) => z.id === s.zoneId) ?? world.zones[zoneIndexAt(world.zones, s.x, s.z)];
    const name = best?.name ?? zone?.name ?? s.name;
    const cur = m.get(name);
    if (cur) cur.p += s.p;
    else m.set(name, { name, areaId: best?.id ?? null, x: best?.x ?? s.x, z: best?.z ?? s.z, p: s.p });
  }
  return [...m.values()].map((a) => ({ ...a, p: r3(a.p) })).sort((a, b) => b.p - a.p || a.name.localeCompare(b.name));
}
