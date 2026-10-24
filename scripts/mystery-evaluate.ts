// npm run mystery:evaluate [-- --data data/mystery --compare <other-model.json> --compare-label "<what it is>"
//                               --before <evaluation.json of the previous data>]
//
// Evaluates the trained artifact on the session-grouped HOLDOUT (sessions listed in data/mystery/split.json) and
//   • writes the measured metrics into src/mystery/analytics/model/mystery-model.json (`metrics`),
//   • writes data/mystery/evaluation.json (full detail incl. slices),
//   • regenerates docs/MYSTERY_MODEL_REPORT.md from these numbers (nothing is hand-typed).
// Reports: sample counts, base rate, Brier vs base-rate Brier, 10-bin calibration, log loss, AUC, the rule-based
// fallback on the same rows, extraction metrics, ETA MAE vs naive baseline, the SAME metrics per case (with per-case
// calibration; per-case baselines use that case's training base rate) and per-character / per-Pokémon / per-profile /
// per-factor sanity slices. `--compare` additionally scores another artifact on the same holdout (before/after or a
// retrained candidate); `--before` quotes the held-out metrics of an evaluation.json computed on the PREVIOUS data
// (e.g. before Joseph Crackstone joined the sim) next to this run's, so a re-evaluation is reported with real numbers.
// Overhaul: the live probability estimates are scored on the same held-out sessions — the Hyde zone filter (Brier /
// log-loss / top-1 vs the patrol-occupancy baseline and a no-observation ablation, per case, reliability bins), the spawn
// odds at emergence, and the Bayesian egg / clue posteriors vs the case priors (scripts/mystery-zones.ts).
// Enemy contract: §7 scores the RULE-BASED Joseph Crackstone risk (src/mystery/analytics/crackstoneRisk.ts) on the same
// held-out sessions — cell level from data/mystery/crackstone.jsonl (scripts/mystery-crackstone.ts: forecasts of the
// live code vs his TRUE trajectory) and player level from the rows (crackHere vs crackSeen10) — against a static
// patrol-route baseline, a constant and an in / out of his area rate (baseline rates from the TRAINING sessions).
// Simulated bots are not people — the report says so.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { featureInputFromRow, parseCsv, type Row } from '../src/mystery/analytics/dataset.ts';
import { featureVector } from '../src/mystery/analytics/features.ts';
import { brierScore, classifierMetrics, meanAbsoluteError } from '../src/mystery/analytics/metrics.ts';
import { linear, logistic, validateArtifact, type ClassifierMetrics, type ModelArtifact, type RegressionMetrics } from '../src/mystery/analytics/model.ts';
import { ruleDetection } from '../src/mystery/analytics/predictive.ts';
import { caseLabel } from '../src/mystery/analytics/caseInfo.ts';
import { CASE_IDS } from '../src/mystery/types.ts';
import { DEFAULT_TUNING } from '../src/mystery/config.ts';
import { zoneParamsFrom } from '../src/mystery/analytics/live.ts';
import { evaluateZones, groupSessions, posteriorItems, scorePosteriors, spawnItems, type ProbScore, type ZoneEvaluation } from './mystery-zones.ts';
import { addTo, emptyAcc, scoreOf, summariseCrack, type CrackEpisodeEval, type CrackSummary, type Score } from './mystery-crackstone.ts';
import { CRACK_BELIEF, CRACK_CELL_M, CRACK_HORIZON_S, CRACK_MODEL_VERSION, CRACK_STEP_S } from '../src/mystery/analytics/crackstoneRisk.ts';
import { caseWorld } from '../src/mystery/data/caseWorlds.ts';
import { pointInPolygon } from '../src/mystery/geometry.ts';
import { isCaseId as isCase } from '../src/mystery/data/cases.ts';

/** Data-driven wording of the §7 reading (no claim the numbers do not support). */
function crackReading(c: CrackSummary): string {
  const best = Math.min(c.staticRoute.brier, c.constant.brier, c.area.brier);
  const top = c.model.calibration[c.model.calibration.length - 1];
  const low = c.model.calibration[0];
  const parts: string[] = [];
  parts.push(c.model.brier < best
    ? `Reading: the cell tint has a lower Brier than every baseline (${c.model.brier.toFixed(4)} vs best baseline ${best.toFixed(4)}).`
    : `Reading: the cell tint does NOT beat the best baseline on Brier (${c.model.brier.toFixed(4)} vs ${best.toFixed(4)}).`);
  if (top.count > 0 && top.observedRate < top.meanPredicted - 0.05) {
    parts.push(`It is over-confident at the top (predicted ${top.meanPredicted.toFixed(3)}, observed ${top.observedRate.toFixed(3)}): the loop timeline cannot know when he will stop to stare, investigate or chase, so read high values as "he will very likely look here soon", not as certainty.`);
  }
  if (low.count > 0 && low.observedRate > low.meanPredicted + 0.01) {
    parts.push(`Near 0 it underestimates (predicted ${low.meanPredicted.toFixed(3)}, observed ${low.observedRate.toFixed(3)}): off-loop moves sometimes bring him to cells his route never sees.`);
  }
  return parts.join(' ');
}

/** Data-driven wording of the player-level check. */
function hereReading(h: CrackHere): string {
  const best = Math.min(h.constant.brier, h.area.brier);
  return h.model.brier < best
    ? `At the player's own spot it also beats the constant and the in / out-of-area rates (Brier ${h.model.brier.toFixed(4)} vs ${best.toFixed(4)}).`
    : `At the player's own spot it does NOT beat the simple in / out-of-area rate (Brier ${h.model.brier.toFixed(4)} vs ${best.toFixed(4)}): it answers "if you stay here", while players move — the odds row is a stand-still estimate, not a detection forecast.`;
}

/** Player-level check of forecasts.crackstone.here (rows): p at the player's spot vs a new sighting within 10 s. */
interface CrackHere { rows: number; sessions: number; model: Score; constant: { rate: number; brier: number }; area: { inRate: number; outRate: number; brier: number } }

