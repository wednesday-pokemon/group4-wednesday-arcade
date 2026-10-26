// Where is the Hyde likely? (overhaul, docs/overhaul/OVERHAUL_CONTRACT.md "Analytics" and docs/MYSTERY_MODEL_REPORT.md
// "Hyde zones"). Pure module: inputs are the case world (zones, spawns — public design data), the patrol loop (public:
// "one closed, learnable loop"), the tuning's patrol speed and PUBLIC observations only (the player's own position, the
// HUD-visible Hyde mode, whether the player can see the Hyde and — only then — where it is).
//
// BEFORE EMERGENCE — exact spawn rule (the sim's rule): valid spawns are those ≥ minSpawnM from the player;
//   P(spawn s) = w_s / Σ_valid w;  no valid spawn → the farthest spawn gets 1.
// AFTER EMERGENCE — a discrete zone filter (hidden Markov model over world.zones), updated once per second:
//   prior   = the spawn distribution at the moment of emergence, mapped to the spawns' zones;
//   predict = continuous-time Markov chain with rates Q = Q_patrol + Q_diffusion, integrated over Δt by sub-stepping
//             p ← p (I + Q δt) with δt ≤ 0.5 / max exit rate:
//     Q_patrol(i → j) = #(loop transitions i → j) / T_i  where T_i = (patrol length inside zone i) / patrol speed. Its
//               stationary distribution is exactly the patrol occupancy (time share of the loop in each zone);
//     Q_diffusion(i → j) = d for every zone j adjacent to i (the Hyde leaves its loop to investigate / search / chase);
//               a zone the loop never enters is left at rate r (split over its neighbours) — it returns to the loop;
//   observe = Bayes: p_i ← p_i · L_i / Σ p L, with
//     Hyde visible            → L = 1 for the zone containing its (seen) position, 0 elsewhere (collapse);
//     CHASE (shown on HUD)     → L = 1 for zones within chaseNearM of the player, chaseFar elsewhere;
//     INVESTIGATE / SEARCH     → L = 1 for zones within alertNearM of the player, alertFar elsewhere;
//     not visible (otherwise) → L = β for the player's own zone, 1 elsewhere (β = P(not seeing it | same zone)).
//   A floor of 1e-4 per zone keeps log-loss finite. β and the rates are fitted / selected on TRAINING sessions of the
//   simulated episodes and evaluated on held-out sessions (scripts/mystery-evaluate.ts; numbers in the model report).
import { pointInPolygon } from '../geometry.ts';
import type { CaseWorldDef, HydeMode, HydeSpawnDef, Vec2, ZoneDef } from '../types.ts';
import type { SpawnProb, ZoneProb } from './types.ts';

// ----------------------------------------------------------------------------------------------------- spawn rule

/** The sim's emergence distribution for a player standing at `player` (exact; see the header). */
export function spawnProbabilities(world: Pick<CaseWorldDef, 'hydeSpawns'>, player: Vec2, minSpawnM: number): SpawnProb[] {
  const spawns = world.hydeSpawns;
  if (spawns.length === 0) return [];
  const d = spawns.map((s) => Math.hypot(s.x - player.x, s.z - player.z));
  const valid = spawns.map((s, i) => d[i] >= minSpawnM && s.weight > 0);
  const total = spawns.reduce((acc, s, i) => acc + (valid[i] ? s.weight : 0), 0);
  let p: number[];
  if (total > 0) p = spawns.map((s, i) => (valid[i] ? s.weight / total : 0));
  else {
    let far = 0;
    for (let i = 1; i < spawns.length; i++) if (d[i] > d[far]) far = i;
    p = spawns.map((_, i) => (i === far ? 1 : 0));
  }
  return spawns.map((s: HydeSpawnDef, i) => ({ spawnId: s.id, name: s.name, zoneId: s.zoneId, x: s.x, z: s.z, p: p[i] }));
}

// ----------------------------------------------------------------------------------------------------- zone geometry

interface Box { minX: number; maxX: number; minZ: number; maxZ: number }

function boxOf(poly: readonly Vec2[]): Box {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const q of poly) {
    minX = Math.min(minX, q.x);
    maxX = Math.max(maxX, q.x);
    minZ = Math.min(minZ, q.z);
    maxZ = Math.max(maxZ, q.z);
  }
  return { minX, maxX, minZ, maxZ };
}

