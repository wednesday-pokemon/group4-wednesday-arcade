// MysteryAnalytics — the per-session orchestration the app wires into its loop. It owns one TelemetryCollector and
// drives the four services identically for every duo; Thing / HUD / results only PRESENT what it returns.
//
//   const analytics = new MysteryAnalytics(run, { sessionId, stationId, offered, model });
//   each frame:   const out = analytics.frame(run, run.update(dt, input));   // + the events returned by run.accuse()
//                 out.risk   → HUD risk chip (≤ 1 Hz);  out.advice → Thing advisory (V or context trigger)
//   results:      analytics.report()      → four analytics panels
//   Supabase:     analytics.pendingBatch() → body for mystery-append-events; analytics.ackBatch(batch) after 200
import type { MysteryRun } from '../run.ts';
import type { Duo, StampedEvent } from '../types.ts';
import { describeCollector } from './descriptive.ts';
import { diagnoseSession, topCauses } from './diagnostic.ts';
import { duoNumbers, type DuoNumbers, type FeatureInput } from './features.ts';
import { detectionTimes } from './labels.ts';
import { PredictiveService, type ModelCard } from './predictive.ts';
import { evaluateFollow, evaluateOutcome, PrescriptiveService, summariseAdvice, ENGINE_LABEL, type AdviceSummary, type FollowView } from './prescriptive.ts';
import { duoFactorsFromRun, liveContext } from './state.ts';
import { TelemetryCollector } from './telemetry.ts';
import type {
  Advice, AdviceRecord, DiagnosticItem, DiagnosticReport, RiskBand, RiskEstimate, SessionRecord, SessionReport, SupabaseBatch,
  TelemetrySample,
} from './types.ts';

export interface MysteryAnalyticsOptions {
  sessionId?: string | null;
  stationId?: string | null;
  /** The three offered duos (dashboard pick rates). */
  offered?: Duo[];
  /** Parsed model artifact; null / invalid → rule-based estimates (labelled). */
  model?: unknown | null;
  /** Thing context advice on Hyde alerts / egg drops (≥ 8 s apart, never right after a catch). Default true. */
  autoAdvice?: boolean;
  /** Seconds between detection forecasts stored for Supabase (band changes are always stored). Default 5. */
  forecastEveryS?: number;
}

export interface FrameOutput {
  /** Latest detection risk (updated at 1 Hz), null before the first sample / during the tutorial. */
  risk: RiskEstimate | null;
  /** New advice this frame (V pressed → 'hint', or a context trigger), else null. */
  advice: Advice | null;
  sampled: boolean;
}

export interface RiskPoint { t: number; p: number; band: RiskBand; detectedNow: boolean }

export interface ResultsAnalytics {
  descriptive: SessionReport;
  diagnostic: DiagnosticReport & { top: DiagnosticItem[]; topPattern: DiagnosticItem | null };
  predictive: {
    /** Exact panel line: "ML estimate · trained on simulated episodes · held-out Brier X (baseline Y)" or the rule-based line. */
    label: string;
    source: 'ml' | 'rule';
    series: RiskPoint[];
    detections: number[]; // times of detection events (claw ticks)
    card: ModelCard;
  };
  prescriptive: {
    engine: typeof ENGINE_LABEL;
    rows: { t: number; action: string; text: string; reason: string; trigger: 'hint' | 'context'; status: 'Followed' | 'Not followed' | 'No chance to' | 'Pending'; outcome: AdviceRecord['outcome'] }[];
    summary: AdviceSummary;
  };
}

const ALERT_TO = new Set(['INVESTIGATE_SOUND', 'SEARCH', 'CHASE']);

export class MysteryAnalytics {
  readonly collector: TelemetryCollector;
  readonly predictive: PredictiveService;
  readonly prescriptive = new PrescriptiveService();
  readonly offered: Duo[];
  private readonly duo: DuoNumbers;
  private readonly autoAdvice: boolean;
  private readonly forecastEveryS: number;
  private nextSampleT = 0;
  private risk: RiskEstimate | null = null;
  private readonly series: RiskPoint[] = [];
  private readonly advice: AdviceRecord[] = [];
  private lastAdviceT = -Infinity;
  private lastCatchT = -Infinity;
  private lastForecastT = -Infinity;
  private lastForecastBand: RiskBand | null = null;
  private ended = false;
  private readonly roomNames: Map<string, string>;