function crackHereEval(train: Row[], test: Row[]): CrackHere | null {
  // forecast regime: he does not see / hunt the player at t (fact '' or 'hidden'); label = crackstone_sighted in (t, t + 10]
  const use = (r: Row) => r.crackHere !== undefined && r.crackHere !== '' && r.crackSeen10 !== '' && (r.crackFact === '' || r.crackFact === 'hidden');
  const inArea = (r: Row) => {
    const id = r.caseId;
    if (!isCase(id)) return false;
    const poly = caseWorld(id)?.crackstone?.polygon;
    return poly ? pointInPolygon(Number(r.cx), Number(r.cz), poly) : false;
  };
  const tr = train.filter(use);
  const te = test.filter(use);
  if (te.length === 0) return null;
  const rate = tr.length ? tr.filter((r) => r.crackSeen10 === '1').length / tr.length : 0;
  const trIn = tr.filter(inArea);
  const trOut = tr.filter((r) => !inArea(r));
  const inRate = trIn.length ? trIn.filter((r) => r.crackSeen10 === '1').length / trIn.length : rate;
  const outRate = trOut.length ? trOut.filter((r) => r.crackSeen10 === '1').length / trOut.length : rate;
  const m = emptyAcc();
  let cb = 0;
  let ab = 0;
  for (const r of te) {
    const y = Number(r.crackSeen10);
    addTo(m, Number(r.crackHere), y);
    cb += (rate - y) ** 2;
    ab += ((inArea(r) ? inRate : outRate) - y) ** 2;
  }
  return {
    rows: te.length, sessions: new Set(te.map((r) => r.session)).size, model: scoreOf(m),
    constant: { rate: r4(rate), brier: r4(cb / te.length) }, area: { inRate: r4(inRate), outRate: r4(outRate), brier: r4(ab / te.length) },
  };
}

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
}

const dataDir = resolve(arg('data', 'data/mystery'));
const MODEL_PATH = resolve('src/mystery/analytics/model/mystery-model.json');
const REPORT_PATH = resolve('docs/MYSTERY_MODEL_REPORT.md');
const comparePath = arg('compare', '');
const compareLabel = arg('compare-label', 'the artifact before this training run');
const beforePath = arg('before', '');

interface Slice { key: string; rows: number; sessions: number; baseRate: number; meanP: number; brier: number; baselineBrier: number }

const r4 = (x: number) => Math.round(x * 10000) / 10000;

function slices(rows: Row[], p: number[], y: number[], keyOf: (r: Row) => string, trainBase: number): Slice[] {
  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), i]));
  return [...groups.entries()].map(([key, idx]) => {
    const ps = idx.map((i) => p[i]);
    const ys = idx.map((i) => y[i]);
    return {
      key, rows: idx.length, sessions: new Set(idx.map((i) => rows[i].session)).size,
      baseRate: r4(ys.reduce((a, b) => a + b, 0) / ys.length), meanP: r4(ps.reduce((a, b) => a + b, 0) / ps.length),
      brier: r4(brierScore(ps, ys)), baselineBrier: r4(brierScore(ps.map(() => trainBase), ys)),
    };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

function tercile(rows: Row[], col: keyof Row): (r: Row) => string {
  const vals = [...new Set(rows.map((r) => Number(r[col])))].sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length / 3)];
  const hi = vals[Math.floor((2 * vals.length) / 3)];
  return (r) => {
    const v = Number(r[col]);
    return v < lo ? `low (< ${lo})` : v < hi ? `mid (${lo}–${hi})` : `high (≥ ${hi})`;
  };
}

