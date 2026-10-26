// Trains Raven Vision on the synthetic dataset: OLS for leg time, logistic regression for Hyde catch.
// Race-level 80/20 split; reports test MAE / Brier against baselines and calibration. Writes frozen weights
// (src/analytics/models/raven-vision.json) and docs/MODEL_REPORT.md. Usage: npm run models:train
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { RULES_VERSION } from '../src/game/index.ts';
import { CATCH_FEATURES, TIME_FEATURES } from '../src/analytics/features.ts';
import {
  brierScore, calibrationBins, dot, fitLogistic, fitOls, meanAbsoluteError, sigmoid,
} from '../src/analytics/regression.ts';
import type { RavenVisionModel } from '../src/analytics/ravenVision.ts';
import { DATA_PATH, SEED_PREFIX, type LegRow } from './generate-synthetic-data.ts';

export const MODEL_PATH = 'src/analytics/models/raven-vision.json';
const MODEL_VERSION = `raven-vision-${RULES_VERSION}-1`;
const POST_EVENT_WORDS = ['actual', 'crashed', 'caught', 'outcome', 'failed', 'retrieved', 'hp_end', 'gap_end'];

export function loadRows(path = DATA_PATH): LegRow[] {
  if (!existsSync(path)) throw new Error(`${path} missing — run npm run data:generate first`);
  return readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as LegRow);
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function trainModel(rows: LegRow[]): RavenVisionModel {
  const leaked = [...TIME_FEATURES, ...CATCH_FEATURES].filter((f) => POST_EVENT_WORDS.some((w) => f.includes(w)));
  if (leaked.length) throw new Error(`Leakage: post-event features ${leaked.join(', ')}`);
  const train = rows.filter((r) => r.split === 'train');
  const test = rows.filter((r) => r.split === 'test');
  const races = (rs: LegRow[]) => new Set(rs.map((r) => r.race)).size;
  const overlap = [...new Set(train.map((r) => r.race))].filter((race) => test.some((t) => t.race === race));
  if (overlap.length) throw new Error('Race-level split violated');

  const timeW = fitOls(train.map((r) => r.timeX), train.map((r) => r.actualTimeS));
  const catchW = fitLogistic(train.map((r) => r.catchX), train.map((r) => r.caught));
  const predictTime = (r: LegRow) => Math.max(10, dot(timeW, r.timeX));
  const predictCatch = (r: LegRow) => (r.catchX[2] >= 1 ? 1 : sigmoid(dot(catchW, r.catchX)));

  const trainMeanTime = mean(train.map((r) => r.actualTimeS));
  const trainRate = mean(train.map((r) => r.caught));
  const testTimes = test.map((r) => r.actualTimeS);
  const testCaught = test.map((r) => r.caught);
  const testCatchP = test.map(predictCatch);
  const dnfRaces = new Set(rows.filter((r) => r.outcome === 'dnf').map((r) => r.race)).size;
  const attempted = new Set(rows.map((r) => r.race)).size;

  return {
    modelVersion: MODEL_VERSION,
    rulesVersion: RULES_VERSION,
    trainedOn: 'simulated',
    createdAt: new Date().toISOString(),
    dataset: { attemptedRaces: attempted, observedLegRows: rows.length, trainRaces: races(train), testRaces: races(test), seedPrefix: SEED_PREFIX, dnfRaces },
    time: {
      features: [...TIME_FEATURES], weights: timeW,
      testMae: meanAbsoluteError(test.map(predictTime), testTimes),
      trainMae: meanAbsoluteError(train.map(predictTime), train.map((r) => r.actualTimeS)),
      baselineMae: meanAbsoluteError(test.map(() => trainMeanTime), testTimes),
      ruleBasedMae: meanAbsoluteError(test.map((r) => r.ruleTimeS), testTimes),
    },
    catch: {
      features: [...CATCH_FEATURES], weights: catchW,
      testBrier: brierScore(testCatchP, testCaught),
      trainBrier: brierScore(train.map(predictCatch), train.map((r) => r.caught)),
      baselineBrier: brierScore(test.map(() => trainRate), testCaught),
      ruleBasedBrier: brierScore(test.map((r) => r.ruleCatchP), testCaught),
      testBaseRate: mean(testCaught),
      calibration: calibrationBins(testCatchP, testCaught),
    },
    leakageCheck: 'Features are computed before resolution from route, push, weather, pre-leg state and rule-engine probes with fixed draws; feature names screened for post-event terms; race-level split verified disjoint.',
  };
}

