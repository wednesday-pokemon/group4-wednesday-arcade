// Descriptive layer: telemetry records and aggregate summaries computed from REAL recorded sessions only.
import type {
  Advice, GameState, LegResolution, ScoreRecord, StationId, TelemetryEvent,
} from '../game/index.ts';
import type { LegPrediction } from './ravenVision.ts';

export type AdvisoryTelemetry = Pick<TelemetryEvent, 'predictedLegTimeS' | 'predictedCatchP' | 'advice'>;

export function advisoryFrom(prediction: LegPrediction | null, advice: Advice | null): AdvisoryTelemetry {
  return {
    predictedLegTimeS: prediction ? Number(prediction.legTimeS.toFixed(2)) : null,
    predictedCatchP: prediction ? Number(prediction.catchP.toFixed(4)) : null,
    advice,
  };
}

export function buildTelemetryEvent(
  state: GameState, stationId: StationId | 'local', resolution: LegResolution, advisory?: AdvisoryTelemetry,
): TelemetryEvent {
  return {
    sessionId: state.sessionId,
    stationId,
    legIndex: resolution.legIndex,
    createdAt: new Date().toISOString(),
    predictedLegTimeS: advisory?.predictedLegTimeS ?? null,
    predictedCatchP: advisory?.predictedCatchP ?? null,
    advice: advisory?.advice ?? null,
    resolution,
  };
}

export interface SessionSummary {
  totalSessions: number;
  completed: number;
  dnf: number;
  abandoned: number;
  inProgress: number;
  averageScore: number | null;
  bestScore: number | null;
  averageEggPoints: number | null;
  averageTimeS: number | null;
}

export function summariseRecords(records: ScoreRecord[]): SessionSummary {
  const done = records.filter((r) => r.status === 'completed');
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    totalSessions: records.length,
    completed: done.length,
    dnf: records.filter((r) => r.status === 'dnf').length,
    abandoned: records.filter((r) => r.status === 'abandoned').length,
    inProgress: records.filter((r) => r.status === 'in_progress').length,
    averageScore: avg(done.map((r) => r.finalScore)),
    bestScore: done.length ? Math.max(...done.map((r) => r.finalScore)) : null,
    averageEggPoints: avg(done.map((r) => r.finalEggPoints)),
    averageTimeS: avg(done.map((r) => r.totalSimulatedTimeCs / 100)),
  };
}

export interface LegStats {
  legs: number;
  shortcutShare: number | null;
  crashRate: number | null;
  catchRate: number | null;
  averageLegTimeS: number | null;
  predictionMaeS: number | null;
}

export function summariseTelemetry(events: TelemetryEvent[]): LegStats {
  const n = events.length;
  if (n === 0) return { legs: 0, shortcutShare: null, crashRate: null, catchRate: null, averageLegTimeS: null, predictionMaeS: null };
  const share = (pred: (e: TelemetryEvent) => boolean) => events.filter(pred).length / n;
  const predicted = events.filter((e) => e.predictedLegTimeS !== null);
  return {
    legs: n,
    shortcutShare: share((e) => e.resolution.route === 'shortcut'),
    crashRate: share((e) => e.resolution.crashOccurred),
    catchRate: share((e) => e.resolution.hydeCatch),
    averageLegTimeS: events.reduce((s, e) => s + e.resolution.time.totalCs, 0) / n / 100,
    predictionMaeS: predicted.length
      ? predicted.reduce((s, e) => s + Math.abs((e.predictedLegTimeS ?? 0) - e.resolution.time.totalCs / 100), 0) / predicted.length
      : null,
  };
}