function table(head: string[], body: (string | number)[][]): string {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...body.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

interface ScopeEval {
  detection: ClassifierMetrics;
  rule: ClassifierMetrics;
  extraction: ClassifierMetrics | null;
  eta: RegressionMetrics | null;
}

const naiveEta = (m: ModelArtifact, r: Row) => m.eta!.naive[`${r.caseId}:${r.objective}`] ?? m.eta!.naive[r.objective] ?? 0;

/** Held-out metrics of `model` on `test` (baselines from `train`): detection, rule fallback, extraction, ETA. */
function evaluateScope(model: ModelArtifact, train: Row[], test: Row[]): ScopeEval {
  const detTest = test.filter((r) => r.det15 !== '');
  const detTrain = train.filter((r) => r.det15 !== '');
  const trainBase = detTrain.filter((r) => r.det15 === '1').length / Math.max(1, detTrain.length);
  const inputs = detTest.map(featureInputFromRow);
  const y = detTest.map((r) => Number(r.det15));
  const sessions = new Set(detTest.map((r) => r.session)).size;
  const p = inputs.map((x) => logistic(model.detection, featureVector(model.detection.features, x)));
  const detection = classifierMetrics(p, y, sessions, trainBase);
  const rule = classifierMetrics(inputs.map((x) => ruleDetection(x).p), y, sessions, trainBase);
  let extraction: ClassifierMetrics | null = null;
  if (model.extraction) {
    const exTest = test.filter((r) => r.extraction !== '');
    const exTrain = train.filter((r) => r.extraction !== '');
    const exBase = exTrain.filter((r) => r.extraction === '1').length / Math.max(1, exTrain.length);
    const pe = exTest.map((r) => logistic(model.extraction!, featureVector(model.extraction!.features, featureInputFromRow(r))));
    extraction = classifierMetrics(pe, exTest.map((r) => Number(r.extraction)), new Set(exTest.map((r) => r.session)).size, exBase);
  }
  let eta: RegressionMetrics | null = null;
  if (model.eta) {
    const etaTest = test.filter((r) => r.eta !== '');
    const pred = etaTest.map((r) => Math.max(0, linear(model.eta!, featureVector(model.eta!.features, featureInputFromRow(r)))));
    const actual = etaTest.map((r) => Number(r.eta));
    eta = {
      rows: etaTest.length, sessions: new Set(etaTest.map((r) => r.session)).size,
      mae: r4(meanAbsoluteError(pred, actual)), naiveMae: r4(meanAbsoluteError(etaTest.map((r) => naiveEta(model, r)), actual)),
      naiveDescription: 'mean seconds-to-next-progress per (case, objective) (training set)',
    };
  }
  return { detection, rule, extraction, eta };
}

function main(): void {
  const raw = JSON.parse(readFileSync(MODEL_PATH, 'utf8')) as unknown;
  const v = validateArtifact(raw);
  if (!v.ok) throw new Error(`model artifact invalid: ${v.reason} — run npm run mystery:train first`);
  const model: ModelArtifact = v.model;
  const manifest = JSON.parse(readFileSync(join(dataDir, 'manifest.json'), 'utf8')) as Record<string, unknown> & { profiles: Record<string, number> };
  const split = JSON.parse(readFileSync(join(dataDir, 'split.json'), 'utf8')) as { key: string; testFrac: number; testSessions: string[] };
  const testSet = new Set(split.testSessions);
  const rows = parseCsv(readFileSync(join(dataDir, 'rows.csv'), 'utf8'));
  const train = rows.filter((r) => !testSet.has(r.session));
  const test = rows.filter((r) => testSet.has(r.session));
  const episodes = parseCsv(readFileSync(join(dataDir, 'episodes.csv'), 'utf8')) as unknown as Record<string, string>[];

  // ---- overall (detection, rule fallback, extraction, eta)
  const detTest = test.filter((r) => r.det15 !== '');
  const detTrain = train.filter((r) => r.det15 !== '');
  const trainBase = detTrain.filter((r) => r.det15 === '1').length / detTrain.length;
  const p = detTest.map((r) => logistic(model.detection, featureVector(model.detection.features, featureInputFromRow(r))));
  const y = detTest.map((r) => Number(r.det15));
  const overall = evaluateScope(model, train, test);
  const { detection, rule, extraction, eta } = overall;
  const pTrain = detTrain.map((r) => logistic(model.detection, featureVector(model.detection.features, featureInputFromRow(r))));
  const trainMetrics = classifierMetrics(pTrain, detTrain.map((r) => Number(r.det15)), new Set(detTrain.map((r) => r.session)).size, trainBase);

  // ---- per case (holdout rows of that case; baselines from that case's training rows)
  const caseIds = CASE_IDS.filter((id) => test.some((r) => r.caseId === id));
  const byCaseEval: Record<string, ScopeEval> = {};
  for (const id of caseIds) byCaseEval[id] = evaluateScope(model, train.filter((r) => r.caseId === id), test.filter((r) => r.caseId === id));

  // ---- optional before/after: a previous artifact scored on the same holdout
  let previous: { modelVersion: string; overall: ScopeEval; byCase: Record<string, ScopeEval> } | null = null;
  if (comparePath) {
    const pv = validateArtifact(JSON.parse(readFileSync(resolve(comparePath), 'utf8')) as unknown);
    if (!pv.ok) throw new Error(`--compare artifact invalid: ${pv.reason}`);
    const byCase: Record<string, ScopeEval> = {};
    for (const id of caseIds) byCase[id] = evaluateScope(pv.model, train.filter((r) => r.caseId === id), test.filter((r) => r.caseId === id));
    previous = { modelVersion: pv.model.modelVersion, overall: evaluateScope(pv.model, train, test), byCase };
  }

  // ---- slices (sanity, not tuning targets)
  const byCharacter = slices(detTest, p, y, (r) => r.characterId, trainBase);
  const byPokemon = slices(detTest, p, y, (r) => r.pokemonId, trainBase);
  const byProfile = slices(detTest, p, y, (r) => r.profile, trainBase);
  const byNoise = slices(detTest, p, y, tercile(detTest, 'footstepNoiseMult'), trainBase);
  const byControl = slices(detTest, p, y, (r) => `hydeControl ${r.hydeControl}`, trainBase);
  const byMode = slices(detTest, p, y, (r) => r.hydeMode, trainBase);
  const byCaseSlice = slices(detTest, p, y, (r) => r.caseId || 'legacy', trainBase);

  // ---- overhaul: live probability estimates on the holdout
  const zoneParams = zoneParamsFrom(model);
  const zoneEval: ZoneEvaluation | null = model.zoneFilter ? evaluateZones(groupSessions(test), zoneParams) : null;
  const post = posteriorItems(test);
  const eggCheck = post.egg.length ? scorePosteriors(post.egg) : null;
  const clueCheck = post.clue.length ? scorePosteriors(post.clue) : null;
  const spawnList = spawnItems(episodes.filter((e) => testSet.has(e.session)));
  const spawnCheck = spawnList.length ? scorePosteriors(spawnList) : null;

  // ---- enemy contract: the rule-based Crackstone risk (cell level + player level)
  const crackPath = join(dataDir, 'crackstone.jsonl');
  const crackAll: CrackEpisodeEval[] = existsSync(crackPath)
    ? readFileSync(crackPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as CrackEpisodeEval)
    : [];
  const crackCells: CrackSummary | null = crackAll.some((e) => testSet.has(e.session))
    ? summariseCrack(crackAll.filter((e) => testSet.has(e.session)), crackAll.filter((e) => !testSet.has(e.session)))
    : null;
  const crackHere = crackHereEval(train, test);

  // ---- optional: the held-out metrics of the PREVIOUS data's evaluation.json (re-evaluation table)
  type EvalJson = {
    modelVersion: string; evaluatedAt: string; detection: ClassifierMetrics; extraction: ClassifierMetrics | null; eta: RegressionMetrics | null;
    liveEstimates?: { zones?: ZoneEvaluation | null };
  };
  const before: EvalJson | null = beforePath && existsSync(resolve(beforePath)) ? JSON.parse(readFileSync(resolve(beforePath), 'utf8')) as EvalJson : null;

  const evaluatedAt = new Date().toISOString();
  const byCase: NonNullable<NonNullable<ModelArtifact['metrics']>['byCase']> = {};
  for (const id of caseIds) byCase[id] = { detection: byCaseEval[id].detection, extraction: byCaseEval[id].extraction, eta: byCaseEval[id].eta };
  const metrics: NonNullable<ModelArtifact['metrics']> = { evaluatedAt, detection, extraction, eta, byCase };
  const zoneFilter = model.zoneFilter
    ? { ...model.zoneFilter, metrics: { evaluatedAt, zones: zoneEval, spawn: spawnCheck, eggPosterior: eggCheck, cluePosterior: clueCheck } }
    : undefined;
  const crackstoneRisk = crackCells || crackHere ? {
    method: 'rule_based', label: 'Rule-based estimate', modelVersion: CRACK_MODEL_VERSION, horizonS: CRACK_HORIZON_S, cellM: CRACK_CELL_M, stepS: CRACK_STEP_S,
    belief: CRACK_BELIEF, metrics: { evaluatedAt, cells: crackCells, here: crackHere },
  } : undefined;
  writeFileSync(MODEL_PATH, `${JSON.stringify({ ...model, ...(zoneFilter ? { zoneFilter } : {}), ...(crackstoneRisk ? { crackstoneRisk } : {}), metrics }, null, 1)}\n`);
  writeFileSync(join(dataDir, 'evaluation.json'), `${JSON.stringify({
    evaluatedAt, modelVersion: model.modelVersion, detection, detectionTrain: trainMetrics, ruleBasedOnHoldout: rule, extraction, eta,
    byCase: byCaseEval,
    previous,
    liveEstimates: { zones: zoneEval, spawn: spawnCheck, eggPosterior: eggCheck, cluePosterior: clueCheck, crackstone: { cells: crackCells, here: crackHere } },
    slices: { byCase: byCaseSlice, byCharacter, byPokemon, byProfile, byFootstepNoise: byNoise, byHydeControl: byControl, byHydeMode: byMode },
  }, null, 1)}\n`);

  // ---- top coefficients
  const coefs = model.detection.features.map((f, i) => ({ f, w: model.detection.coef[i + 1] }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 12);

  // ---- episode outcomes
  const outcome = (o: string) => episodes.filter((e) => e.outcome === o).length;
  const testEps = episodes.filter((e) => testSet.has(e.session));
  const sliceTable = (s: Slice[]) => table(['slice', 'rows', 'sessions', 'base rate', 'mean p', 'Brier', 'baseline Brier'],
    s.map((x) => [x.key, x.rows, x.sessions, x.baseRate.toFixed(3), x.meanP.toFixed(3), x.brier.toFixed(4), x.baselineBrier.toFixed(4)]));
  const f4 = (x: number | null) => (x === null ? 'n/a' : x.toFixed(4));
  const manifestCases = (manifest as { cases?: Record<string, { episodes: number; finished: number; dnf: number; timedOut: number; solved: number; allClues: number; rows: number }> }).cases ?? {};
  const caseRows = caseIds.map((id) => {
    const e = byCaseEval[id];
    const prev = previous?.byCase[id];
    return [
      caseLabel(id), e.detection.sessions, e.detection.rows, e.detection.baseRate.toFixed(3),
      e.detection.brier.toFixed(4), e.detection.baselineBrier.toFixed(4), e.rule.brier.toFixed(4), f4(e.detection.auc),
      ...(previous ? [prev ? `${prev.detection.brier.toFixed(4)} / ${f4(prev.detection.auc)}` : 'n/a'] : []),
    ];
  });
  const caseSecondary = caseIds.map((id) => {
    const e = byCaseEval[id];
    const prev = previous?.byCase[id];
    return [
      caseLabel(id),
      e.extraction ? `${e.extraction.brier.toFixed(4)} / ${e.extraction.baselineBrier.toFixed(4)} (base ${e.extraction.baseRate.toFixed(3)})` : 'n/a',
      e.eta ? `${e.eta.mae.toFixed(2)} / ${e.eta.naiveMae.toFixed(2)}` : 'n/a',
      ...(previous ? [prev ? `${prev.extraction ? prev.extraction.brier.toFixed(4) : 'n/a'} · ${prev.eta ? prev.eta.mae.toFixed(2) : 'n/a'}` : 'n/a'] : []),
    ];
  });
  const caseCalibration = caseIds.map((id) => `#### ${caseLabel(id)}

${table(['bin', 'rows', 'mean predicted', 'observed rate'], byCaseEval[id].detection.calibration.map((c) => [
    `${c.lower.toFixed(1)}–${c.upper.toFixed(1)}`, c.count, c.count ? c.meanPredicted.toFixed(3) : '—', c.count ? c.observedRate.toFixed(3) : '—',
  ]))}`).join('\n\n');
  const weakExtraction = caseIds.filter((id) => {
    const ex = byCaseEval[id].extraction;
    return ex !== null && ex.brier >= ex.baselineBrier;
  }).map((id) => caseLabel(id));
  const caseData = caseIds.map((id) => {
    const c = manifestCases[id];
    return c ? [caseLabel(id), c.episodes, `${c.finished} / ${c.dnf} / ${c.timedOut}`, c.solved, c.allClues, c.rows] : [caseLabel(id), '—', '—', '—', '—', '—'];
  });

  const ps = (x: ProbScore) => [x.rows, x.sessions, x.brier.toFixed(4), x.logLoss.toFixed(4), x.top1.toFixed(3)];
  const relTable = (x: ProbScore) => table(['bin', 'candidates', 'mean predicted', 'observed rate'], x.calibration.map((c) => [
    `${c.lower.toFixed(1)}–${c.upper.toFixed(1)}`, c.count, c.count ? c.meanPredicted.toFixed(3) : '—', c.count ? c.observedRate.toFixed(3) : '—',
  ]));
  const zp = model.zoneFilter?.params ?? zoneParams;
  const liveSection = `## 6. Live probability estimates (overhaul) — held-out sessions

All estimates below are computed in the live game from PUBLIC information only (case-world priors, what the player has
observed, the HUD-visible Hyde mode and — only while the player can see it — the Hyde's position). The hidden truth (the
session's clue / egg sites, the Hyde's position while unseen) is used **only here, to score them**. Multi-class Brier =
Σ_i (p_i − y_i)² per prediction (0 best, 2 worst); log-loss = −ln p(true); top-1 = the most probable candidate was the
true one. Holdout = the same session-grouped split as above.

### 6.1 Hyde zone filter (after emergence) — \`src/mystery/analytics/hydeZones.ts\`

Discrete hidden Markov model over the case's zones, stepped at 1 Hz (the live cadence). Transitions: a continuous-time
Markov chain from the patrol loop (rate i → j = loop transitions i → j ÷ time the loop spends in zone i at
${DEFAULT_TUNING.hyde.speed.PATROL} m/s; its stationary distribution is the patrol occupancy) + diffusion d to every adjacent zone
(+ ${zp.offPatrolReturnPerS.toFixed(3)}/s out of zones the loop never enters). Observations: Hyde visible → collapse to its zone; CHASE →
zones within ${zp.chaseNearM} m of the player (others × ${zp.chaseFarLikelihood}); INVESTIGATE / SEARCH → zones within ${zp.alertNearM} m (others ×
${zp.alertFarLikelihood}); otherwise the player's own zone × β. Prior at emergence = the exact spawn odds (6.2). Parameters selected on
the TRAINING sessions only: **β = ${zp.beta}** (P(not seeing the Hyde | it is in the player's zone, no chase), counted over
${model.zoneFilter?.betaRows ?? 'n/a'} training rows), **d = ${zp.diffusionPerS}/s**, alertFar = ${zp.alertFarLikelihood} (grid by mean training log-loss).

${zoneEval ? `${table(['estimate (holdout)', 'rows', 'sessions', 'Brier', 'log-loss', 'top-1'], [
    ['zone filter — all emerged rows', ...ps(zoneEval.all)],
    ['patrol-occupancy baseline — same rows', ...ps(zoneEval.occupancy)],
    ['no-observation ablation (prior + patrol only)', ...ps(zoneEval.noObservation)],
    ['zone filter — Hyde NOT visible', ...ps(zoneEval.hidden)],
    ['patrol-occupancy — Hyde NOT visible', ...ps(zoneEval.occupancyHidden)],
  ])}

Per case (all emerged rows): ${Object.entries(zoneEval.byCase).map(([id, c]) => `${caseLabel(id as never)} — filter Brier ${c.all.brier.toFixed(4)} / log-loss ${c.all.logLoss.toFixed(4)} vs occupancy ${c.occupancy.brier.toFixed(4)} / ${c.occupancy.logLoss.toFixed(4)}`).join('; ')}.

Reliability of the zone probabilities (every zone of every holdout row):

${relTable(zoneEval.all)}` : 'Not evaluated (no zone filter in the artifact).'}

### 6.2 Hyde spawn odds (before emergence) — the sim's exact rule

${spawnCheck ? `${table(['estimate (holdout, at emergence)', 'episodes', 'sessions', 'Brier', 'log-loss', 'top-1'], [
    ['spawn rule from the last pre-emergence sample', ...ps(spawnCheck.posterior)],
    ['raw spawn weights (ignores the distance rule)', ...ps(spawnCheck.prior)],
  ])}

The rule is the sim's own draw rule, so p(true spawn) > 0 unless the player crossed the ${DEFAULT_TUNING.hyde.minSpawnM} m boundary in the last second.` : 'No emergence spawns in the holdout (pre-overhaul data).'}

### 6.3 Egg-site and clue-site posteriors — exact Bayes (\`src/mystery/analytics/bayes.ts\`)

${eggCheck || clueCheck ? table(['estimate (holdout rows)', 'predictions', 'sessions', 'Brier', 'log-loss', 'top-1'], [
    ...(eggCheck ? [['egg posterior (priors × traces × searched spots)', ...ps(eggCheck.posterior)], ['egg prior only', ...ps(eggCheck.prior)]] : []),
    ...(clueCheck ? [['clue-site posterior (multi-site groups)', ...ps(clueCheck.posterior)], ['clue prior only', ...ps(clueCheck.prior)]] : []),
  ]) : 'No posterior columns in the data (pre-overhaul data or a single-site case world).'}
${eggCheck ? `
Reliability of the egg posterior (every candidate site of every holdout row while the egg was not carried):

${relTable(eggCheck.posterior)}` : ''}

These posteriors are exact under the sim's rules (trace accuracy a, certain detection within siteCheckM); the table is an
empirical check that the implementation matches the mechanics, not a fitted model.

### 6.4 Live messages and advice (rules, not models)

- **Descriptive (Thing's Log)** — exact event counts: "2 of 3 clues found.", "Hyde lost you. Escapes: 1.", "Egg secured.",
  "Hidden passage open.", "Not here. Odds updated." (≤ 34 chars, ≥ 2.5 s apart).
- **Diagnostic (WHY)** — \`basis: 'rule'\` only for a recorded rule transition: \`hyde_mode … heard_noise\` + the \`hyde_heard\`
  source at that instant + the stance / noisy floor at the noise position; \`saw_player\` → CHASE; \`stunned\` / \`lured\`
  reasons; a chase lost ≤ 5 s after the player's own lure / distract / stun; a chase lost while hidden; egg damage /
  drop causes; \`hazard_triggered\`; a found clue naming suspects (public \`mentions\` count — never a name, never the
  answer key). \`basis: 'pattern'\` = a labelled co-occurrence ("2 of 3 alerts came while sprinting. Not proof."), ≤ 1
  per run, never during a threat. Limits: body ≤ 48 chars, ≥ 8 s apart (P5 exempt), the same code ≥ 45 s apart, ≤ 3 /min.
- **Prescriptive (Thing's advice)** — a deterministic rule-based decision engine over FEASIBLE actions only (the duo's own
  ready abilities chosen by effect kind, reachable targets, uncollected clues), using the posteriors above for search
  targets, the zone filter for detours ("Go around via the …" / "Stay quiet. Hyde nearby."), noise, HP, catches and the
  carried egg. Automatic advice ≥ 12 s apart, the same action not within 30 s; the hint ladder (V / idle timer) gives the
  case's area line → the most probable area (target) → the most probable candidate site (target; "may be wrong").
- **Joseph Crackstone** (headword CRACKSTONE) — LOG: "Crackstone lost you. Escapes: n."; WHY (rule): chase start by sight
  (distance + stance, "in the open"), proximity or scan ("crouching does not hide you") at P5, a landed curse ("you stayed
  in the ring") at P5, escapes (a wall broke his line of sight / hiding / out of his sight range / out of his cursed area),
  dodged / blocked curses and the first covered scan ("Walls and hiding spots block scans.") at P3, his stun / lure by the
  player's own ability (POWER STATUS). Advice: step out of the curse ring / the nearest covered point before a scan pulse
  (reachable at sprint speed in the time left; never "crouch"), break his line of sight, hide, leave his leash disc, a
  power that can hit him now, avoid his sight lines when the §7 risk at your spot is ≥ 50% and the objective lies
  elsewhere. Scan / curse warnings never enter the stream (HUD banners); a deferral to the Hyde says nothing; a CRACKSTONE
  P5 ≤ 1 per 20 s and never ahead of a waiting HYDE ALERT; Hyde + Crackstone items ≤ 4 per minute; the area intro (P2)
  once ~3 s after play starts.`;

  const sc = (x: Score) => [x.n, x.meanP.toFixed(3), x.baseRate.toFixed(3), x.brier.toFixed(4), x.logLoss.toFixed(4)];
  const binTable = (x: Score, unit: string) => table(['bin', unit, 'mean predicted', 'observed rate'], x.calibration.map((c) => [
    `${c.lower.toFixed(1)}–${c.upper.toFixed(1)}`, c.count, c.count ? c.meanPredicted.toFixed(3) : '—', c.count ? c.observedRate.toFixed(3) : '—',
  ]));
  const crackManifest = (manifest as { crackstone?: Record<string, number> }).crackstone;
  const crackSection = `## 7. Joseph Crackstone risk — rule-based estimate (not ML) — held-out sessions

\`forecasts.crackstone\` (\`src/mystery/analytics/crackstoneRisk.ts\`, live glue \`crackstoneLive.ts\`) is a **rule-based
estimate**: nothing is trained. For every ${CRACK_CELL_M} m cell of his leash disc it states p = P(Crackstone can see a standing,
not hidden player at the cell within the next ${CRACK_HORIZON_S} s), from public knowledge only — his public patrol loop walked on his
nav grid at his patrol speed with a look-around pause at every waypoint (a ${CRACK_STEP_S} s loop timeline), his actual sight rules
(\`sight.ts canSee\` with his own cone / range / fog, walls + high cover, proximity all around) and his scan rule (radius, line
of sight, crouching does not help; schedule from his public telegraphs, none while the Hyde chases — R6). A belief over the
loop phase starts uniform, collapses on a public sighting (position + facing, σ = ${CRACK_BELIEF.sightSigmaM} m), is down-weighted (× ${CRACK_BELIEF.unseenLikelihood})
where the player would see him but does not, advances at his pace (frozen during a scan warning), spreads a little and
relaxes to uniform over about one loop. Known non-patrol modes from the HUD: CHASE / ATTACK (position public) → his cone
toward the player; INVESTIGATE / SEARCH → a search disc (his searchRadiusM) around where he last saw the player (or the
decoy), ${CRACK_BELIEF.searchLooks} looks each covering ≈ ${Math.round(CRACK_BELIEF.lookCover * 100)}% of the circle; RETURN → the belief restarted at the waypoint he walks back
to. \`here\` uses the player's exact spot and stance (crouched → his ×${DEFAULT_TUNING.crackstone.sight.crouchRangeMult} range and low cover; hidden → only within the
spot's reveal distance, never a scan). The constants above are design choices, not fitted to these data.

**Truth (evaluation only).** Per cell: 1 iff at some instant of (t, t + ${CRACK_HORIZON_S} s] his ACTUAL perception (true position,
facing, mode; not stunned / lured) would see a standing player there, or one of his scan pulses covers it — sampled every
0.25 s + at every pulse (\`scripts/mystery-crackstone.ts\`). Samples whose window passes the end of the run are dropped.
Baselines: the static patrol route (uniform phase, no observations, an average scan chance), a constant rate and an
in / out of his cursed area rate — both rates from the TRAINING sessions.

${crackManifest ? `Episodes with Crackstone: ${crackManifest.episodes} · encounters ${crackManifest.encounters} · escapes ${crackManifest.escapes} · scans ${crackManifest.scans} (hit ${crackManifest.scanHits}) · curses cast ${crackManifest.cursesCast} / landed ${crackManifest.cursesHit} / missed ${crackManifest.cursesDodged} · deferrals to a Hyde chase ${crackManifest.deferrals} (all episodes, bots).` : ''}

### 7.1 Cell level (the minimap tint)

${crackCells ? `${table(['estimate (holdout)', 'cell forecasts', 'mean p', 'observed rate', 'Brier', 'log-loss'], [
    ['rule-based risk (live code)', ...sc(crackCells.model)],
    ['static patrol-route baseline', ...sc(crackCells.staticRoute)],
  ])}

${table(['baseline (rates from training sessions)', 'rate', 'Brier (holdout)'], [
    ['constant', crackCells.constant.rate.toFixed(3), crackCells.constant.brier.toFixed(4)],
    ['area occupancy (in / out of his cursed area)', `${crackCells.area.inRate.toFixed(3)} / ${crackCells.area.outRate.toFixed(3)}`, crackCells.area.brier.toFixed(4)],
  ])}

${crackCells.sessions} held-out sessions, ${crackCells.samples} samples. Per case: ${Object.entries(crackCells.byCase).map(([id, c]) => `${caseLabel(id as never)} — Brier ${c.model.brier.toFixed(4)} vs static ${c.staticRoute.brier.toFixed(4)} / constant ${c.constantBrier.toFixed(4)} / area ${c.areaBrier.toFixed(4)}`).join('; ')}.
By basis (what the forecast was computed from): ${Object.entries(crackCells.byBasis).map(([k, b]) => `${k} — ${b.n} cell forecasts, mean p ${b.meanP.toFixed(3)} vs observed ${b.baseRate.toFixed(3)}, Brier ${b.brier.toFixed(4)}`).join('; ')}.

Reliability (every cell of every held-out sample):

${binTable(crackCells.model, 'cell forecasts')}` : 'Not evaluated (no data/mystery/crackstone.jsonl — regenerate with mystery:generate).'}

### 7.2 Player level (\`here\`, the odds row)

${crackHere ? `The forecast at the player's own spot while he does not see / hunt them, against a NEW detection
(\`crackstone_sighted\`: sight, proximity or scan) within ${CRACK_HORIZON_S} s. The forecast assumes the player stays where they are; the bots
move, so this is a usefulness check, not the quantity the estimate is defined for.

${table(['estimate (holdout rows)', 'rows', 'mean p', 'observed rate', 'Brier', 'log-loss'], [['rule-based here.p', ...sc(crackHere.model)]])}

Baselines (training rates): constant ${crackHere.constant.rate.toFixed(3)} → Brier ${crackHere.constant.brier.toFixed(4)}; in / out of his area ${crackHere.area.inRate.toFixed(3)} / ${crackHere.area.outRate.toFixed(3)} → Brier ${crackHere.area.brier.toFixed(4)}. ${crackHere.rows} rows, ${crackHere.sessions} sessions.

${binTable(crackHere.model, 'rows')}` : 'Not evaluated (no crackHere columns).'}

${crackCells ? crackReading(crackCells) : ''} ${crackHere ? hereReading(crackHere) : ''} It is labelled "Rule-based estimate" everywhere and never called ML.`;

  const zb = before?.liveEstimates?.zones ?? null;
  const beforeSection = before ? `
### Re-evaluation after the enemy contract (Joseph Crackstone in every case)

The episodes were regenerated (\`${String(manifest.generator)}\`: Crackstone patrols, scans and curses in all three cases; bots react to
him; the Hyde itself is unchanged except rule R6). The detection model's inputs did not change (no Crackstone column is a
feature; its label stays the Hyde's chase / catch). Held-out numbers, same seeds and split:

${table(['metric (holdout)', `previous data — \`${before.modelVersion}\``, `regenerated data — \`${model.modelVersion}\` (this report)`, ...(previous ? [`regenerated data — \`${previous.modelVersion}\` (${compareLabel})`] : [])], [
    ['detection Brier / baseline', `${before.detection.brier.toFixed(4)} / ${before.detection.baselineBrier.toFixed(4)}`, `${detection.brier.toFixed(4)} / ${detection.baselineBrier.toFixed(4)}`, ...(previous ? [`${previous.overall.detection.brier.toFixed(4)} / ${previous.overall.detection.baselineBrier.toFixed(4)}`] : [])],
    ['detection Brier skill', before.detection.brierSkill.toFixed(4), detection.brierSkill.toFixed(4), ...(previous ? [previous.overall.detection.brierSkill.toFixed(4)] : [])],
    ['detection AUC', f4(before.detection.auc), f4(detection.auc), ...(previous ? [f4(previous.overall.detection.auc)] : [])],
    ['detection log loss', before.detection.logLoss.toFixed(4), detection.logLoss.toFixed(4), ...(previous ? [previous.overall.detection.logLoss.toFixed(4)] : [])],
    ['extraction Brier / baseline', before.extraction ? `${before.extraction.brier.toFixed(4)} / ${before.extraction.baselineBrier.toFixed(4)}` : 'n/a', extraction ? `${extraction.brier.toFixed(4)} / ${extraction.baselineBrier.toFixed(4)}` : 'n/a', ...(previous ? [previous.overall.extraction ? `${previous.overall.extraction.brier.toFixed(4)} / ${previous.overall.extraction.baselineBrier.toFixed(4)}` : 'n/a'] : [])],
    ['ETA MAE / naive (s)', before.eta ? `${before.eta.mae.toFixed(2)} / ${before.eta.naiveMae.toFixed(2)}` : 'n/a', eta ? `${eta.mae.toFixed(2)} / ${eta.naiveMae.toFixed(2)}` : 'n/a', ...(previous ? [previous.overall.eta ? `${previous.overall.eta.mae.toFixed(2)} / ${previous.overall.eta.naiveMae.toFixed(2)}` : 'n/a'] : [])],
    ['zone filter Brier / occupancy', zb ? `${zb.all.brier.toFixed(4)} / ${zb.occupancy.brier.toFixed(4)}` : 'n/a', zoneEval ? `${zoneEval.all.brier.toFixed(4)} / ${zoneEval.occupancy.brier.toFixed(4)}` : 'n/a', ...(previous ? ['(same filter family; see §6.1)'] : [])],
  ])}
` : '';

  const md = `# Mystery predictive model — evaluation report

> **Generated by \`npm run mystery:evaluate\` on ${evaluatedAt}.** Do not edit by hand; every number below is computed
> from \`data/mystery/\` and \`src/mystery/analytics/model/mystery-model.json\` (model \`${model.modelVersion}\`).
> **All data are simulated episodes played by scripted bots on the real game simulation — not real players.**

## 1. What is predicted

| Target | Definition | Model |
|---|---|---|
| **Detection within 15 s** (required) | For a 1 Hz snapshot at time *t* in which the Hyde is **not** already chasing: 1 iff a \`hyde_mode\` transition into \`CHASE\` or a \`catch\` event occurs in (t, t + 15 s]. Snapshots during a chase are excluded (detection is already happening; the HUD shows it as "detected now", p = 1). Snapshots of timed-out bots within 15 s of their end are dropped (right-censored). | Logistic regression, L2 (λ = ${model.training.l2}), IRLS — \`src/analytics/regression.ts\` |
| Extraction success (second) | 1 iff the episode ends with the egg delivered at Iago Tower (outcome \`finished\`). Per-row label, constant within a session. | Logistic regression, L2 (λ = ${model.training.l2Extraction ?? model.training.l2}${model.training.l2ExtractionSelection ? `, chosen by ${model.training.l2ExtractionSelection}` : ''}) |
| ETA (optional regression) | Seconds from *t* to the next progress event (\`clue_found\`, \`egg_pickup\`, \`egg_delivered\`). | OLS vs a naive per-(case, objective) mean |

Features (${model.detection.features.length}) use only information available at *t*: the StateSnapshot (Hyde distance, mode, occlusion,
suspicion, own stance / speed / hidden / recent noise, HP, catches, egg state and security, clue count **divided by the
case's own clue count**, objective, room, F/Q readiness), the previous snapshot's Hyde distance (approach), perceivable
context (Hyde facing, fog, nearest hiding spot, whether the Hyde is stunned / lured / distracted), \`case_<id>\`
indicators for the case being played (each case places its three clues and the egg differently on the shared island)
and the duo's **numbers** (PlayMods, derived card stats, whether its own F/Q carry control or escape effect kinds). No
character or Pokémon id is a feature and nothing reads the case's answer key (culprit / supporting evidence).
Definitions live in \`src/mystery/analytics/labels.ts\` and \`features.ts\` and are shared by generation, training,
evaluation and the live game. Enemy contract: the episodes now include Joseph Crackstone in every case; the rows record
his snapshot columns (present / mode / distance / occlusion / visibility / suspicion) but the detection model stays **about
the Hyde** — its label is the Hyde's chase / catch only and no Crackstone column is a feature (his risk is §7).

## 2. Data

${table(['item', 'value'], [
    ['generator', String(manifest.generator)],
    ['episodes', String(manifest.episodes)],
    ['duos covered', `${manifest.duos} (all character × Pokémon pairs), ${manifest.perDuo} episodes each`],
    ['seed pattern', `\`${String(manifest.seedPattern)}\``],
    ['case assignment', `\`${String((manifest as { caseAssignment?: string }).caseAssignment ?? 'single case (legacy)')}\` — every duo plays each case equally often; profile family × case balanced`],
    ['outcomes', `finished ${outcome('finished')} · DNF ${outcome('dnf')} · timed out ${outcome('timeout')}`],
    ['snapshot rows', String(manifest.rows)],
    ['detection rows (not chased, not censored)', String(manifest.detectionRows)],
    ['detection positives', String(manifest.detectionPositives)],
    ['profile mix', Object.entries(manifest.profiles).map(([k, n]) => `${k} ${n}`).join(' · ')],
  ])}