const f2 = (x: number) => x.toFixed(2);
const f4 = (x: number) => x.toFixed(4);

export function renderReport(m: RavenVisionModel): string {
  const mae = m.time.testMae;
  const brier = m.catch.testBrier;
  const bins = m.catch.calibration.filter((b) => b.count > 0)
    .map((b) => `| ${f2(b.lower)}–${f2(b.upper)} | ${b.count} | ${f4(b.meanPredicted)} | ${f4(b.observedRate)} |`).join('\n');
  return `# Raven Vision Model Report (TRAINED ON SIMULATED DATA)

> All metrics below were produced by \`npm run models:train\` on synthetic races from the v2.5 rules engine.
> They describe how well the model reproduces the **simulator**, not real-world player outcomes.

* Model version: \`${m.modelVersion}\` · rules \`${m.rulesVersion}\` · generated ${m.createdAt}
* Dataset: ${m.dataset.attemptedRaces} attempted races (seed prefix \`${m.dataset.seedPrefix}\`), **${m.dataset.observedLegRows} observed leg rows** (early DNF truncates rows; ${m.dataset.dnfRaces} races ended in DNF)
* Split: race-level 80/20 → ${m.dataset.trainRaces} train races / ${m.dataset.testRaces} test races

## Leg time — ordinary least squares
| Metric | Value |
|---|---|
| Test MAE (model) | **${f2(mae)} s** |
| Train MAE | ${f2(m.time.trainMae)} s |
| Baseline MAE (predict train mean) | ${f2(m.time.baselineMae)} s |
| Rule-engine expectation MAE | ${f2(m.time.ruleBasedMae)} s |
| Aspirational target | < 2.50 s → ${mae < 2.5 ? 'met' : 'NOT met'} |

Features: ${m.time.features.map((f) => `\`${f}\``).join(', ')}

## Hyde catch — logistic regression
| Metric | Value |
|---|---|
| Test Brier (model) | **${f4(brier)}** |
| Train Brier | ${f4(m.catch.trainBrier)} |
| Baseline Brier (train base rate) | ${f4(m.catch.baselineBrier)} |
| Rule-engine probability Brier | ${f4(m.catch.ruleBasedBrier)} |
| Test catch base rate | ${f4(m.catch.testBaseRate)} |
| Aspirational target | < 0.12 → ${brier < 0.12 ? 'met' : 'NOT met'} |

Features: ${m.catch.features.map((f) => `\`${f}\``).join(', ')}

### Calibration (test set)
| Predicted bin | Legs | Mean predicted | Observed rate |
|---|---|---|---|
${bins}

## Leakage controls
${m.leakageCheck}

## Interpretation
Leg time is dominated by deterministic rules (route, push, weather, abilities) plus discrete random events (crash +8 s,
Hyde catch +10 s). Any model that only sees pre-decision information cannot know whether those events will happen, so a
residual error remains: the exact rule-engine *expectation* has a test MAE of ${f2(m.time.ruleBasedMae)} s, which is effectively
the floor for any mean-predicting model on pre-decision features, so the < 2.5 s aspiration is not reachable without
leaking future events (which we refuse to do). The rule-engine expectation is shown alongside so visitors see a transparent, calibrated number.
Models are frozen at build time; there is no live retraining during the exhibit.
`;
}

function main() {
  const model = trainModel(loadRows());
  mkdirSync('src/analytics/models', { recursive: true });
  writeFileSync(MODEL_PATH, JSON.stringify(model, null, 2) + '\n');
  writeFileSync('docs/MODEL_REPORT.md', renderReport(model));
  console.log(`time test MAE ${f2(model.time.testMae)} s (baseline ${f2(model.time.baselineMae)}); catch test Brier ${f4(model.catch.testBrier)} (baseline ${f4(model.catch.baselineBrier)})`);
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/train-models.ts')) main();
