// Raven Vision runtime: frozen OLS (leg time) + logistic (Hyde catch) models trained offline on SIMULATED data.
// When no model is available, the transparent rule-based expectation is shown instead (never fake ML output).
import type { GameState, LegChoice, WeatherId } from '../game/index.ts';
import { buildLegFeatures, CATCH_FEATURES, TIME_FEATURES } from './features.ts';
import { dot, sigmoid, type CalibrationBin } from './regression.ts';

export interface RavenVisionModel {
  modelVersion: string;
  rulesVersion: string;
  trainedOn: 'simulated';
  createdAt: string;
  dataset: { attemptedRaces: number; observedLegRows: number; trainRaces: number; testRaces: number; seedPrefix: string; dnfRaces: number };
  time: { features: string[]; weights: number[]; testMae: number; baselineMae: number; ruleBasedMae: number; trainMae: number };
  catch: {
    features: string[]; weights: number[]; testBrier: number; baselineBrier: number; ruleBasedBrier: number; trainBrier: number;
    testBaseRate: number; calibration: CalibrationBin[];
  };
  leakageCheck: string;
}

export interface LegPrediction {
  source: 'raven_vision' | 'rule_based';
  legTimeS: number;
  catchP: number;
  ruleLegTimeS: number;
  ruleCatchP: number;
  isLegal: boolean;
}

export function isCompatibleModel(model: RavenVisionModel | null): model is RavenVisionModel {
  return !!model
    && model.time.features.join() === TIME_FEATURES.join()
    && model.catch.features.join() === CATCH_FEATURES.join();
}

export function predictLeg(
  model: RavenVisionModel | null, state: GameState, weather: WeatherId, choice: LegChoice, pCollect: number,
): LegPrediction {
  const f = buildLegFeatures(state, weather, choice, pCollect);
  const rule = { ruleLegTimeS: f.probe.expectedTimeS, ruleCatchP: f.probe.expectedCatchP, isLegal: f.probe.isLegal };
  if (!isCompatibleModel(model)) {
    return { source: 'rule_based', legTimeS: rule.ruleLegTimeS, catchP: rule.ruleCatchP, ...rule };
  }
  // A proximity catch is certain by rule; the model may not represent probability 1 well, so respect it.
  const modelCatch = f.probe.catchPNoCrash >= 1 ? 1 : sigmoid(dot(model.catch.weights, f.catch));
  return { source: 'raven_vision', legTimeS: Math.max(10, dot(model.time.weights, f.time)), catchP: modelCatch, ...rule };
}

/** Advisory discrepancy between model and rule engine, logged in telemetry (GDD 8.3). */
export function catchDiscrepancy(p: LegPrediction): number {
  return Math.abs(p.catchP - p.ruleCatchP);
}
