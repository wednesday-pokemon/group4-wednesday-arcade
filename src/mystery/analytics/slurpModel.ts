// Slurp "finds you" — the LIVE probability shown on the Odds row (UX_FINAL §1c) is an ML ESTIMATE when the bundled
// artifact carries a validated `slurpRisk` part, else the raw rule (encounter.ts, labelled "Rule-based estimate").
// The model is a logistic regression trained on SIMULATED episodes (scripts/mystery-train.ts, session-grouped split,
// held-out metrics in docs/MYSTERY_MODEL_REPORT.md §11.1). Its inputs are public at t only:
//   rule_logit   logit of the rule-based P(Slurp finds you within 15 s) (wander filter + his senses, encounter.ts)
//   mode_*       his public HUD mode (WANDER = base; INVESTIGATE, SEARCH, LEAVE)
//   stance_*     your own stance (walk = base; idle, crouch, sprint)
//   hidden       you are in a crouch spot / an open cabinet
// Label: `enemy_detected` / `enemy_hit` {slurp} within (t, t + 15 s], for rows where he is on the map and neither hunts
// nor sees you at t (those are facts: p = 1). The 4 m map cells stay the raw rule (a stand-still estimate per spot).
import type { SlurpMode, Stance } from '../types.ts';

export const SLURP_FEATURES = ['rule_logit', 'mode_INVESTIGATE', 'mode_SEARCH', 'mode_LEAVE', 'stance_idle', 'stance_crouch', 'stance_sprint', 'hidden'] as const;
export type SlurpFeature = (typeof SLURP_FEATURES)[number];

export interface SlurpRiskPart {
  method: 'logistic_regression';
  modelVersion: string;
  trainedOn: string;
  horizonS: number;
  features: SlurpFeature[];
  mean: number[];
  std: number[];
  coef: number[]; // [bias, ...per feature]
  /** Held-out metrics (scripts/mystery-evaluate.ts), when evaluated. */
  metrics?: { brier: number; ruleBrier: number; constantBrier: number; rows: number; sessions: number } | null;
}

export interface SlurpInput { ruleP: number; mode: SlurpMode | string; stance: Stance | string; hidden: boolean }

export function slurpFeatureVector(x: SlurpInput): number[] {
  const p = Math.min(0.995, Math.max(0.005, Number.isFinite(x.ruleP) ? x.ruleP : 0));
  const v: Record<SlurpFeature, number> = {
    rule_logit: Math.log(p / (1 - p)),
    mode_INVESTIGATE: x.mode === 'INVESTIGATE' ? 1 : 0,
    mode_SEARCH: x.mode === 'SEARCH' ? 1 : 0,
    mode_LEAVE: x.mode === 'LEAVE' ? 1 : 0,
    stance_idle: x.stance === 'idle' ? 1 : 0,
    stance_crouch: x.stance === 'crouch' ? 1 : 0,
    stance_sprint: x.stance === 'sprint' ? 1 : 0,
    hidden: x.hidden ? 1 : 0,
  };
  return SLURP_FEATURES.map((k) => v[k]);
}

/** The validated slurpRisk part of a model artifact, else null (→ the raw rule, labelled rule-based). */
export function slurpRiskFrom(artifact: unknown): SlurpRiskPart | null {
  const s = (artifact as { slurpRisk?: Partial<SlurpRiskPart> } | null)?.slurpRisk;
  if (!s || s.method !== 'logistic_regression' || typeof s.modelVersion !== 'string' || typeof s.trainedOn !== 'string' || !/simulated/i.test(s.trainedOn)) return null;
  const k = SLURP_FEATURES.length;
  const fin = (a: unknown, n: number): a is number[] => Array.isArray(a) && a.length === n && a.every((x) => typeof x === 'number' && Number.isFinite(x));
  if (!Array.isArray(s.features) || s.features.length !== k || s.features.some((f, i) => f !== SLURP_FEATURES[i])) return null;
  if (!fin(s.mean, k) || !fin(s.std, k) || !(s.std as number[]).every((x) => x > 0) || !fin(s.coef, k + 1)) return null;
  return s as SlurpRiskPart;
}

export function slurpRiskP(part: SlurpRiskPart, x: SlurpInput): number {
  const v = slurpFeatureVector(x);
  let z = part.coef[0];
  for (let i = 0; i < v.length; i++) z += part.coef[i + 1] * ((v[i] - part.mean[i]) / part.std[i]);
  return 1 / (1 + Math.exp(-z));
}