  constructor(run: MysteryRun, o: MysteryAnalyticsOptions = {}) {
    this.roomNames = new Map(run.map.rooms.map((r) => [r.id as string, r.name]));
    const factors = duoFactorsFromRun(run);
    this.collector = new TelemetryCollector({ sessionId: o.sessionId ?? null, stationId: o.stationId ?? null, duo: { ...run.duo }, factors });
    this.duo = duoNumbers(factors);
    this.predictive = new PredictiveService(o.model ?? null);
    this.offered = (o.offered ?? []).map((d) => ({ ...d }));
    this.autoAdvice = o.autoAdvice !== false;
    this.forecastEveryS = o.forecastEveryS ?? 5;
    this.collector.syncFromLog(run.log);
  }

  /** Call every frame with the events of that frame (also with the events returned by `run.accuse()`). */
  frame(run: MysteryRun, events: readonly StampedEvent[]): FrameOutput {
    this.collector.ingest(events);
    if (run.status === 'tutorial') return { risk: null, advice: null, sampled: false };
    for (const e of events) if (e.type === 'catch') this.lastCatchT = e.t;
    let sampled = false;
    if (run.status === 'playing') {
      this.collector.trackPosition(run.player.x, run.player.z);
      if (run.t >= this.nextSampleT) {
        this.sample(run);
        this.nextSampleT = Math.floor(run.t) + 1;
        sampled = true;
      }
    }
    let advice: Advice | null = null;
    if (events.some((e) => e.type === 'hint_requested')) advice = this.advise(run, 'hint');
    else if (this.autoAdvice && run.status === 'playing' && this.contextTrigger(run, events)) advice = this.advise(run, 'context');
    if (!this.ended && (run.status === 'finished' || run.status === 'dnf')) {
      this.ended = true;
      this.collector.setResult(run.result());
    }
    this.updateFollowUps();
    return { risk: this.risk, advice, sampled };
  }

  /** Current risk estimate (HUD chip). */
  currentRisk(): RiskEstimate | null {
    return this.risk;
  }

  /** On-demand advice without a V event (e.g. a UI button). Records it like a hint. */
  hint(run: MysteryRun): Advice | null {
    return this.advise(run, 'hint');
  }

  private featureInput(sample: TelemetrySample, prev: TelemetrySample | null): FeatureInput {
    return { snapshot: sample.snapshot, prev: prev?.snapshot ?? null, context: sample.context, duo: this.duo };
  }

  private sample(run: MysteryRun): void {
    const prev = this.collector.lastSample();
    const sample: TelemetrySample = { snapshot: run.snapshot(), context: liveContext(run, { objectivePath: false }) };
    this.collector.addSample(sample);
    const x = this.featureInput(sample, prev);
    const risk = this.predictive.detection(x);
    this.risk = risk;
    this.series.push({ t: risk.t, p: Math.round(risk.p * 1000) / 1000, band: risk.band, detectedNow: risk.detectedNow });
    if (!risk.detectedNow && (risk.t - this.lastForecastT >= this.forecastEveryS || risk.band !== this.lastForecastBand)) {
      this.lastForecastT = risk.t;
      this.lastForecastBand = risk.band;
      const s = sample.snapshot;
      this.collector.addForecast({
        t: risk.t, target: 'detection_15s', value: Math.round(risk.p * 10000) / 10000,
        modelLabel: risk.source === 'ml' ? 'ml' : 'rule_based', modelVersion: risk.modelVersion,
        features: {
          hydeDistanceM: s.hydeDistanceM, hydeMode: s.hydeMode, hydeOccluded: s.hydeOccluded, hydeSuspicion: s.hydeSuspicion,
          stance: s.stance, hidden: s.hidden, recentNoise: s.recentNoise, eggState: s.eggState, cluesFound: s.cluesFound,
          powerReady: s.powerReady, moveReady: s.moveReady, objective: s.objective, roomId: s.roomId, band: risk.band,
        },
      });
    }
  }

