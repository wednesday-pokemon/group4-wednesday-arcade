// Probability display rules shared by the HUD Odds panel, the minimap / Tab map labels and the Tab Odds column
// (UX_OVERHAUL §7). Pure functions; the probabilities themselves come from the analytics layer (LiveForecasts).
//   * Round to 5 %; a group that is a distribution (Σp ≈ 1: Hyde zones, spawns, egg sites) uses largest-remainder
//     rounding so the shown numbers sum to exactly 100. Independent probabilities (clue areas: "≥ 1 clue here") are
//     rounded one by one — forcing them to sum to 100 would be false.
//   * Estimates display between 5 and 95: "<5%" below, ">95%" above. FACTS are words, never 0 / 100 %:
//     "Seen", "Searched", "Found", "Not here".
//   * Bands: ≥ 60 "likely", 30–55 "maybe", ≤ 25 "unlikely" (on the rounded value).

export type OddsBand = 'likely' | 'maybe' | 'unlikely';
/** Facts are words (never 0 / 100 %). The last three are Crackstone's own-spot facts (UX_ENEMIES §5). */
export type OddsFact = 'Seen' | 'Searched' | 'Found' | 'Not here' | 'Seen now' | 'Hidden' | 'Hunting you';

export interface OddsCell {
  /** Display text: "45%", "<5%", ">95%" or the fact word. */
  text: string;
  /** Rounded percent (multiple of the step) for estimates; null for facts. */
  pct: number | null;
  fact: OddsFact | null;
  band: OddsBand | null;
  /** The unrounded probability (bar length uses the rounded pct; this is kept for sorting / deltas). */
  p: number;
}

export const ODDS_STEP = 5;

/** Round one probability (0..1) to a multiple of `step` percent. */
export function roundPct(p: number, step = ODDS_STEP): number {
  const v = Math.max(0, Math.min(1, Number.isFinite(p) ? p : 0)) * 100;
  return Math.round(v / step) * step;
}

/**
 * Largest-remainder rounding of a distribution to `step`-percent units summing to exactly 100. The inputs are
 * renormalised first (so tiny floating drift never breaks the sum). An all-zero group returns zeros.
 */
export function roundGroup(ps: readonly number[], step = ODDS_STEP): number[] {
  const clean = ps.map((p) => (Number.isFinite(p) && p > 0 ? p : 0));
  const total = clean.reduce((s, p) => s + p, 0);
  if (total <= 0) return clean.map(() => 0);
  const units = Math.round(100 / step);
  const exact = clean.map((p) => (p / total) * units);
  const floors = exact.map((x) => Math.floor(x));
  let left = units - floors.reduce((s, x) => s + x, 0);
  // Largest remainder first; ties → larger p, then lower index (stable, deterministic).
  const order = exact
    .map((x, i) => ({ i, r: x - Math.floor(x), p: clean[i]! }))
    .sort((a, b) => b.r - a.r || b.p - a.p || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    floors[o.i]! += 1;
    left--;
  }
  return floors.map((u) => u * step);
}

/** ≥ 60 likely · 30–55 maybe · ≤ 25 unlikely. */
export function bandOf(pct: number): OddsBand {
  if (pct >= 60) return 'likely';
  if (pct >= 30) return 'maybe';
  return 'unlikely';
}

/** "<5%" / ">95%" / "45%" — an estimate is never shown as 0 or 100. */
export function pctText(pct: number): string {
  if (pct < 5) return '<5%';
  if (pct > 95) return '>95%';
  return `${pct}%`;
}

/** True when the values form a distribution (sum ≈ 1 within `tol`). */
export function isDistribution(ps: readonly number[], tol = 0.02): boolean {
  const s = ps.reduce((a, p) => a + (Number.isFinite(p) ? p : 0), 0);
  return Math.abs(s - 1) <= tol;
}

export interface OddsInput { p: number; fact?: OddsFact | null }

/**
 * Display cells for one probability group (same order as the input). Facts become words; the remaining estimates are
 * rounded together (largest remainder when they form a distribution, else one by one).
 */
export function oddsCells(group: readonly OddsInput[], o: { distribution?: boolean; step?: number } = {}): OddsCell[] {
  const step = o.step ?? ODDS_STEP;
  const estimates = group.map((g, i) => ({ i, p: g.p })).filter((x) => !group[x.i]!.fact);
  const dist = o.distribution ?? isDistribution(group.map((g) => g.p));
  const rounded = dist ? roundGroup(estimates.map((e) => e.p), step) : estimates.map((e) => roundPct(e.p, step));
  const byIndex = new Map<number, number>();
  estimates.forEach((e, k) => byIndex.set(e.i, rounded[k]!));
  return group.map((g, i) => {
    if (g.fact) return { text: g.fact, pct: null, fact: g.fact, band: null, p: g.p };
    const pct = byIndex.get(i) ?? 0;
    return { text: pctText(pct), pct, fact: null, band: bandOf(pct), p: g.p };
  });
}

/** Delta chip text "50% → 80%" (both sides already rounded). */
export function deltaText(fromPct: number, toPct: number): string {
  return `${pctText(fromPct)} → ${pctText(toPct)}`;
}

/** The exact source labels (UX §7.7). Rule-based risk keeps its own wording. */
export const SOURCE_LABEL = {
  ml: 'ML estimate',
  rule: 'Rule-based estimate',
  ruleRisk: 'Rule-based risk estimate',
  bayes: 'Bayesian estimate',
} as const;
