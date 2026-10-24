// Offline fitting + evaluation of the overhaul's probability estimates on SIMULATED episodes (data/mystery/rows.csv,
// episodes.csv). Shared by mystery-train.ts (selects the zone-filter parameters on TRAINING sessions) and
// mystery-evaluate.ts (scores them on the HELD-OUT sessions). This module reads the true Hyde position and the true
// site indices from the rows — that is the point of an evaluation; the live game never sees them.
//
//   Hyde zones   ZoneTracker (src/mystery/analytics/hydeZones.ts — the exact live code) replayed per session at 1 Hz;
//                truth = the zone containing the Hyde; multi-class Brier Σ(p − y)², log-loss −ln p_true, top-1 accuracy,
//                vs (a) the patrol-occupancy baseline and (b) the same filter without observations (prior + patrol only).
//   Spawn odds   p(true spawn) of the distribution predicted at the last pre-emergence sample vs the raw weights.
//   Egg / clues  the live Bayesian posteriors (eggPost / cluePost) vs the session's true site (eggTrue / clueTrue), vs the
//                case priors; reliability bins of (predicted p, outcome) over every candidate.
import { DEFAULT_TUNING } from '../src/mystery/config.ts';
import { caseMap } from '../src/mystery/defaults.ts';
import { isCaseId } from '../src/mystery/data/cases.ts';
import type { Row } from '../src/mystery/analytics/dataset.ts';
import {
  buildZoneModel, zoneIndexAt, zoneScores, ZONE_FILTER_DEFAULTS, ZoneTracker, type ZoneFilterParams, type ZoneModel,
} from '../src/mystery/analytics/hydeZones.ts';
import type { CaseId, CaseWorldDef, HydeMode } from '../src/mystery/types.ts';

export interface Bin { lower: number; upper: number; count: number; meanPredicted: number; observedRate: number }

export interface ProbScore {
  rows: number;
  sessions: number;
  brier: number;
  logLoss: number;
  top1: number;
  calibration: Bin[];
}

export interface ZoneEvaluation {
  all: ProbScore;
  hidden: ProbScore; // rows where the player could NOT see the Hyde (the interesting case)
  occupancy: ProbScore; // static patrol-occupancy baseline on the same rows
  occupancyHidden: ProbScore;
  noObservation: ProbScore; // the same filter with every likelihood = 1 (prior + patrol dynamics only)
  byCase: Record<string, { all: ProbScore; occupancy: ProbScore }>;
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;
const num = (s: string) => Number(s);

export function groupSessions(rows: readonly Row[]): Map<string, Row[]> {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const g = m.get(r.session);
    if (g) g.push(r);
    else m.set(r.session, [r]);
  }
  for (const g of m.values()) g.sort((a, b) => num(a.t) - num(b.t));
  return m;
}

class Acc {
  n = 0;
  brier = 0;
  logLoss = 0;
  top1 = 0;
  sessions = new Set<string>();
  private bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));

  add(session: string, p: readonly number[], truth: number): void {
    const s = zoneScores(p, truth);
    this.n++;
    this.brier += s.brier;
    this.logLoss += s.logLoss;
    let best = 0;
    for (let i = 1; i < p.length; i++) if (p[i] > p[best]) best = i;
    if (best === truth) this.top1++;
    this.sessions.add(session);
    p.forEach((q, i) => {
      const b = this.bins[Math.min(9, Math.floor(q * 10))];
      b.n++;
      b.p += q;
      b.y += i === truth ? 1 : 0;
    });
  }

  score(): ProbScore {
    const n = Math.max(1, this.n);
    return {
      rows: this.n, sessions: this.sessions.size, brier: r4(this.brier / n), logLoss: r4(this.logLoss / n), top1: r4(this.top1 / n),
      calibration: this.bins.map((b, i) => ({ lower: i / 10, upper: (i + 1) / 10, count: b.n, meanPredicted: b.n ? r4(b.p / b.n) : 0, observedRate: b.n ? r4(b.y / b.n) : 0 })),
    };
  }
}

const worldCache = new Map<CaseId, { world: CaseWorldDef; patrol: { x: number; z: number }[] }>();
function worldFor(caseId: string): { world: CaseWorldDef; patrol: { x: number; z: number }[] } | null {
  if (!isCaseId(caseId)) return null;
  let w = worldCache.get(caseId);
  if (!w) {
    const map = caseMap(caseId);
    if (!map.world) return null;
    w = { world: map.world, patrol: map.patrol };
    worldCache.set(caseId, w);
  }
  return w;
}