  private contextTrigger(run: MysteryRun, events: readonly StampedEvent[]): boolean {
    if (run.t - this.lastAdviceT < 8 || run.t - this.lastCatchT < 2.5) return false;
    if (events.some((e) => e.type === 'catch')) return false;
    return events.some((e) => (e.type === 'hyde_mode' && ALERT_TO.has(e.to)) || e.type === 'egg_drop');
  }

  private advise(run: MysteryRun, trigger: 'hint' | 'context'): Advice | null {
    const advice = this.prescriptive.recommend(run);
    if (!advice) return null;
    this.lastAdviceT = run.t;
    const rec = this.collector.addRecommendation({
      t: advice.t, action: advice.action, advice: `${advice.text} — Why: ${advice.reason}`, trigger, accepted: null, outcome: null,
    });
    this.advice.push({
      recNo: rec.recNo, t: advice.t, trigger, advice, followed: null, outcome: null,
      startPos: { x: run.player.x, z: run.player.z }, startHydeDistM: Math.hypot(run.hyde.x - run.player.x, run.hyde.z - run.player.z),
    });
    return advice;
  }

  private followView(): FollowView {
    return { events: this.collector.events, samples: this.collector.samples, nowT: this.collector.latestT(), ended: this.ended };
  }

  private updateFollowUps(): void {
    const v = this.followView();
    for (const r of this.advice) {
      const followed = r.followed ?? evaluateFollow(r, v);
      const outcome = r.outcome ?? evaluateOutcome(r, v);
      if (followed !== r.followed || outcome !== r.outcome) {
        r.followed = followed;
        r.outcome = outcome;
        this.collector.updateRecommendation(r.recNo, { accepted: followed, outcome });
      }
    }
  }

  get adviceRecords(): readonly AdviceRecord[] {
    return this.advice;
  }

  get riskSeries(): readonly RiskPoint[] {
    return this.series;
  }

  /** The four results panels (valid mid-run too; final once the run ended). */
  report(): ResultsAnalytics {
    const events = this.collector.events;
    const descriptive = describeCollector(this.collector);
    const first = this.collector.samples[0]?.snapshot;
    const diag = diagnoseSession(events, {
      initialStance: first?.stance, initialRoom: first?.roomId ?? null, factors: this.collector.meta.factors,
      roomName: (id) => this.roomNames.get(id) ?? id,
    });
    const card = this.predictive.modelCard();
    const rows = this.advice.map((r) => ({
      t: r.t, action: r.advice.action, text: r.advice.text, reason: r.advice.reason, trigger: r.trigger,
      status: (r.followed === true ? 'Followed' : r.followed === false ? 'Not followed' : this.ended ? 'No chance to' : 'Pending') as ResultsAnalytics['prescriptive']['rows'][number]['status'],
      outcome: r.outcome,
    }));
    return {
      descriptive,
      diagnostic: { ...diag, top: topCauses(diag.causes, 3), topPattern: diag.patterns[0] ?? null },
      predictive: { label: card.resultsLabel, source: card.source, series: [...this.series], detections: detectionTimes(events), card },
      prescriptive: { engine: ENGINE_LABEL, rows, summary: summariseAdvice(this.advice) },
    };
  }

  /** This session as a dashboard record (local / offline dashboard). */
  sessionRecord(): SessionRecord {
    const result = this.collector.result;
    return {
      sessionId: this.collector.meta.sessionId ?? 'local',
      duo: { ...this.collector.meta.duo },
      offered: this.offered.map((d) => ({ ...d })),
      events: this.collector.events,
      result: result ? { outcome: result.outcome, verdict: result.verdict, activeTimeS: result.activeTimeS, score: result.score, cluesFound: [...result.cluesFound], catches: result.catches } : null,
      recommendations: this.collector.recommendations.map((r) => ({ action: r.action, accepted: r.accepted, outcome: r.outcome })),
      forecasts: this.collector.forecasts.map((f) => ({ t: f.t, target: f.target, value: f.value, modelLabel: f.modelLabel })),
    };
  }

  pendingBatch(maxEvents?: number): SupabaseBatch | null {
    return this.collector.pendingBatch(maxEvents);
  }

  ackBatch(batch: SupabaseBatch): void {
    this.collector.ackBatch(batch);
  }
}
