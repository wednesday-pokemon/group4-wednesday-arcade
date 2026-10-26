// PredictiveService — "What is likely?".
//
// Target (see labels.ts): P(the Hyde DETECTS the player — a transition into CHASE or a catch — within the next 15 s),
// for a player who is not already being chased. Second target: P(extraction success = the egg reaches Iago Tower).
// Optional regression: seconds to the next progress event.
//
// source 'ml'   → logistic regression trained OFFLINE on seeded simulated bot episodes (scripts/mystery-*.ts), with a
//                 session-grouped holdout; label "ML estimate". Simulated episodes are not real players.
// source 'rule' → when the artifact is missing or invalid: a transparent rule-based estimate (formula below), label
//                 "Rule-based risk estimate". It never pretends to be a trained model.
import { hearingRadius } from '../noise.ts';
import { DEFAULT_TUNING } from '../config.ts';
import { DETECTION_HORIZON_S } from './labels.ts';
import { featureLabel, featureVector, type FeatureInput } from './features.ts';
import { linear, logistic, standardise, validateArtifact, type ModelArtifact } from './model.ts';
import type { ProbabilityEstimate, RiskBand, RiskEstimate, RiskFactor } from './types.ts';

export const ML_LABEL = 'ML estimate' as const;
export const RULE_LABEL = 'Rule-based risk estimate' as const;

/** HUD bands (UX_MYSTERY §4 RiskChip): < .33 low, < .66 medium, ≥ .66 high. */
export function bandFor(p: number): RiskBand {
  return p < 0.33 ? 'low' : p < 0.66 ? 'medium' : 'high';
}

const KNOTS = DEFAULT_TUNING.noise.knots;
const SIGHT_RANGE = DEFAULT_TUNING.sight.rangeM;

/**
 * Rule-based detection risk (documented, deterministic):
 *   base by Hyde mode: PATROL 0.04 · INVESTIGATE_SOUND 0.25 · SEARCH 0.30 · COOLDOWN 0.03
 *   + 0.35 × (1 − d / sightRange) when it has a clear line to you within sight range (not hidden)
 *   + 0.10 when a wall is between you but it is within 8 m
 *   + 0.20 when your recent noise reaches it (hearing radius of recentNoise ≥ distance)
 *   + 0.05 when sprinting within 20 m
 *   × 0.5 when hidden; × 0.3 when the Hyde is stunned / lured / distracted;  clamped to [0.01, 0.95]
 */
export function ruleDetection(x: FeatureInput): { p: number; factors: RiskFactor[] } {
  const s = x.snapshot;
  const d = s.hydeDistanceM;
  const factors: RiskFactor[] = [];
  const base = s.hydeMode === 'INVESTIGATE_SOUND' ? 0.25 : s.hydeMode === 'SEARCH' ? 0.3 : s.hydeMode === 'COOLDOWN' ? 0.03 : 0.04;
  let p = base;
  if (base >= 0.25) factors.push({ feature: 'hydeMode', label: s.hydeMode === 'SEARCH' ? 'Hyde is searching' : 'Hyde is investigating a noise', direction: 'raises', weight: base });
  if (!s.hydeOccluded && !s.hidden && d < SIGHT_RANGE) {
    const w = 0.35 * (1 - d / SIGHT_RANGE);
    p += w;
    factors.push({ feature: 'visibleNear', label: `Hyde ${Math.round(d)} m away with a clear view`, direction: 'raises', weight: w });
  } else if (s.hydeOccluded && d < 8) {
    p += 0.1;
    factors.push({ feature: 'near', label: `Hyde ${Math.round(d)} m away behind a wall`, direction: 'raises', weight: 0.1 });
  }
  if (hearingRadius(s.recentNoise, KNOTS) >= d && s.recentNoise > 0) {
    p += 0.2;
    factors.push({ feature: 'noiseReach', label: 'Your recent noise reaches it', direction: 'raises', weight: 0.2 });
  }
  if (s.stance === 'sprint' && d < 20) {
    p += 0.05;
    factors.push({ feature: 'stance_sprint', label: 'You are sprinting', direction: 'raises', weight: 0.05 });
  }
  if (s.hidden) {
    factors.push({ feature: 'hidden', label: 'You are hidden', direction: 'lowers', weight: p * 0.5 });
    p *= 0.5;
  }
  if (x.context?.hydeNeutralized) {
    factors.push({ feature: 'hydeNeutralized', label: 'The Hyde is stunned, lured or distracted', direction: 'lowers', weight: p * 0.7 });
    p *= 0.3;
  }
  return { p: Math.min(0.95, Math.max(0.01, p)), factors: factors.sort((a, b) => b.weight - a.weight).slice(0, 3) };
}

