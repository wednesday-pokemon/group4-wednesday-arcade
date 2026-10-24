// Public API of the game-wide analytics layer (Phase 4). See docs/MYSTERY_CONTRACT.md "Analytics" and
// docs/MYSTERY_MODEL_REPORT.md. Every export works for all 126 duos; nothing here is tied to a character or Pokémon.
import type { MysteryRun } from '../run.ts';
import { dashboardAggregates, type DashboardAggregates, type DashboardOptions } from './dashboard.ts';
import { BUNDLED_MODEL } from './model/index.ts';
import { PredictiveService } from './predictive.ts';
import { MysteryAnalytics, type MysteryAnalyticsOptions } from './session.ts';
import type { SessionRecord } from './types.ts';

export * from './types.ts';
export { TelemetryCollector, thinForUpload, eventFromRow } from './telemetry.ts';
export {
  describeSession, describeCollector, aggregateSessions, scopeRecords, pickRates,
  type AggregateOptions, type AccusationBreakdown, type CaseSummary, type ClueRate, type DescriptiveAggregate, type PickRate,
} from './descriptive.ts';
export {
  diagnoseSession, diagnoseCauses, diagnoseCaseReasons, diagnosePatterns, failureReasons, topCauses, aggregateDiagnostics, catchChains, fmtT,
  CASE_REASON_TEXT, type CaseFailure, type DiagnosticAggregate,
} from './diagnostic.ts';
export { accusationKind, caseLabel, clueCountFor, recordCaseId, ACCUSATION_TEXT, LEGACY_CLUE_COUNT } from './caseInfo.ts';
export { PredictiveService, bandFor, ruleDetection, ML_LABEL, RULE_LABEL, type ModelCard } from './predictive.ts';
export { PrescriptiveService, summariseAdvice, ENGINE_LABEL, type AdviceSummary } from './prescriptive.ts';
export { MysteryAnalytics, type MysteryAnalyticsOptions, type FrameOutput, type ResultsAnalytics, type RiskPoint } from './session.ts';
export { eggAdvice } from './prescriptive.ts';
export { boardOptions, dashboardAggregates, liveForecastCheck, aggregatePrescriptive, type DashboardAggregates, type DashboardOptions } from './dashboard.ts';
export { duoFactorsFromRun, liveContext } from './state.ts';
export { duoNumbers, type FeatureInput } from './features.ts';
export { DETECTION_HORIZON_S } from './labels.ts';
export { BUNDLED_MODEL };
// ---- overhaul: live analytics during play (MysteryAnalytics.live() / hint(level) / heartbeat())
export { LABEL_BAYES, LABEL_ML, LABEL_RULE, type HeartbeatAnalytics } from './live.ts';
export { TITLES as LIVE_TITLES, P as LIVE_PRIORITY, ADVICE_MAX, WHY_MAX, LOG_MAX, DIAG_MAX } from './liveMessages.ts';
export { eggPosterior, clueAreaProbabilities, clueSiteProbabilities } from './bayes.ts';
export { spawnProbabilities, zoneIndexAt } from './hydeZones.ts';
export { thingItemText } from './thingCodes.ts';
export { UPLOAD_FORECAST_TARGETS } from './telemetry.ts';
// ---- enemy contract: Joseph Crackstone (rule-based risk, public state, descriptive counts, message limits)
export { CRACK_CELL_M, CRACK_HORIZON_S, CRACK_LABEL, CRACK_MODEL_VERSION } from './crackstoneRisk.ts';
export { crackstoneOf, crackstoneModeOf, type CrackstonePublic, type CrackstonePoseKind } from './publicState.ts';
export { crackstoneReport, type CrackstoneAggregate } from './descriptive.ts';
export { CRACK_P5_GAP_S, ENEMY_ALERTS_PER_MINUTE, isCrackThreat } from './liveMessages.ts';
export { CRACK_INTRO_AFTER_S } from './live.ts';

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

/**
 * Laptop 1: the four layer panels from session records, for `scope` = one case or all cases (default all; legacy
 * case-less records excluded unless `legacy: 'include'`). A clue-id array (pre-case API) means legacy-inclusive.
 */
export function dashboard(records: readonly SessionRecord[], options: DashboardOptions | readonly string[] = {}): DashboardAggregates {
  return dashboardAggregates(records, bundledPredictiveService(), options);
}