/** Distance from a point to a zone's bounding box (0 inside). */
export function distToZone(zone: Pick<ZoneDef, 'polygon'>, x: number, z: number): number {
  const b = boxOf(zone.polygon);
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return Math.hypot(dx, dz);
}

/** Index of the zone containing (x, z) (first match in world order), else the nearest zone; −1 without zones. */
export function zoneIndexAt(zones: readonly ZoneDef[], x: number, z: number): number {
  for (let i = 0; i < zones.length; i++) if (pointInPolygon(x, z, zones[i].polygon)) return i;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < zones.length; i++) {
    const d = distToZone(zones[i], x, z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Zones are adjacent when their bounding boxes share a border of positive length (or overlap). */
export function zoneAdjacency(zones: readonly ZoneDef[], tolM = 0.5): boolean[][] {
  const b = zones.map((z) => boxOf(z.polygon));
  return b.map((a, i) => b.map((c, j) => {
    if (i === j) return false;
    const ox = Math.min(a.maxX, c.maxX) - Math.max(a.minX, c.minX);
    const oz = Math.min(a.maxZ, c.maxZ) - Math.max(a.minZ, c.minZ);
    return (ox >= -tolM && oz > tolM) || (oz >= -tolM && ox > tolM);
  }));
}

// ----------------------------------------------------------------------------------------------------- model

export interface ZoneFilterParams {
  /** Rate (1/s) from a zone to EACH adjacent zone on top of the patrol flow. */
  diffusionPerS: number;
  /** Total rate (1/s) at which the Hyde leaves a zone the patrol loop never enters. */
  offPatrolReturnPerS: number;
  /** P(the player does not see the Hyde | it is in the player's zone, no chase). */
  beta: number;
  chaseNearM: number;
  chaseFarLikelihood: number;
  alertNearM: number;
  alertFarLikelihood: number;
}

/** Defaults (overridden by the values selected on training sessions when the model artifact carries them). */
export const ZONE_FILTER_DEFAULTS: ZoneFilterParams = {
  diffusionPerS: 0.02,
  offPatrolReturnPerS: 1 / 15,
  beta: 0.5,
  chaseNearM: 12,
  chaseFarLikelihood: 0.02,
  alertNearM: 25,
  alertFarLikelihood: 0.3,
};

export const ZONE_FLOOR = 1e-4;

export interface ZoneModel {
  zones: readonly ZoneDef[];
  /** Off-diagonal rates (1/s); rates[i][i] = −Σ_j rates[i][j]. */
  rates: number[][];
  /** Patrol occupancy (time share of the loop in each zone) — the static baseline. */
  occupancy: number[];
  adjacency: boolean[][];
  maxExit: number;
  params: ZoneFilterParams;
}

/** The patrol loop as a cyclic sequence of (zone index, metres inside) runs, sampled every `stepM`. */
export function patrolZoneRuns(zones: readonly ZoneDef[], patrol: readonly Vec2[], stepM = 0.5): { zone: number; lengthM: number }[] {
  const runs: { zone: number; lengthM: number }[] = [];
  const n = patrol.length;
  for (let k = 0; k < n; k++) {
    const a = patrol[k];
    const b = patrol[(k + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len / stepM));
    for (let s = 0; s < steps; s++) {
      const f = (s + 0.5) / steps;
      const zi = zoneIndexAt(zones, a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f);
      const piece = len / steps;
      const last = runs[runs.length - 1];
      if (last && last.zone === zi) last.lengthM += piece;
      else runs.push({ zone: zi, lengthM: piece });
    }
  }
  // the loop is cyclic: merge the last run into the first when they are the same zone
  if (runs.length > 1 && runs[0].zone === runs[runs.length - 1].zone) {
    runs[0].lengthM += runs[runs.length - 1].lengthM;
    runs.pop();
  }
  return runs;
}

export function buildZoneModel(zones: readonly ZoneDef[], patrol: readonly Vec2[], patrolSpeedMps: number, params: ZoneFilterParams = ZONE_FILTER_DEFAULTS): ZoneModel {
  const n = zones.length;
  const rates = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const timeIn = new Array<number>(n).fill(0);
  const adjacency = zoneAdjacency(zones);
  const runs = patrol.length >= 2 && n > 0 ? patrolZoneRuns(zones, patrol) : [];
  const speed = Math.max(0.1, patrolSpeedMps);
  for (const r of runs) if (r.zone >= 0) timeIn[r.zone] += r.lengthM / speed;
  const loopT = timeIn.reduce((a, b) => a + b, 0);
  if (runs.length > 1) {
    for (let k = 0; k < runs.length; k++) {
      const i = runs[k].zone;
      const j = runs[(k + 1) % runs.length].zone;
      if (i < 0 || j < 0 || i === j || timeIn[i] <= 0) continue;
      rates[i][j] += 1 / timeIn[i];
    }
  }
  for (let i = 0; i < n; i++) {
    const nb = adjacency[i].map((x, j) => (x ? j : -1)).filter((j) => j >= 0);
    if (nb.length === 0) continue;
    if (timeIn[i] <= 0) for (const j of nb) rates[i][j] += params.offPatrolReturnPerS / nb.length;
    for (const j of nb) rates[i][j] += params.diffusionPerS;
  }
  let maxExit = 0;
  for (let i = 0; i < n; i++) {
    let out = 0;
    for (let j = 0; j < n; j++) if (j !== i) out += rates[i][j];
    rates[i][i] = -out;
    maxExit = Math.max(maxExit, out);
  }
  const occupancy = loopT > 0 ? timeIn.map((x) => x / loopT) : new Array<number>(n).fill(n > 0 ? 1 / n : 0);
  return { zones, rates, occupancy, adjacency, maxExit, params };
}

/** One prediction step of `dt` seconds (sub-stepped Euler on the rate matrix; rows stay stochastic). */
export function predictZones(model: ZoneModel, p: readonly number[], dt: number): number[] {
  let cur = [...p];
  if (dt <= 0 || model.maxExit <= 0) return cur;
  const steps = Math.max(1, Math.ceil((dt * model.maxExit) / 0.5));
  const h = dt / steps;
  const n = cur.length;
  for (let s = 0; s < steps; s++) {
    const next = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      if (cur[i] === 0) continue;
      const row = model.rates[i];
      for (let j = 0; j < n; j++) next[j] += cur[i] * (j === i ? 1 + row[i] * h : row[j] * h);
    }
    cur = next;
  }
  return normaliseFloor(cur, 0);
}

export interface ZoneObservation {
  player: Vec2;
  /** Hyde mode as shown on the HUD. */
  mode: HydeMode;
  visible: boolean;
  /** Only when visible: where the player sees it. */
  hydePos: Vec2 | null;
}

/** Likelihood vector L_i = P(observation | Hyde in zone i) (see the header). */
export function observationLikelihood(model: ZoneModel, obs: ZoneObservation): number[] {
  const { zones, params } = model;
  if (obs.visible && obs.hydePos) {
    const k = zoneIndexAt(zones, obs.hydePos.x, obs.hydePos.z);
    return zones.map((_, i) => (i === k ? 1 : 0));
  }
  if (obs.mode === 'CHASE') return zones.map((z) => (distToZone(z, obs.player.x, obs.player.z) <= params.chaseNearM ? 1 : params.chaseFarLikelihood));
  const own = zoneIndexAt(zones, obs.player.x, obs.player.z);
  const base = obs.mode === 'INVESTIGATE_SOUND' || obs.mode === 'SEARCH'
    ? zones.map((z) => (distToZone(z, obs.player.x, obs.player.z) <= params.alertNearM ? 1 : params.alertFarLikelihood))
    : zones.map(() => 1);
  return base.map((l, i) => (i === own ? l * params.beta : l));
}

function normaliseFloor(p: readonly number[], floor: number): number[] {
  const z = p.reduce((a, b) => a + b, 0);
  if (!(z > 0)) return p.map(() => 1 / Math.max(1, p.length));
  let q = p.map((x) => x / z);
  if (floor > 0) {
    q = q.map((x) => Math.max(floor, x));
    const z2 = q.reduce((a, b) => a + b, 0);
    q = q.map((x) => x / z2);
  }
  return q;
}

/** Bayes update with a likelihood vector; inconsistent evidence (all-zero product) keeps the prediction. */
export function observeZones(p: readonly number[], likelihood: readonly number[]): number[] {
  const post = p.map((x, i) => x * likelihood[i]);
  if (!(post.reduce((a, b) => a + b, 0) > 0)) return normaliseFloor(p, ZONE_FLOOR);
  return normaliseFloor(post, ZONE_FLOOR);
}

/** Zone distribution of a spawn distribution (spawns' zone ids; unknown ids → the zone at the spawn point). */
export function spawnZoneDistribution(zones: readonly ZoneDef[], spawns: readonly SpawnProb[]): number[] {
  const p = new Array<number>(zones.length).fill(0);
  for (const s of spawns) {
    let i = zones.findIndex((z) => z.id === s.zoneId);
    if (i < 0) i = zoneIndexAt(zones, s.x, s.z);
    if (i >= 0) p[i] += s.p;
  }
  return normaliseFloor(p, ZONE_FLOOR);
}

/**
 * The live filter: `start` at emergence with the spawn distribution, then one `step` per sample (predict over the
 * elapsed time, then observe). Deterministic; identical code runs in the evaluation script.
 */
export class ZoneFilter {
  private p: number[] | null = null;
  private lastT = 0;

  constructor(readonly model: ZoneModel) {}

  get started(): boolean {
    return this.p !== null;
  }

  start(prior: readonly number[], t: number): void {
    this.p = normaliseFloor(prior, ZONE_FLOOR);
    this.lastT = t;
  }

  step(t: number, obs: ZoneObservation): number[] {
    if (!this.p) this.start(this.model.occupancy, t);
    const dt = Math.max(0, t - this.lastT);
    this.lastT = Math.max(this.lastT, t);
    this.p = observeZones(predictZones(this.model, this.p!, dt), observationLikelihood(this.model, obs));
    return [...this.p];
  }

  probs(): number[] {
    return this.p ? [...this.p] : [...this.model.occupancy];
  }
}

/** One 1 Hz sample as the zone tracker sees it (public information only). */
export interface ZoneSample {
  t: number;
  emerged: boolean;
  /** investigation().hydeEmergedAt (null = unknown → the sample time). */
  emergedAt: number | null;
  player: Vec2;
  mode: HydeMode;
  visible: boolean;
  /** Only while visible. */
  hydePos: Vec2 | null;
}

/**
 * Before emergence: remembers the spawn distribution for the player's latest position. At the first emerged sample:
 * starts the filter from that distribution (mapped to zones) at `emergedAt`, then predicts + observes every sample.
 * The live engine and the offline evaluation (scripts/mystery-evaluate.ts) run exactly this code.
 */
export class ZoneTracker {
  readonly filter: ZoneFilter;
  private lastSpawns: SpawnProb[] | null = null;

  constructor(readonly model: ZoneModel, private readonly world: Pick<CaseWorldDef, 'hydeSpawns' | 'zones'>, private readonly minSpawnM: number) {
    this.filter = new ZoneFilter(model);
  }

  sample(s: ZoneSample): number[] | null {
    if (!s.emerged) {
      this.lastSpawns = spawnProbabilities(this.world, s.player, this.minSpawnM);
      return null;
    }
    if (!this.filter.started) {
      const spawns = this.lastSpawns ?? spawnProbabilities(this.world, s.player, this.minSpawnM);
      this.filter.start(spawnZoneDistribution(this.world.zones, spawns), Math.min(s.t, s.emergedAt ?? s.t));
    }
    return this.filter.step(s.t, { player: s.player, mode: s.mode, visible: s.visible, hydePos: s.visible ? s.hydePos : null });
  }

  /** The latest pre-emergence spawn distribution (null before the first sample). */
  spawns(): SpawnProb[] | null {
    return this.lastSpawns;
  }
}

export function zoneProbs(zones: readonly ZoneDef[], p: readonly number[]): ZoneProb[] {
  return zones.map((z, i) => ({ zoneId: z.id, name: z.name, p: p[i] ?? 0, polygon: z.polygon.map((q) => ({ x: q.x, z: q.z })) }));
}

/** Multi-class Brier score Σ_i (p_i − 1[i = truth])² and log-loss −ln p_truth for one prediction. */
export function zoneScores(p: readonly number[], truth: number): { brier: number; logLoss: number } {
  let brier = 0;
  for (let i = 0; i < p.length; i++) brier += (p[i] - (i === truth ? 1 : 0)) ** 2;
  return { brier, logLoss: -Math.log(Math.max(1e-12, p[truth] ?? 0)) };
}