Every row of \`rows.csv\` and \`episodes.csv\` carries \`caseId\`, \`caseVersion\` and the case's clue count
(\`clueTotal\`); \`episodes.csv\` also records the verdict, \`correct\` (culprit named), \`deductionCorrect\` (cited
evidence exactly the case's supporting evidence) and the accusation outcome — never who was accused.

Per case (episodes · finished / DNF / timed out · case solved · all clues found · snapshot rows):

${caseData.length ? table(['case', 'episodes', 'finished / DNF / timeout', 'case solved', 'all clues', 'rows'], caseData) : 'No case ids in the data (legacy single-case data).'}

Profiles (\`src/mystery/analytics/profiles.ts\`): stealthy, stealthy + abilities, light sprinter (sprint p 0.15–0.4), heavy
sprinter (0.55–0.85), mixed visitor (random crouch / hide / ability habits) and semi-careful; start delay, clue order,
decision rate and accusation policy are seeded per episode.

## 3. Split

${model.training.split}. Train: ${model.training.sessionsTrain} sessions / ${detTrain.length} detection rows. Holdout:
${model.training.sessionsTest} sessions (${testEps.length} episodes) / ${detTest.length} detection rows. No session appears in both.

## 4. Held-out results — detection within 15 s

${table(['metric', 'model', 'base-rate baseline', 'rule-based fallback'], [
    ['rows / sessions', `${detection.rows} / ${detection.sessions}`, '', ''],
    ['positives (base rate)', `${detection.positives} (${detection.baseRate.toFixed(4)})`, `predicts ${detection.trainBaseRate.toFixed(4)} (train rate)`, ''],
    ['Brier score (lower is better)', detection.brier.toFixed(4), detection.baselineBrier.toFixed(4), rule.brier.toFixed(4)],
    ['Brier skill vs baseline', detection.brierSkill.toFixed(4), '0', rule.brierSkill.toFixed(4)],
    ['log loss', detection.logLoss.toFixed(4), detection.baselineLogLoss.toFixed(4), rule.logLoss.toFixed(4)],
    ['ROC AUC', f4(detection.auc), '0.5', f4(rule.auc)],
  ])}

Training-set fit for reference: Brier ${trainMetrics.brier.toFixed(4)} (baseline ${trainMetrics.baselineBrier.toFixed(4)}), AUC ${f4(trainMetrics.auc)}.

### Per case (holdout)

Each case is evaluated on its own holdout sessions. The base-rate baseline here predicts **that case's** training base
rate (a slightly stronger baseline than the pooled one).${previous ? ` "Previous" = \`${previous.modelVersion}\` (${compareLabel}) scored on the same rows.` : ''}

