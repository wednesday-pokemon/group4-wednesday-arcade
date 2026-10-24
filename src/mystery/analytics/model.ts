// The trained-model artifact (src/mystery/analytics/model/mystery-model.json, written by `npm run mystery:train` and
// completed with held-out metrics by `npm run mystery:evaluate`) and its strict validator. An artifact that is missing,
// malformed, for another rules version, or that names a feature this code cannot compute is rejected → the services
// fall back to the transparent rule-based estimate and say so.
import { dot, sigmoid } from '../../analytics/regression.ts';
import { isKnownFeature } from './features.ts';

export const MODEL_SCHEMA = 'mystery-analytics-model/1';

export interface LinearPart {
  features: string[];
  mean: number[];
  std: number[];
  /** [intercept, w_1 … w_n] on standardised features. */
  coef: number[];
}

export interface CalibrationRow { lower: number; upper: number; count: number; meanPredicted: number; observedRate: number }

export interface ClassifierMetrics {
  rows: number;
  sessions: number;
  positives: number;
  baseRate: number; // positives / rows in the held-out set
  trainBaseRate: number; // the constant baseline's prediction
  brier: number;
  baselineBrier: number;
  brierSkill: number; // 1 − brier / baselineBrier
  logLoss: number;
  baselineLogLoss: number;
  auc: number | null;
  calibration: CalibrationRow[];
}

export interface RegressionMetrics {
  rows: number;
  sessions: number;
  mae: number;
  naiveMae: number;
  naiveDescription: string;
}

export interface ModelArtifact {
  schema: typeof MODEL_SCHEMA;
  modelVersion: string;
  /** The sim rules the episodes were generated with (v3.1 artifacts stay loadable until the v4 retrain ships). */
  rulesVersion: 'mystery-v3.1' | 'mystery-v4';
  createdAt: string;
  modelType: 'logistic_regression';
  trainedOn: string;
  detection: LinearPart & { target: string; horizonS: number };
  extraction: (LinearPart & { target: string }) | null;
  eta: (LinearPart & { target: string; naive: Record<string, number> }) | null;
  training: {
    generator: string;
    episodes: number;
    duos: number;
    /** Episodes per case id in the training data (absent in pre-case artifacts). */
    cases?: Record<string, number>;
    sessionsTrain: number;
    sessionsTest: number;
    rowsTrain: number;
    rowsTest: number;
    split: string;
    seedPrefix: string;
    profiles: Record<string, number>;
    l2: number;
    /** L2 of the extraction head when it differs (selected on an inner validation split of the training sessions). */
    l2Extraction?: number;
    l2ExtractionSelection?: string;
  };
  /**
   * Overhaul: the Hyde zone filter's parameters selected on TRAINING sessions (β counted, diffusion / alertFar by mean
   * log-loss — scripts/mystery-train.ts) and its held-out metrics (scripts/mystery-evaluate.ts). Optional: without it
   * the live filter uses ZONE_FILTER_DEFAULTS (src/mystery/analytics/hydeZones.ts).
   */
  zoneFilter?: {
    params: { beta: number; diffusionPerS: number; offPatrolReturnPerS: number; chaseNearM: number; chaseFarLikelihood: number; alertNearM: number; alertFarLikelihood: number };
    selection: string;
    betaRows: number;
    grid: { diffusionPerS: number; alertFarLikelihood: number; logLoss: number; brier: number }[];
    metrics?: unknown;
  };
  /**
   * Enemy contract: the RULE-BASED Crackstone risk is not trained; its definition constants and held-out calibration
   * (scripts/mystery-evaluate.ts §7) are recorded here so the report quotes measured numbers. Optional.
   */
  crackstoneRisk?: {
    method: 'rule_based';
    label: string;
    modelVersion: string;
    horizonS: number;
    cellM: number;
    stepS: number;
    belief: unknown;
    metrics: { evaluatedAt: string; cells: unknown; here: unknown };
  };
  metrics: {
    evaluatedAt: string;
    detection: ClassifierMetrics;
    detectionNotChased?: ClassifierMetrics;
    extraction: ClassifierMetrics | null;
    eta: RegressionMetrics | null;
    /** The same held-out metrics per case (holdout sessions of that case only). */
    byCase?: Partial<Record<string, { detection: ClassifierMetrics; extraction: ClassifierMetrics | null; eta: RegressionMetrics | null }>>;
  } | null;
}

const VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;

function finiteArray(a: unknown, n?: number): a is number[] {
  return Array.isArray(a) && (n === undefined || a.length === n) && a.every((v) => typeof v === 'number' && Number.isFinite(v));
}

function validPart(p: unknown): p is LinearPart {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  const f = o.features;
  if (!Array.isArray(f) || f.length === 0 || !f.every((n) => typeof n === 'string' && isKnownFeature(n))) return false;
  if (new Set(f).size !== f.length) return false;
  return finiteArray(o.mean, f.length) && finiteArray(o.std, f.length) && (o.std as number[]).every((s) => s > 0) && finiteArray(o.coef, f.length + 1);
}

/** Returns the artifact typed, or a reason why it cannot be used. */
export function validateArtifact(x: unknown): { ok: true; model: ModelArtifact } | { ok: false; reason: string } {
  if (!x || typeof x !== 'object') return { ok: false, reason: 'no model artifact' };
  const o = x as Record<string, unknown>;
  if (o.schema !== MODEL_SCHEMA) return { ok: false, reason: 'unknown model schema' };
  if (o.rulesVersion !== 'mystery-v4' && o.rulesVersion !== 'mystery-v3.1') return { ok: false, reason: 'model trained for another rules version' };
  if (typeof o.modelVersion !== 'string' || !VERSION_RE.test(o.modelVersion)) return { ok: false, reason: 'bad modelVersion' };
  if (o.modelType !== 'logistic_regression') return { ok: false, reason: 'unsupported model type' };
  if (!validPart(o.detection)) return { ok: false, reason: 'detection model malformed or uses unknown features' };
  if (o.extraction !== null && o.extraction !== undefined && !validPart(o.extraction)) return { ok: false, reason: 'extraction model malformed' };
  if (o.eta !== null && o.eta !== undefined && !validPart(o.eta)) return { ok: false, reason: 'eta model malformed' };
  if (typeof o.trainedOn !== 'string' || !/simulated/i.test(o.trainedOn)) return { ok: false, reason: 'training data description missing' };
  return { ok: true, model: { ...(o as unknown as ModelArtifact), extraction: (o.extraction as ModelArtifact['extraction']) ?? null, eta: (o.eta as ModelArtifact['eta']) ?? null } };
}

/** Standardised design row [1, z_1 … z_n]. */
export function standardise(part: LinearPart, raw: readonly number[]): number[] {
  const out = new Array<number>(raw.length + 1);
  out[0] = 1;
  for (let i = 0; i < raw.length; i++) out[i + 1] = (raw[i] - part.mean[i]) / part.std[i];
  return out;
}

export function linear(part: LinearPart, raw: readonly number[]): number {
  return dot(part.coef, standardise(part, raw));
}

export function logistic(part: LinearPart, raw: readonly number[]): number {
  return sigmoid(linear(part, raw));
}
