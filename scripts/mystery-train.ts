// npm run mystery:train [-- --data data/mystery --l2 0.0001 --test-frac 0.2]
//
// Trains the predictive models on the SIMULATED episodes from `mystery:generate`, with a SESSION-GROUPED split: every
// episode (session = seed) lands entirely in train or entirely in test (keyed hash of the seed), so no session leaks.
//   detection  — logistic regression (L2, IRLS), target "detected within 15 s" (src/mystery/analytics/labels.ts)
//   extraction — logistic regression, target "egg delivered this run"
//   eta        — OLS, seconds to the next progress event, with a naive per-objective mean baseline
// Writes src/mystery/analytics/model/mystery-model.json (metrics: null until `mystery:evaluate`) and data/mystery/split.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fitLogistic, fitOls } from '../src/analytics/regression.ts';
import { prfUniform } from '../src/mystery/prf.ts';
import { featureInputFromRow, parseCsv, type Row } from '../src/mystery/analytics/dataset.ts';
import { BASE_FEATURE_NAMES, ETA_EXTRA, featureVector } from '../src/mystery/analytics/features.ts';
import { DETECTION_HORIZON_S } from '../src/mystery/analytics/labels.ts';
import { MODEL_SCHEMA, type LinearPart, type ModelArtifact } from '../src/mystery/analytics/model.ts';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
}

const dataDir = resolve(arg('data', 'data/mystery'));
const l2 = Number(arg('l2', '0.0001'));
const testFrac = Number(arg('test-frac', '0.2'));
const SPLIT_KEY = 'mystery-holdout-v1';
export const MODEL_PATH = resolve('src/mystery/analytics/model/mystery-model.json');

export function isTestSession(session: string, frac = testFrac): boolean {
  return prfUniform(session, SPLIT_KEY) < frac;
}

function fitPart(rows: Row[], names: string[], label: (r: Row) => number, kind: 'logistic' | 'ols'): LinearPart {
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
  const coef = kind === 'logistic' ? fitLogistic(X, y, l2, 40) : fitOls(X, y, 1e-4);
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  return { features: names, mean: mean.map(r6), std: std.map(r6), coef: coef.map(r6) };
}

function main(): void {
  const t0 = Date.now();
  const manifest = JSON.parse(readFileSync(join(dataDir, 'manifest.json'), 'utf8')) as {
    generator: string; episodes: number; duos: number; seedPrefix: string; profiles: Record<string, number>;
  };
  const rows = parseCsv(readFileSync(join(dataDir, 'rows.csv'), 'utf8'));
  const sessions = [...new Set(rows.map((r) => r.session))];
  const test = new Set(sessions.filter((s) => isTestSession(s)));
  const train = rows.filter((r) => !test.has(r.session));
  const testRows = rows.filter((r) => test.has(r.session));
  const rooms = [...new Set(train.map((r) => r.roomId).filter(Boolean))].sort().map((id) => `room_${id}`);
  const detNames = [...BASE_FEATURE_NAMES, ...rooms];

  const detTrain = train.filter((r) => r.det15 !== '');
  console.log(`mystery:train — ${rows.length} rows, ${sessions.length} sessions (${sessions.length - test.size} train / ${test.size} test)`);
  console.log(`  detection: ${detTrain.length} train rows, base rate ${(detTrain.filter((r) => r.det15 === '1').length / detTrain.length).toFixed(4)}`);
  const detection = fitPart(detTrain, detNames, (r) => Number(r.det15), 'logistic');

  const exTrain = train.filter((r) => r.extraction !== '');
  console.log(`  extraction: ${exTrain.length} train rows, base rate ${(exTrain.filter((r) => r.extraction === '1').length / exTrain.length).toFixed(4)}`);
  const extraction = fitPart(exTrain, detNames, (r) => Number(r.extraction), 'logistic');

  const etaTrain = train.filter((r) => r.eta !== '');
  const etaNames = [...detNames, ...Object.keys(ETA_EXTRA)];
  console.log(`  eta: ${etaTrain.length} train rows`);
  const eta = fitPart(etaTrain, etaNames, (r) => Number(r.eta), 'ols');
  const naive: Record<string, number> = {};
  for (const obj of [...new Set(etaTrain.map((r) => r.objective))]) {
    const ys = etaTrain.filter((r) => r.objective === obj).map((r) => Number(r.eta));
    naive[obj] = Math.round((ys.reduce((a, b) => a + b, 0) / ys.length) * 100) / 100;
  }

  const date = new Date();
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
  const artifact: ModelArtifact = {
    schema: MODEL_SCHEMA,
    modelVersion: `det15-${ymd}-${manifest.seedPrefix}`.slice(0, 32),
    rulesVersion: 'mystery-v3.1',
    createdAt: date.toISOString(),
    modelType: 'logistic_regression',
    trainedOn: `${manifest.episodes} simulated episodes (scripted bots on the real sim, all ${manifest.duos} duos); not real players`,
    detection: { ...detection, target: `hyde_mode→CHASE or catch within (t, t+${DETECTION_HORIZON_S}] s, player not already chased`, horizonS: DETECTION_HORIZON_S },
    extraction: { ...extraction, target: 'egg delivered at Iago Tower this run (outcome finished)' },
    eta: { ...eta, target: 'seconds to the next clue_found / egg_pickup / egg_delivered', naive },
    training: {
      generator: manifest.generator,
      episodes: manifest.episodes,
      duos: manifest.duos,
      sessionsTrain: sessions.length - test.size,
      sessionsTest: test.size,
      rowsTrain: detTrain.length,
      rowsTest: testRows.filter((r) => r.det15 !== '').length,
      split: `session-grouped holdout: prfUniform(seed, '${SPLIT_KEY}') < ${testFrac} → test`,
      seedPrefix: manifest.seedPrefix,
      profiles: manifest.profiles,
      l2,
    },
    metrics: null,
  };
  writeFileSync(MODEL_PATH, `${JSON.stringify(artifact, null, 1)}\n`);
  writeFileSync(join(dataDir, 'split.json'), `${JSON.stringify({ key: SPLIT_KEY, testFrac, testSessions: [...test].sort() }, null, 1)}\n`);
  console.log(`  wrote ${MODEL_PATH} (${artifact.modelVersion}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main();