${caseRows.length ? table(['case', 'sessions', 'rows', 'base rate', 'Brier', 'baseline Brier', 'rule Brier', 'AUC', ...(previous ? ['previous Brier / AUC'] : [])], caseRows) : 'No case ids in the holdout.'}

${caseSecondary.length ? table(['case', 'extraction Brier / baseline', 'ETA MAE / naive (s)', ...(previous ? ['previous extraction Brier · ETA MAE'] : [])], caseSecondary) : ''}
${previous ? `
"Previous" (${compareLabel}) on the pooled holdout: detection Brier ${previous.overall.detection.brier.toFixed(4)} (AUC ${f4(previous.overall.detection.auc)}), extraction Brier ${previous.overall.extraction ? previous.overall.extraction.brier.toFixed(4) : 'n/a'}, ETA MAE ${previous.overall.eta ? previous.overall.eta.mae.toFixed(2) : 'n/a'} s.
` : ''}${beforeSection}
### Per-case calibration (10 equal-width bins, holdout)

${caseCalibration}

### Calibration (10 equal-width bins, holdout, all cases)

${table(['bin', 'rows', 'mean predicted', 'observed rate'], detection.calibration.map((c) => [
    `${c.lower.toFixed(1)}–${c.upper.toFixed(1)}`, c.count, c.count ? c.meanPredicted.toFixed(3) : '—', c.count ? c.observedRate.toFixed(3) : '—',
  ]))}