const modelCache = new Map<string, ZoneModel>();
function modelFor(caseId: string, params: ZoneFilterParams): ZoneModel | null {
  const w = worldFor(caseId);
  if (!w || w.world.zones.length === 0) return null;
  const key = `${caseId}|${JSON.stringify(params)}`;
  let m = modelCache.get(key);
  if (!m) {
    m = buildZoneModel(w.world.zones, w.patrol, DEFAULT_TUNING.hyde.speed.PATROL, params);
    modelCache.set(key, m);
  }
  return m;
}

const MIN_SPAWN = DEFAULT_TUNING.hyde.minSpawnM;

interface Replayed { session: string; caseId: string; p: number[]; truth: number; visible: boolean; occupancy: number[] }

/** Replays the live zone tracker over one session's rows; yields one prediction per emerged row with its truth. */
function* replay(session: string, rows: readonly Row[], params: ZoneFilterParams): Generator<Replayed> {
  const caseId = rows[0]?.caseId ?? '';
  const w = worldFor(caseId);
  const model = modelFor(caseId, params);
  if (!w || !model) return;
  const tracker = new ZoneTracker(model, w.world, MIN_SPAWN);
  for (const r of rows) {
    if (r.cx === '' || r.hydeX === '') continue;
    const emerged = r.hydeEmerged === undefined || r.hydeEmerged === '' ? true : r.hydeEmerged === '1';
    const visible = r.hydeVisible === '1';
    const p = tracker.sample({
      t: num(r.t), emerged, emergedAt: r.emergedAt === '' || r.emergedAt === undefined ? null : num(r.emergedAt),
      player: { x: num(r.cx), z: num(r.cz) }, mode: r.hydeMode as HydeMode, visible,
      hydePos: visible ? { x: num(r.hydeX), z: num(r.hydeZ) } : null, // the player sees it: public
    });
    if (!p) continue;
    const truth = zoneIndexAt(w.world.zones, num(r.hydeX), num(r.hydeZ)); // EVALUATION truth
    yield { session, caseId, p, truth, visible, occupancy: model.occupancy };
  }
}

export function evaluateZones(sessions: ReadonlyMap<string, Row[]>, params: ZoneFilterParams): ZoneEvaluation {
  const all = new Acc();
  const hidden = new Acc();
  const occ = new Acc();
  const occHidden = new Acc();
  const none = new Acc();
  const byCase = new Map<string, { all: Acc; occ: Acc }>();
  const blind: ZoneFilterParams = { ...params, beta: 1, chaseFarLikelihood: 1, alertFarLikelihood: 1 };
  for (const [session, rows] of sessions) {
    for (const x of replay(session, rows, params)) {
      all.add(session, x.p, x.truth);
      occ.add(session, x.occupancy, x.truth);
      if (!x.visible) {
        hidden.add(session, x.p, x.truth);
        occHidden.add(session, x.occupancy, x.truth);
      }
      const c = byCase.get(x.caseId) ?? { all: new Acc(), occ: new Acc() };
      c.all.add(session, x.p, x.truth);
      c.occ.add(session, x.occupancy, x.truth);
      byCase.set(x.caseId, c);
    }
    // the no-observation ablation (visible rows still collapse? no — every likelihood is flat, including sightings)
    for (const x of replayBlind(session, rows, blind)) none.add(session, x.p, x.truth);
  }
  const out: ZoneEvaluation['byCase'] = {};
  for (const [id, c] of byCase) out[id] = { all: c.all.score(), occupancy: c.occ.score() };
  return { all: all.score(), hidden: hidden.score(), occupancy: occ.score(), occupancyHidden: occHidden.score(), noObservation: none.score(), byCase: out };
}

function* replayBlind(session: string, rows: readonly Row[], params: ZoneFilterParams): Generator<Replayed> {
  for (const x of replay(session, rows.map((r) => ({ ...r, hydeVisible: '0' })), params)) yield x;
}

/**
 * β = P(the player does not see the Hyde | it is in the player's zone, no chase), counted on the given (training) rows.
 */
export function fitBeta(sessions: ReadonlyMap<string, Row[]>): { beta: number; rows: number } {
  let same = 0;
  let unseen = 0;
  for (const rows of sessions.values()) {
    const w = worldFor(rows[0]?.caseId ?? '');
    if (!w || w.world.zones.length === 0) continue;
    for (const r of rows) {
      if (r.hydeEmerged === '0' || r.hydeMode === 'CHASE' || r.cx === '' || r.hydeX === '') continue;
      const own = zoneIndexAt(w.world.zones, num(r.cx), num(r.cz));
      const truth = zoneIndexAt(w.world.zones, num(r.hydeX), num(r.hydeZ));
      if (own !== truth) continue;
      same++;
      if (r.hydeVisible !== '1') unseen++;
    }
  }
  return { beta: same > 0 ? Math.min(0.99, Math.max(0.01, unseen / same)) : ZONE_FILTER_DEFAULTS.beta, rows: same };
}