/** Rule-based extraction estimate: 0.95 − 0.30 per catch − 0.10 if the egg is on the ground − 0.10 if HP ≤ 35. */
export function ruleExtraction(x: FeatureInput): number {
  const s = x.snapshot;
  let p = 0.95 - 0.3 * s.catches - (s.eggState === 'dropped' ? 0.1 : 0) - (s.hp <= 35 ? 0.1 : 0);
  if (s.eggState === 'delivered') p = 1;
  return Math.min(1, Math.max(0.02, p));
}

export interface ModelCard {
  source: 'ml' | 'rule';
  label: typeof ML_LABEL | typeof RULE_LABEL;
  /** Exact results-panel line (UX_MYSTERY §6). */
  resultsLabel: string;
  modelType: string | null;
  target: string;
  modelVersion: string | null;
  trainedOn: string | null;
  episodes: number | null;
  rowsTrain: number | null;
  rowsTest: number | null;
  sessionsTest: number | null;
  split: string | null;
  baseRate: number | null;
  brier: number | null;
  baselineBrier: number | null;
  auc: number | null;
  calibration: { lower: number; upper: number; count: number; meanPredicted: number; observedRate: number }[];
  extraction: { brier: number; baselineBrier: number; baseRate: number } | null;
  eta: { mae: number; naiveMae: number } | null;
  note: string;
  invalidReason: string | null;
}

function fmt3(x: number): string {
  return x.toFixed(3);
}

export class PredictiveService {
  readonly model: ModelArtifact | null;
  readonly invalidReason: string | null;

  /** `artifact` = the parsed model JSON (or null). Anything invalid → rule-based estimates, labelled as such. */
  constructor(artifact: unknown | null) {
    const v = validateArtifact(artifact);
    this.model = v.ok ? v.model : null;
    this.invalidReason = v.ok ? null : v.reason;
  }

  get source(): 'ml' | 'rule' {
    return this.model ? 'ml' : 'rule';
  }

  get label(): typeof ML_LABEL | typeof RULE_LABEL {
    return this.model ? ML_LABEL : RULE_LABEL;
  }

  get modelVersion(): string | null {
    return this.model?.modelVersion ?? null;
  }

  /** P(detected within the next 15 s) with band, honest label and the top factors behind it. */
  detection(x: FeatureInput): RiskEstimate {
    const t = x.snapshot.t;
    const common = { t, source: this.source, label: this.label, modelVersion: this.modelVersion };
    if (x.snapshot.hydeMode === 'CHASE') {
      return { ...common, p: 1, band: 'high', detectedNow: true, topFactors: [{ feature: 'chase', label: 'The Hyde is chasing you now', direction: 'raises', weight: 1 }] };
    }
    if (!this.model) {
      const r = ruleDetection(x);
      return { ...common, p: r.p, band: bandFor(r.p), detectedNow: false, topFactors: r.factors };
    }
    const part = this.model.detection;
    const raw = featureVector(part.features, x);
    const z = standardise(part, raw);
    const p = clampP(logistic(part, raw));
    const contrib = part.features.map((name, i) => ({ name, c: part.coef[i + 1] * z[i + 1] }));
    // group features that describe the same thing, keep the strongest few
    const seen = new Set<string>();
    const top: RiskFactor[] = [];
    const rawOf = new Map(part.features.map((n, i) => [n, raw[i]]));
    for (const { name, c } of contrib.sort((a, b2) => Math.abs(b2.c) - Math.abs(a.c))) {
      if (Math.abs(c) < 0.05) break;
      // an indicator that is OFF explains nothing to a player ("not in room X"): skip it
      if (INDICATOR.test(name) && rawOf.get(name) === 0) continue;
      const raises = c > 0;
      const label = featureLabel(name, x, raises);
      if (seen.has(label)) continue;
      seen.add(label);
      top.push({ feature: name, label, direction: raises ? 'raises' : 'lowers', weight: Math.round(c * 1000) / 1000 });
      if (top.length >= 3) break;
    }
    return { ...common, p, band: bandFor(p), detectedNow: false, topFactors: top };
  }

