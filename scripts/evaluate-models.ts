// Re-evaluates the FROZEN Raven Vision weights against a freshly regenerated test split to prove the shipped
// model file reproduces its reported metrics. Usage: npm run models:evaluate
import { readFileSync } from 'node:fs';
import { brierScore, dot, meanAbsoluteError, sigmoid } from '../src/analytics/regression.ts';
import type { RavenVisionModel } from '../src/analytics/ravenVision.ts';
import { generateRace } from './generate-synthetic-data.ts';
import { MODEL_PATH } from './train-models.ts';

const model = JSON.parse(readFileSync(MODEL_PATH, 'utf8')) as RavenVisionModel;
const test = Array.from({ length: model.dataset.attemptedRaces }, (_, race) => generateRace(race)).flat().filter((r) => r.split === 'test');
const mae = meanAbsoluteError(test.map((r) => Math.max(10, dot(model.time.weights, r.timeX))), test.map((r) => r.actualTimeS));
const brier = brierScore(test.map((r) => (r.catchX[2] >= 1 ? 1 : sigmoid(dot(model.catch.weights, r.catchX)))), test.map((r) => r.caught));
const same = Math.abs(mae - model.time.testMae) < 1e-9 && Math.abs(brier - model.catch.testBrier) < 1e-9;
console.log(`re-evaluated test MAE ${mae.toFixed(4)} s, Brier ${brier.toFixed(4)} — ${same ? 'matches' : 'DIFFERS FROM'} frozen report`);
if (!same) process.exit(1);
