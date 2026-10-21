// Laptop 1 aggregates: one distinct, testable panel per analytics layer, computed from session records (rows rebuilt
// from Supabase — see eventFromRow — or local MysteryAnalytics.sessionRecord()). Works for any mix of duos.
import { aggregateSessions, type DescriptiveAggregate } from './descriptive.ts';
import { aggregateDiagnostics, type DiagnosticAggregate } from './diagnostic.ts';
import { anyWithin, detectionTimes, DETECTION_HORIZON_S } from './labels.ts';
import type { ModelCard, PredictiveService } from './predictive.ts';
import type { SessionRecord } from './types.ts';

export interface LiveForecastCheck {
  /** Detection forecasts whose 15 s window has been observed. Observational, live sessions only. */
  n: number;
  meanForecast: number | null;
  observedRate: number | null;
  brier: number | null;
  bySource: { ml: number; rule_based: number };
  note: string;
}

export interface PrescriptiveAggregate {
  byAction: { action: string; given: number; followed: number; followedPct: number | null; undetectedAfterFollowed: number; followedObserved: number; undetectedAfterNotFollowed: number; notFollowedObserved: number }[];
  given: number;
  uptakePct: number | null;
  undetectedAfterFollowedPct: number | null;
  undetectedAfterNotFollowedPct: number | null;
  note: string;
}

export interface DashboardAggregates {
  descriptive: DescriptiveAggregate;
  diagnostic: DiagnosticAggregate;
  predictive: { card: ModelCard; live: LiveForecastCheck };
  prescriptive: PrescriptiveAggregate;
}

/** Live check of stored detection forecasts against what then happened (never mixed with the simulated validation). */
export function liveForecastCheck(records: readonly SessionRecord[]): LiveForecastCheck {
  const ps: number[] = [];
  const ys: number[] = [];
  const bySource = { ml: 0, rule_based: 0 };
  for (const r of records) {
    const det = detectionTimes(r.events);
    const last = r.events[r.events.length - 1];
    const ended = last !== undefined && (last.type === 'finish' || last.type === 'dnf');
    const endT = r.result?.activeTimeS ?? last?.t ?? 0;
    for (const f of r.forecasts ?? []) {
      if (f.target !== 'detection_15s') continue;
      const observed = anyWithin(det, f.t);
      if (!observed && !ended && f.t + DETECTION_HORIZON_S > endT) continue; // window still open
      ps.push(f.value);
      ys.push(observed ? 1 : 0);
      bySource[f.modelLabel]++;
    }
  }
  const n = ps.length;
  return {
    n,
    meanForecast: n ? ps.reduce((a, b) => a + b, 0) / n : null,
    observedRate: n ? ys.reduce((a, b) => a + b, 0) / n : null,
    brier: n ? ps.reduce((s, p, i) => s + (p - ys[i]) ** 2, 0) / n : null,
    bySource,
    note: 'Live sessions, observational; shown separately from the simulated validation.',
  };
}

export function aggregatePrescriptive(records: readonly SessionRecord[]): PrescriptiveAggregate {
  const by = new Map<string, PrescriptiveAggregate['byAction'][number]>();
  let given = 0;
  let followed = 0;
  let decided = 0;
  let fo = 0;
  let fu = 0;
  let no = 0;
  let nu = 0;
  for (const r of records) {
    for (const rec of r.recommendations ?? []) {
      given++;
      const a = by.get(rec.action) ?? { action: rec.action, given: 0, followed: 0, followedPct: null, undetectedAfterFollowed: 0, followedObserved: 0, undetectedAfterNotFollowed: 0, notFollowedObserved: 0 };
      a.given++;
      if (rec.accepted !== null) decided++;
      if (rec.accepted === true) {
        a.followed++;
        followed++;
        if (rec.outcome) {
          a.followedObserved++;
          fo++;
          if (rec.outcome === 'undetected_15s') {
            a.undetectedAfterFollowed++;
            fu++;
          }
        }
      } else if (rec.accepted === false && rec.outcome) {
        a.notFollowedObserved++;
        no++;
        if (rec.outcome === 'undetected_15s') {
          a.undetectedAfterNotFollowed++;
          nu++;
        }
      }
      by.set(rec.action, a);
    }
  }
  for (const a of by.values()) a.followedPct = a.given ? (100 * a.followed) / a.given : null;
  return {
    byAction: [...by.values()].sort((x, y) => y.given - x.given || x.action.localeCompare(y.action)),
    given,
    uptakePct: decided ? (100 * followed) / decided : null,
    undetectedAfterFollowedPct: fo ? (100 * fu) / fo : null,
    undetectedAfterNotFollowedPct: no ? (100 * nu) / no : null,
    note: 'Observational: outcomes AFTER advice was or was not followed, not caused by it.',
  };
}

export function dashboardAggregates(records: readonly SessionRecord[], predictive: PredictiveService, clueIds: readonly string[] = []): DashboardAggregates {
  return {
    descriptive: aggregateSessions(records, clueIds),
    diagnostic: aggregateDiagnostics(records),
    predictive: { card: predictive.modelCard(), live: liveForecastCheck(records) },
    prescriptive: aggregatePrescriptive(records),
  };
}
