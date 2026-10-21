// Public API of the game-wide analytics layer (Phase 4). See docs/MYSTERY_CONTRACT.md "Analytics" and
// docs/MYSTERY_MODEL_REPORT.md. Every export works for all 126 duos; nothing here is tied to a character or Pokémon.
import type { MysteryRun } from '../run.ts';
import { dashboardAggregates, type DashboardAggregates } from './dashboard.ts';
import { BUNDLED_MODEL } from './model/index.ts';
import { PredictiveService } from './predictive.ts';
import { MysteryAnalytics, type MysteryAnalyticsOptions } from './session.ts';
import type { SessionRecord } from './types.ts';

export * from './types.ts';
export { TelemetryCollector, thinForUpload, eventFromRow } from './telemetry.ts';
export { describeSession, describeCollector, aggregateSessions, pickRates, type DescriptiveAggregate, type PickRate } from './descriptive.ts';
export { diagnoseSession, diagnoseCauses, diagnosePatterns, topCauses, aggregateDiagnostics, catchChains, fmtT, type DiagnosticAggregate } from './diagnostic.ts';
export { PredictiveService, bandFor, ruleDetection, ML_LABEL, RULE_LABEL, type ModelCard } from './predictive.ts';
export { PrescriptiveService, summariseAdvice, ENGINE_LABEL, type AdviceSummary } from './prescriptive.ts';
export { MysteryAnalytics, type MysteryAnalyticsOptions, type FrameOutput, type ResultsAnalytics, type RiskPoint } from './session.ts';
export { dashboardAggregates, liveForecastCheck, aggregatePrescriptive, type DashboardAggregates } from './dashboard.ts';
export { duoFactorsFromRun, liveContext } from './state.ts';
export { duoNumbers, type FeatureInput } from './features.ts';
export { DETECTION_HORIZON_S } from './labels.ts';
export { BUNDLED_MODEL };

/** Session analytics with the bundled model (falls back to the labelled rule-based estimate if it is unusable). */
export function createMysteryAnalytics(run: MysteryRun, o: Omit<MysteryAnalyticsOptions, 'model'> & { model?: unknown | null } = {}): MysteryAnalytics {
  return new MysteryAnalytics(run, { ...o, model: o.model === undefined ? BUNDLED_MODEL : o.model });
}

let shared: PredictiveService | null = null;
/** The PredictiveService over the bundled artifact (dashboard ModelCard, results label). */
export function bundledPredictiveService(): PredictiveService {
  if (!shared) shared = new PredictiveService(BUNDLED_MODEL);
  return shared;
}

/** Laptop 1: the four layer panels from session records. */
export function dashboard(records: readonly SessionRecord[], clueIds: readonly string[] = []): DashboardAggregates {
  return dashboardAggregates(records, bundledPredictiveService(), clueIds);
}
