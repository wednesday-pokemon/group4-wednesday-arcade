// npm run mystery:train [-- --data data/mystery --l2 0.0001 --test-frac 0.2]
//
// Trains the predictive models on the SIMULATED episodes from `mystery:generate`, with a SESSION-GROUPED split: every
// episode (session = seed) lands entirely in train or entirely in test (keyed hash of the seed), so no session leaks.
//   detection  — logistic regression (L2, IRLS), target "detected within 15 s" (src/mystery/analytics/labels.ts)
//   extraction — logistic regression, target "egg delivered this run"
//   eta        — OLS, seconds to the next progress event, with a naive per-(case, objective) mean baseline
// The data cover all three cases; features add `case_<id>` indicators (the per-case layout: where the clues and the
// egg lie) and normalise the clue count by the case's own clue count. The answer key is never a feature.
//   zone filter — (overhaul) the Hyde-zone HMM's β is COUNTED and its diffusion / alertFar rates are SELECTED by mean
//                 log-loss on the TRAINING sessions only (scripts/mystery-zones.ts); the holdout scores it in evaluate
// Detection rows exist only after the Hyde emerged (labels.ts / dataset.ts); `hydeVisible` (public) is a feature.
// Writes src/mystery/analytics/model/mystery-model.json (metrics: null until `mystery:evaluate`) and data/mystery/split.json.
import { MYSTERY_RULES_VERSION } from '../src/mystery/types.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fitLogistic, fitOls } from '../src/analytics/regression.ts';
import { prfUniform } from '../src/mystery/prf.ts';
import { featureInputFromRow, parseCsv, type Row } from '../src/mystery/analytics/dataset.ts';
import { BASE_FEATURE_NAMES, ETA_EXTRA, featureVector } from '../src/mystery/analytics/features.ts';
import { DETECTION_HORIZON_S } from '../src/mystery/analytics/labels.ts';
import { logistic, MODEL_SCHEMA, type LinearPart, type ModelArtifact } from '../src/mystery/analytics/model.ts';
import { groupSessions, selectZoneParams } from './mystery-zones.ts';
import { SLURP_FEATURES, slurpFeatureVector, type SlurpInput, type SlurpRiskPart } from '../src/mystery/analytics/slurpModel.ts';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
}

const dataDir = resolve(arg('data', 'data/mystery'));
const l2 = Number(arg('l2', '0.0001'));
const testFrac = Number(arg('test-frac', '0.2'));
const SPLIT_KEY = 'mystery-holdout-v1';
const INNER_KEY = 'mystery-inner-validation-v1';
const EXTRACTION_L2_GRID = [0.0001, 0.001, 0.01, 0.03, 0.1];
export const MODEL_PATH = resolve('src/mystery/analytics/model/mystery-model.json');

export function isTestSession(session: string, frac = testFrac): boolean {
  return prfUniform(session, SPLIT_KEY) < frac;
}

function fitPart(rows: Row[], names: string[], label: (r: Row) => number, kind: 'logistic' | 'ols', lambda = l2): LinearPart {
  const raw = rows.map((r) => featureVector(names, featureInputFromRow(r)));
  const k = names.length;
  const mean = new Array<number>(k).fill(0);
  const std = new Array<number>(k).fill(0);
  for (const x of raw) for (let i = 0; i < k; i++) mean[i] += x[i];
  for (let i = 0; i < k; i++) mean[i] /= Math.max(1, raw.length);
  for (const x of raw) for (let i = 0; i < k; i++) std[i] += (x[i] - mean[i]) ** 2;
  for (let i = 0; i < k; i++) {
    std[i] = Math.sqrt(std[i] / Math.max(1, raw.length));
    if (!(std[i] > 1e-9)) std[i] = 1; // constant in training: contributes nothing
  }
  const X = raw.map((x) => [1, ...x.map((v, i) => (v - mean[i]) / std[i])]);
  const y = rows.map(label);
  const coef = kind === 'logistic' ? fitLogistic(X, y, lambda, 40) : fitOls(X, y, 1e-4);
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  return { features: names, mean: mean.map(r6), std: std.map(r6), coef: coef.map(r6) };
}

/** Rows of the Slurp risk regime: he is on the map, neither hunting nor seeing the player at t, label not censored. */
export function isSlurpRow(r: Row): boolean {
  return r.slurpActive === '1' && r.slurpHere !== undefined && r.slurpHere !== '' && r.slurpFound15 !== undefined && r.slurpFound15 !== ''
    && (r.slurpFact === '' || r.slurpFact === 'hidden');
}

export function slurpInputOf(r: Row): SlurpInput {
  return { ruleP: Number(r.slurpHere), mode: r.slurpMode ?? '', stance: r.stance, hidden: r.slurpFact === 'hidden' };
}

const r4s = (x: number) => Math.round(x * 10000) / 10000;