### Largest standardised coefficients (log-odds per 1 SD)

${table(['feature', 'coefficient'], coefs.map((c) => [`\`${c.f}\``, c.w.toFixed(3)]))}

## 5. Extraction success and ETA

${extraction ? table(['metric', 'value'], [
    ['rows / sessions', `${extraction.rows} / ${extraction.sessions}`],
    ['base rate (holdout)', extraction.baseRate.toFixed(4)],
    ['Brier (model / base-rate baseline)', `${extraction.brier.toFixed(4)} / ${extraction.baselineBrier.toFixed(4)}`],
    ['AUC', f4(extraction.auc)],
  ]) : 'Not trained.'}

Extraction outcomes are per session, so its effective sample size is the number of holdout sessions, not rows; with few
DNFs among bots the estimate is weak and is shown only on Laptop 1 as a secondary figure.${weakExtraction.length ? ` Per case it does **not** beat that case's own base-rate baseline for ${weakExtraction.join(' and ')} (see §4 per case) — treat it as a rough indicator.` : ''}

${eta ? table(['metric', 'value'], [
    ['rows / sessions', `${eta.rows} / ${eta.sessions}`],
    ['MAE model (s)', eta.mae.toFixed(2)],
    [`MAE naive (${eta.naiveDescription})`, eta.naiveMae.toFixed(2)],
  ]) : 'Not trained.'}