  /** P(the egg reaches Iago Tower this run). */
  extraction(x: FeatureInput): ProbabilityEstimate {
    if (x.snapshot.eggState === 'delivered') return { p: 1, source: this.source, modelVersion: this.modelVersion };
    const part = this.model?.extraction;
    if (!part) return { p: ruleExtraction(x), source: 'rule', modelVersion: null };
    return { p: clampP(logistic(part, featureVector(part.features, x))), source: 'ml', modelVersion: this.modelVersion };
  }

  /** Seconds to the next progress event (clue / egg pickup / deposit), or null without a model or objective distance. */
  eta(x: FeatureInput): { seconds: number; source: 'ml' | 'rule' } | null {
    const part = this.model?.eta;
    const obj = x.snapshot.objective;
    if (obj === 'accuse' || obj === 'done') return null;
    if (part) return { seconds: Math.max(0, Math.round(linear(part, featureVector(part.features, x)) * 10) / 10), source: 'ml' };
    // rule: walking time to the objective + a fixed 4 s for searching / picking up
    const d = x.context?.objectiveDistM;
    if (d === null || d === undefined) return null;
    return { seconds: Math.round((d / (DEFAULT_TUNING.player.walkSpeed * x.duo.walkSpeedMult) + 4) * 10) / 10, source: 'rule' };
  }

  /** Dashboard ModelCard + the exact results-panel label. */
  modelCard(): ModelCard {
    const m = this.model;
    const det = m?.metrics?.detection ?? null;
    const resultsLabel = m
      ? det
        ? `${ML_LABEL} · trained on simulated episodes · held-out Brier ${fmt3(det.brier)} (baseline ${fmt3(det.baselineBrier)})`
        : `${ML_LABEL} · trained on simulated episodes · not yet evaluated`
      : `${RULE_LABEL} · no trained model loaded`;
    return {
      source: this.source,
      label: this.label,
      resultsLabel,
      modelType: m ? 'Logistic regression (L2, IRLS)' : null,
      target: `Detected within ${DETECTION_HORIZON_S} s (Hyde starts a chase or grabs you)`,
      modelVersion: m?.modelVersion ?? null,
      trainedOn: m?.trainedOn ?? null,
      episodes: m?.training.episodes ?? null,
      rowsTrain: m?.training.rowsTrain ?? null,
      rowsTest: m?.training.rowsTest ?? null,
      sessionsTest: m?.training.sessionsTest ?? null,
      split: m?.training.split ?? null,
      baseRate: det?.baseRate ?? null,
      brier: det?.brier ?? null,
      baselineBrier: det?.baselineBrier ?? null,
      auc: det?.auc ?? null,
      calibration: det?.calibration ?? [],
      extraction: m?.metrics?.extraction ? { brier: m.metrics.extraction.brier, baselineBrier: m.metrics.extraction.baselineBrier, baseRate: m.metrics.extraction.baseRate } : null,
      eta: m?.metrics?.eta ? { mae: m.metrics.eta.mae, naiveMae: m.metrics.eta.naiveMae } : null,
      note: m ? 'Validated on simulated data; live outcomes shown separately' : 'No trained model — stations show Rule-based risk estimate',
      invalidReason: this.invalidReason,
    };
  }
}

const INDICATOR = /^(room_|case_|obj_|mode_|stance_|egg_|hidden$|occluded$|inFog$|hydeNeutralized$)/;

function clampP(p: number): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.min(1, Math.max(0, p));
}