export const DIFFUSION_GRID = [0.0025, 0.005, 0.01, 0.02, 0.04, 0.08];
export const ALERT_FAR_GRID = [0.15, 0.3, 0.6, 1];

/** Selects (β counted; diffusion and alertFar by mean log-loss) on TRAINING sessions only. */
export function selectZoneParams(train: ReadonlyMap<string, Row[]>): {
  params: ZoneFilterParams; betaRows: number; grid: { diffusionPerS: number; alertFarLikelihood: number; logLoss: number; brier: number }[];
} {
  const { beta, rows: betaRows } = fitBeta(train);
  const grid: { diffusionPerS: number; alertFarLikelihood: number; logLoss: number; brier: number }[] = [];
  let best: ZoneFilterParams = { ...ZONE_FILTER_DEFAULTS, beta };
  let bestLL = Infinity;
  for (const d of DIFFUSION_GRID) {
    for (const a of ALERT_FAR_GRID) {
      const params: ZoneFilterParams = { ...ZONE_FILTER_DEFAULTS, beta, diffusionPerS: d, alertFarLikelihood: a };
      const acc = new Acc();
      for (const [session, rows] of train) for (const x of replay(session, rows, params)) acc.add(session, x.p, x.truth);
      const s = acc.score();
      grid.push({ diffusionPerS: d, alertFarLikelihood: a, logLoss: s.logLoss, brier: s.brier });
      if (s.logLoss < bestLL - 1e-9) {
        bestLL = s.logLoss;
        best = params;
      }
    }
  }
  return { params: { ...best, beta: r4(best.beta) }, betaRows, grid };
}

// ----------------------------------------------------------------------------------------------------- Bayesian checks

/** Scores ';'-separated posterior vectors against true indices (rows with both cells), vs the given prior vectors. */
export function scorePosteriors(items: readonly { session: string; post: number[]; truth: number; prior: number[] }[]): { posterior: ProbScore; prior: ProbScore } {
  const post = new Acc();
  const pri = new Acc();
  for (const it of items) {
    if (it.truth < 0 || it.truth >= it.post.length) continue;
    post.add(it.session, it.post, it.truth);
    pri.add(it.session, it.prior, it.truth);
  }
  return { posterior: post.score(), prior: pri.score() };
}

/** Egg + clue posterior items from rows (evaluation-only columns eggPost/eggTrue, cluePost/clueTrue). */
export function posteriorItems(rows: readonly Row[]): {
  egg: { session: string; post: number[]; truth: number; prior: number[] }[];
  clue: { session: string; post: number[]; truth: number; prior: number[] }[];
} {
  const egg: { session: string; post: number[]; truth: number; prior: number[] }[] = [];
  const clue: { session: string; post: number[]; truth: number; prior: number[] }[] = [];
  for (const r of rows) {
    const w = worldFor(r.caseId);
    if (!w) continue;
    if (r.eggPost && r.eggTrue !== '' && r.eggTrue !== undefined) {
      egg.push({ session: r.session, post: r.eggPost.split(';').map(Number), truth: Number(r.eggTrue), prior: w.world.eggSites.map((s) => s.prior) });
    }
    if (r.cluePost && r.clueTrue) {
      const posts = r.cluePost.split('|');
      const truths = r.clueTrue.split('|');
      w.world.clueSites.forEach((g, i) => {
        if (!posts[i] || truths[i] === '' || truths[i] === undefined || g.sites.length < 2) return; // single-site groups carry no uncertainty
        clue.push({ session: r.session, post: posts[i].split(';').map(Number), truth: Number(truths[i]), prior: g.sites.map((s) => s.prior) });
      });
    }
  }
  return { egg, clue };
}

/** Spawn odds at emergence (episodes.csv spawnPost / spawnTrue) vs the raw spawn weights. */
export function spawnItems(episodes: readonly Record<string, string>[]): { session: string; post: number[]; truth: number; prior: number[] }[] {
  const out: { session: string; post: number[]; truth: number; prior: number[] }[] = [];
  for (const e of episodes) {
    const w = worldFor(e.caseId ?? '');
    if (!w || !e.spawnPost || e.spawnTrue === '' || e.spawnTrue === undefined) continue;
    const total = w.world.hydeSpawns.reduce((a, s) => a + s.weight, 0) || 1;
    out.push({ session: e.session, post: e.spawnPost.split(';').map(Number), truth: Number(e.spawnTrue), prior: w.world.hydeSpawns.map((s) => s.weight / total) });
  }
  return out;
}