function fitSlurp(rows: Row[], modelVersion: string, episodes: number): SlurpRiskPart {
  const raw = rows.map((r) => slurpFeatureVector(slurpInputOf(r)));
  const k = SLURP_FEATURES.length;
  const mean = new Array<number>(k).fill(0);
  const std = new Array<number>(k).fill(0);
  for (const x of raw) for (let i = 0; i < k; i++) mean[i] += x[i] / raw.length;
  for (const x of raw) for (let i = 0; i < k; i++) std[i] += (x[i] - mean[i]) ** 2 / raw.length;
  for (let i = 0; i < k; i++) std[i] = Math.sqrt(std[i]) > 1e-9 ? Math.sqrt(std[i]) : 1;
  const X = raw.map((x) => [1, ...x.map((v, i) => (v - mean[i]) / std[i])]);
  const coef = fitLogistic(X, rows.map((r) => Number(r.slurpFound15)), 1e-3, 40);
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  return {
    method: 'logistic_regression', modelVersion: `slurp15-${modelVersion}`.slice(0, 32),
    trainedOn: `${rows.length} rows of ${episodes} simulated episodes (scripted bots on the real sim); not real players`,
    horizonS: 15, features: [...SLURP_FEATURES], mean: mean.map(r6), std: std.map(r6), coef: coef.map(r6), metrics: null,
  };
}