${liveSection}

${crackSection}

## 8. Sanity slices (holdout, detection)

Slices check that the model behaves sensibly for every character and Pokémon factor; they are not targets and the
model does not use ids. Small slices are noisy.

### By case
${sliceTable(byCaseSlice)}

### By character
${sliceTable(byCharacter)}

### By Pokémon partner
${sliceTable(byPokemon)}

### By behaviour profile
${sliceTable(byProfile)}

### By footstep-noise multiplier (duo factor, terciles)
${sliceTable(byNoise)}

### By Hyde-control card stat (duo factor)
${sliceTable(byControl)}

### By Hyde mode at t
${sliceTable(byMode)}

## 9. Limitations

- **Simulated bots ≠ people.** Episodes come from scripted autopilots (\`src/mystery/bot.ts\`) that read the Hyde's
  position and mode perfectly, react instantly and follow fixed rules. Real visitors hesitate, explore, misread the HUD
  and learn; their detection rates and the relationship between features and detection can differ substantially.
  The metrics above validate the model **on simulated data only**. Live forecasts are stored separately
  (\`mystery_forecasts\`) and compared with live outcomes on Laptop 1 as an observational check.
- Three cases share one island and one Hyde patrol; they differ in where the clues and the egg lie (and room names).
  The per-case rows show the model is usable for each layout; a NEW case (or moved clues / egg) needs regenerated
  data and retraining. Case content changes bump \`CaseDef.version\`, which the data rows record.
- The label depends on the current sim tuning (\`mystery-v3.1\`); any tuning change requires
  \`npm run mystery:generate && npm run mystery:train && npm run mystery:evaluate\`.
- Rows within an episode are correlated (1 Hz samples of the same run); the session-grouped split prevents leakage
  between train and test, but row counts overstate the effective sample size.
- Logistic regression is linear in its (engineered) features; interactions beyond those engineered are not modelled.
- The extraction label is constant within a session and bots rarely fail, so its estimate is weak.
- The Crackstone risk (§7) is a rule-based estimate measured against the bots' episodes; bots react to his telegraphs
  instantly${crackManifest ? ` (${crackManifest.cursesHit} of ${crackManifest.cursesCast} curses landed on a bot)` : ''}, so real visitors will meet more curses and scan hits.
- The HUD shows the probability with a band and the label "ML estimate"; if the artifact is missing or invalid it shows
  "Rule-based risk estimate" (formula in \`src/mystery/analytics/predictive.ts\`) and never claims to be trained.

## 10. Reproduce

\`\`\`
npm run mystery:generate   # data/mystery/rows.csv, episodes.csv, manifest.json (gitignored, deterministic)
npm run mystery:train      # src/mystery/analytics/model/mystery-model.json + data/mystery/split.json
npm run mystery:evaluate   # metrics into the artifact, data/mystery/evaluation.json, this report (incl. §7 from crackstone.jsonl)
\`\`\`
`;
  writeFileSync(REPORT_PATH, md);
  console.log(`mystery:evaluate — holdout ${detection.rows} rows / ${detection.sessions} sessions`);
  console.log(`  detection: base rate ${detection.baseRate}, Brier ${detection.brier} vs baseline ${detection.baselineBrier} (rule ${rule.brier}), log loss ${detection.logLoss}, AUC ${detection.auc}`);
  for (const id of caseIds) {
    const e = byCaseEval[id];
    console.log(`  ${id}: detection Brier ${e.detection.brier} vs ${e.detection.baselineBrier} (AUC ${e.detection.auc}, ${e.detection.sessions} sessions)` +
      `${e.extraction ? ` · extraction ${e.extraction.brier} vs ${e.extraction.baselineBrier}` : ''}${e.eta ? ` · eta MAE ${e.eta.mae} vs ${e.eta.naiveMae}` : ''}` +
      `${previous?.byCase[id] ? ` · previous detection ${previous.byCase[id].detection.brier} (AUC ${previous.byCase[id].detection.auc})` : ''}`);
  }
  if (extraction) console.log(`  extraction: base rate ${extraction.baseRate}, Brier ${extraction.brier} vs ${extraction.baselineBrier}, AUC ${extraction.auc}`);
  if (eta) console.log(`  eta: MAE ${eta.mae} s vs naive ${eta.naiveMae} s`);
  console.log(`  wrote ${MODEL_PATH} (metrics), ${join(dataDir, 'evaluation.json')}, ${REPORT_PATH}`);
}

main();