function main(): void {
  const t0 = Date.now();
  const manifest = JSON.parse(readFileSync(join(dataDir, 'manifest.json'), 'utf8')) as {
    generator: string; episodes: number; duos: number; seedPrefix: string; profiles: Record<string, number>;
    cases?: Record<string, { episodes: number }>;
  };
  const rows = parseCsv(readFileSync(join(dataDir, 'rows.csv'), 'utf8'));
  const sessions = [...new Set(rows.map((r) => r.session))];
  const test = new Set(sessions.filter((s) => isTestSession(s)));
  const train = rows.filter((r) => !test.has(r.session));
  const testRows = rows.filter((r) => test.has(r.session));
  const rooms = [...new Set(train.map((r) => r.roomId).filter(Boolean))].sort().map((id) => `room_${id}`);
  const caseIds = [...new Set(train.map((r) => r.caseId).filter(Boolean))].sort();
  const cases = caseIds.map((id) => `case_${id}`);
  const detNames = [...BASE_FEATURE_NAMES, ...rooms, ...cases];
  const caseEpisodes: Record<string, number> = {};
  for (const id of caseIds) caseEpisodes[id] = manifest.cases?.[id]?.episodes ?? new Set(rows.filter((r) => r.caseId === id).map((r) => r.session)).size;
  console.log(`  cases: ${caseIds.map((id) => `${id} ${caseEpisodes[id]}`).join(' · ') || 'none (legacy data)'}`);

  const detTrain = train.filter((r) => r.det15 !== '');
  console.log(`mystery:train — ${rows.length} rows, ${sessions.length} sessions (${sessions.length - test.size} train / ${test.size} test)`);
  console.log(`  detection: ${detTrain.length} train rows, base rate ${(detTrain.filter((r) => r.det15 === '1').length / detTrain.length).toFixed(4)}`);
  const detection = fitPart(detTrain, detNames, (r) => Number(r.det15), 'logistic');

  const exTrain = train.filter((r) => r.extraction !== '');
  console.log(`  extraction: ${exTrain.length} train rows, base rate ${(exTrain.filter((r) => r.extraction === '1').length / exTrain.length).toFixed(4)}`);
  // The extraction label is constant within a session (few DNFs), so a weak penalty overfits the training sessions.
  // Its L2 is chosen on an INNER session-grouped validation split of the TRAINING sessions (the holdout is untouched),
  // then the model is refit on all training sessions.
  const inner = (r: Row) => prfUniform(r.session, INNER_KEY) < 0.25;
  const exFit = exTrain.filter((r) => !inner(r));
  const exVal = exTrain.filter(inner);
  let exL2 = l2;
  let bestVal = Infinity;
  const exLabel = (r: Row) => Number(r.extraction);
  const grid: { l2: number; brier: number }[] = [];
  for (const lam of EXTRACTION_L2_GRID) {
    const part = fitPart(exFit, detNames, exLabel, 'logistic', lam);
    const ps = exVal.map((r) => logistic(part, featureVector(part.features, featureInputFromRow(r))));
    const brier = ps.reduce((acc, q, i) => acc + (q - exLabel(exVal[i])) ** 2, 0) / Math.max(1, ps.length);
    grid.push({ l2: lam, brier: Math.round(brier * 1e5) / 1e5 });
    if (brier < bestVal - 1e-6) {
      bestVal = brier;
      exL2 = lam;
    }
  }
  console.log(`    inner validation Brier by L2: ${grid.map((g) => `${g.l2} → ${g.brier}`).join(' · ')} ⇒ L2 ${exL2}`);
  const extraction = fitPart(exTrain, detNames, exLabel, 'logistic', exL2);

  const etaTrain = train.filter((r) => r.eta !== '');
  const etaNames = [...detNames, ...Object.keys(ETA_EXTRA)];
  console.log(`  eta: ${etaTrain.length} train rows`);
  const eta = fitPart(etaTrain, etaNames, (r) => Number(r.eta), 'ols');
  // naive baseline: mean seconds-to-next-progress per objective, and per `<caseId>:<objective>` (used when known)
  const naive: Record<string, number> = {};
  const meanOf = (xs: Row[]) => Math.round((xs.reduce((a, r) => a + Number(r.eta), 0) / xs.length) * 100) / 100;
  for (const obj of [...new Set(etaTrain.map((r) => r.objective))]) {
    naive[obj] = meanOf(etaTrain.filter((r) => r.objective === obj));
    for (const id of caseIds) {
      const xs = etaTrain.filter((r) => r.objective === obj && r.caseId === id);
      if (xs.length > 0) naive[`${id}:${obj}`] = meanOf(xs);
    }
  }

  const tz = Date.now();
  const zone = selectZoneParams(groupSessions(train));
  const bestGrid = zone.grid.reduce((a, b) => (b.logLoss < a.logLoss ? b : a));
  console.log(`  zone filter: β ${zone.params.beta} (${zone.betaRows} rows), diffusion ${zone.params.diffusionPerS}/s, alertFar ${zone.params.alertFarLikelihood} (train log-loss ${bestGrid.logLoss}) in ${((Date.now() - tz) / 1000).toFixed(1)} s`);

  const date = new Date();
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
  const artifact: ModelArtifact = {
    schema: MODEL_SCHEMA,
    // the generator generation is part of the version (same seeds, regenerated episodes ⇒ a different model)
    modelVersion: `det15-${ymd}-${manifest.seedPrefix}${/-(\d+)$/.exec(manifest.generator)?.[1] ? `-g${/-(\d+)$/.exec(manifest.generator)![1]}` : ''}`.slice(0, 32),
    rulesVersion: MYSTERY_RULES_VERSION,
    createdAt: date.toISOString(),
    modelType: 'logistic_regression',
    trainedOn: `${manifest.episodes} simulated episodes (scripted bots on the real sim, all ${manifest.duos} duos${caseIds.length ? `, ${caseIds.length} cases` : ''}); not real players`,
    detection: { ...detection, target: `hyde_mode→CHASE or catch within (t, t+${DETECTION_HORIZON_S}] s, player not already chased`, horizonS: DETECTION_HORIZON_S },
    extraction: { ...extraction, target: 'egg delivered at Iago Tower this run (outcome finished)' },
    eta: { ...eta, target: 'seconds to the next clue_found / egg_pickup / egg_delivered', naive },
    training: {
      generator: manifest.generator,
      episodes: manifest.episodes,
      duos: manifest.duos,
      cases: caseEpisodes,
      sessionsTrain: sessions.length - test.size,
      sessionsTest: test.size,
      rowsTrain: detTrain.length,
      rowsTest: testRows.filter((r) => r.det15 !== '').length,
      split: `session-grouped holdout: prfUniform(seed, '${SPLIT_KEY}') < ${testFrac} → test`,
      seedPrefix: manifest.seedPrefix,
      profiles: manifest.profiles,
      l2,
      l2Extraction: exL2,
      l2ExtractionSelection: `inner session-grouped validation (prfUniform(seed, '${INNER_KEY}') < 0.25 of the training sessions), grid ${EXTRACTION_L2_GRID.join(', ')}`,
    },
    zoneFilter: {
      params: zone.params,
      selection: `β = P(player does not see the Hyde | it is in the player's zone, no chase), counted on the training sessions (${zone.betaRows} rows); diffusion ∈ {0.0025…0.08}/s × alertFar ∈ {0.15…1} by mean log-loss on the training sessions`,
      betaRows: zone.betaRows,
      grid: zone.grid,
    },
    metrics: null,
  };
  // ---- final: Slurp "finds you" — logistic calibration of the rule on the training sessions (src/mystery/analytics/slurpModel.ts)
  const slurpRows = train.filter(isSlurpRow);
  const slurpRisk = slurpRows.length >= 200 && slurpRows.some((r) => r.slurpFound15 === '1') ? fitSlurp(slurpRows, artifact.modelVersion, manifest.episodes) : null;
  if (slurpRisk) console.log(`  slurp risk: ${slurpRows.length} train rows, base rate ${r4s(slurpRows.filter((r) => r.slurpFound15 === '1').length / slurpRows.length)}`);
  writeFileSync(MODEL_PATH, `${JSON.stringify({ ...artifact, ...(slurpRisk ? { slurpRisk } : {}) }, null, 1)}\n`);
  writeFileSync(join(dataDir, 'split.json'), `${JSON.stringify({ key: SPLIT_KEY, testFrac, testSessions: [...test].sort() }, null, 1)}\n`);
  console.log(`  wrote ${MODEL_PATH} (${artifact.modelVersion}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

if (process.argv[1] && /mystery-train\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) main();
