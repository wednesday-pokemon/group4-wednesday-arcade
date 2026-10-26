// MysteryAnalytics — the per-session orchestration the app wires into its loop. It owns one TelemetryCollector and
// drives the four services identically for every duo; Thing / HUD / results only PRESENT what it returns.
//
//   const analytics = new MysteryAnalytics(run, { sessionId, stationId, offered, model });
//   each frame:   const out = analytics.frame(run, run.update(dt, input));   // + the events returned by run.accuse()
//                 out.risk   → HUD risk chip (≤ 1 Hz);  out.advice → Thing advisory (V or context trigger)
//   live HUD:     analytics.live()        → LiveAnalytics (forecasts + new messages + current advice), 2–4 Hz
//                 analytics.hint(level)   → the R7 hint ladder card (the frontend owns V and the idle timer)
//   results:      analytics.report()      → four analytics panels
//   Supabase:     analytics.pendingBatch() → body for mystery-append-events; analytics.ackBatch(batch) after 200
//   Laptop 1:     analytics.heartbeat()   → the live numbers for the station heartbeat
import type { MysteryRun } from '../run.ts';
import type { CaseId, Duo, StampedEvent } from '../types.ts';
import { clueCountFor, isCaseId } from './caseInfo.ts';
import { describeCollector } from './descriptive.ts';
import { diagnoseSession, failureReasons, topCauses } from './diagnostic.ts';
import { duoNumbers, type DuoNumbers, type FeatureInput } from './features.ts';
import { detectionTimes } from './labels.ts';
import { PredictiveService, type ModelCard } from './predictive.ts';
import { evaluateFollow, evaluateOutcome, PrescriptiveService, summariseAdvice, ENGINE_LABEL, type AdviceSummary, type FollowView } from './prescriptive.ts';
import { duoFactorsFromRun, liveContext } from './state.ts';
import { TelemetryCollector, UPLOAD_FORECAST_TARGETS } from './telemetry.ts';
import { LiveEngine, type HeartbeatAnalytics } from './live.ts';
import { hydeEmergedOf, investigationOf, minSpawnM } from './publicState.ts';
import { CRACK_MODEL_VERSION } from './crackstoneRisk.ts';
import { pointInPolygon } from '../geometry.ts';
import { spawnProbabilities, zoneIndexAt } from './hydeZones.ts';
import { scoreV4 } from '../scoring.ts';
import { ENEMY_IDS } from '../types.ts';
import { weemsHint } from './weems.ts';
import { pointsLostItems, type PointsLostItem } from './insights.ts';
import type {
  Advice, AdviceRecord, DiagnosticItem, DiagnosticReport, ForecastRecord, ForecastTarget, LiveAnalytics, LiveMessage, LiveStats, ProbabilityEstimate,
  PredictionCheck, RiskBand, RiskEstimate, SessionRecord, SessionReport, SupabaseBatch, TelemetrySample, WeemsHint,
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
  /** Forecast targets included in uploads (others are kept locally). Default UPLOAD_FORECAST_TARGETS. */
  uploadForecastTargets?: readonly ForecastTarget[];
}

export interface FrameOutput {
  /** Latest detection risk (updated at 1 Hz), null before the first sample / during the tutorial. */
  risk: RiskEstimate | null;
  /** New Thing advice this frame (a context trigger), else null. Thing's advice is free (never a hint). */
  advice: Advice | null;
  /** Weems' hint for a `hint_requested {level}` of this frame (the sim counted it, −50), else null. */
  weems: WeemsHint | null;
  sampled: boolean;
}

export interface RiskPoint { t: number; p: number; band: RiskBand; detectedNow: boolean }

export interface ResultsAnalytics {
  descriptive: SessionReport;
  /** `reasons` = why this run fell short: incorrect deduction / missed clues of the case + top stealth mistakes. */
  diagnostic: DiagnosticReport & {
    top: DiagnosticItem[]; topPattern: DiagnosticItem | null; reasons: DiagnosticItem[];
    /** Analytics v2 "Why you lost points" (≤ 5, finished runs with a v4 breakdown; absent on old reports). */
    pointsLost?: PointsLostItem[];
  };
  predictive: {
    /** Exact panel line: "ML estimate · trained on simulated episodes · held-out Brier X (baseline Y)" or the rule-based line. */
    label: string;
    source: 'ml' | 'rule';
    series: RiskPoint[];
    detections: number[]; // times of detection events (claw ticks)
    card: ModelCard;
    /** Analytics v2: searched sites whose displayed probability was checked by the result (absent on old reports). */
    checks?: PredictionCheck[];
  };
  prescriptive: {
    engine: typeof ENGINE_LABEL;
    rows: { t: number; action: string; text: string; reason: string; trigger: 'hint' | 'context'; status: 'Followed' | 'Not followed' | 'No chance to' | 'Pending'; outcome: AdviceRecord['outcome'] }[];
    summary: AdviceSummary;
  };
}

const ALERT_TO = new Set(['INVESTIGATE_SOUND', 'SEARCH', 'CHASE']);
/** Seconds after which an unchanged estimate is stored again (egg / clue odds only change on observations). */
const REFRESH_FORECAST_S = 15;
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const key40 = (prefix: string, id: string) => `${prefix}${id}`.slice(0, 40);

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
  private lastCatchT = -Infinity;
  private lastForecastT = -Infinity;
  private lastForecastBand: RiskBand | null = null;
  private ended = false;
  private run: MysteryRun;
  /** The live layer (forecasts, Thing's Log / WHY / advice messages, hint ladder). */
  readonly engine: LiveEngine;
  private readonly lastStored = new Map<string, { t: number; top: string; p: number }>();
  private extractionEst: ProbabilityEstimate | null = null;
  private readonly roomNames: Map<string, string>;
  /** The case this session plays (from run.caseDef; null only for a run object without a case). */
  readonly caseId: CaseId | null;
  readonly caseVersion: number | null;
  private readonly clueTotal: number;
  /** Weems hints issued this run (Tab → "Weems' hints"), and those not yet returned by live(). */
  private readonly weemsLog: WeemsHint[] = [];
  private weemsQueue: WeemsHint[] = [];
  /** Analytics v2 prediction check-backs, reported by the HUD (it owns the DISPLAYED value of each site). */
  private readonly checks: PredictionCheck[] = [];

  constructor(run: MysteryRun, o: MysteryAnalyticsOptions = {}) {
    this.run = run;
    this.roomNames = new Map(run.map.rooms.map((r) => [r.id as string, r.name]));
    const caseDef = (run as Partial<Pick<MysteryRun, 'caseDef'>>).caseDef;
    this.caseId = caseDef && isCaseId(caseDef.id) ? caseDef.id : null;
    this.caseVersion = this.caseId && caseDef ? caseDef.version : null;
    this.clueTotal = caseDef?.clues.length || clueCountFor(this.caseId);
    const factors = duoFactorsFromRun(run);
    this.collector = new TelemetryCollector({
      sessionId: o.sessionId ?? null, stationId: o.stationId ?? null, caseId: this.caseId, caseVersion: this.caseVersion, duo: { ...run.duo }, factors,
    }, o.uploadForecastTargets ?? UPLOAD_FORECAST_TARGETS);
    this.duo = duoNumbers(factors);
    this.predictive = new PredictiveService(o.model ?? null);
    this.offered = (o.offered ?? []).map((d) => ({ ...d }));
    this.autoAdvice = o.autoAdvice !== false;
    this.forecastEveryS = o.forecastEveryS ?? 5;
    this.collector.syncFromLog(run.log);
    this.engine = new LiveEngine(run, this.prescriptive, o.model ?? null);
  }

  /** Call every frame with the events of that frame (also with the events returned by `run.accuse()`). */
  frame(run: MysteryRun, events: readonly StampedEvent[]): FrameOutput {
    this.run = run;
    this.collector.ingest(events);
    if (run.status === 'tutorial') return { risk: null, advice: null, weems: null, sampled: false };
    for (const e of events) if (e.type === 'catch') this.lastCatchT = e.t;
    this.engine.onEvents(run, events);
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
    let weems: WeemsHint | null = null;
    for (const e of events) {
      if (e.type !== 'hint_requested' || e.seq === 0) continue;
      // Principal Weems (paid, explicit): the sim emitted the counted request; we provide that level's content
      const level = e.level ?? 1;
      weems = weemsHint(run, level, this.weemsLog.filter((w) => w.level === level).length);
      this.weemsLog.push(weems);
      this.weemsQueue.push(weems);
      this.collector.addRecommendation({ t: weems.t, action: `weems_l${weems.level}`, advice: weems.text, trigger: 'hint', accepted: null, outcome: null });
    }
    if (!weems && this.autoAdvice && run.status === 'playing') {
      const threat = this.contextTrigger(run, events);
      // milestone: right after the pickup the next step (take the egg to Iago Tower) is the first carrying advice
      const pickup = !threat && events.some((e) => e.type === 'egg_pickup');
      const auto = threat ? this.engine.autoAdvice(run, true) : pickup ? this.engine.autoAdvice(run, false, true) : sampled ? this.engine.autoAdvice(run, false) : null;
      if (auto) {
        this.record(run, auto, 'context');
        advice = auto;
      }
    }
    if (!this.ended && (run.status === 'finished' || run.status === 'dnf')) {
      this.ended = true;
      this.collector.setResult(run.result());
    }
    this.updateFollowUps();
    return { risk: this.risk, advice, weems, sampled };
  }

  /** Current risk estimate (HUD chip). */
  currentRisk(): RiskEstimate | null {
    return this.risk;
  }

  /**
   * The R7 hint ladder card for `level` (1 area line · 2 most probable area as a target · 3 most probable candidate site).
   * `requested` = the visitor pressed V (P4, trigger 'hint'); false = the frontend's idle timer (P2, trigger 'context').
   * Recorded as a recommendation (follow-up tracked) unless the same V press was already recorded from the sim event.
   */
  hint(level: 1 | 2 | 3, o: { requested?: boolean } = {}): LiveMessage | null {
    // Final: this is THING's free ladder (idle nudges at 40 / 80 / 120 s) — never a hint_requested, never −50
    const run = this.run;
    const out = this.engine.hint(run, level, o.requested === true);
    if (!out) return null;
    this.record(run, out.advice, 'context');
    return out.msg.kind === 'advice' ? { ...out.msg, free: true } : out.msg;
  }

  /**
   * Principal Weems' content for `level` right now (FINAL_CONTRACT §8): L1 general area · L2 location / evidence link ·
   * L3 deduction guidance (never a name). Pure preview — the CHARGED hint is the one frame() builds for the sim's
   * `hint_requested {level}` (returned in FrameOutput.weems and live().weems).
   */
  weemsHint(level: 1 | 2 | 3): WeemsHint | null {
    const run = this.run;
    if (run.status !== 'playing' && run.status !== 'accusing') return null;
    return weemsHint(run, level, this.weemsLog.filter((w) => w.level === level).length);
  }

  /** Every Weems hint of this run, oldest first (Tab → "Weems' hints"). */
  weemsHints(): readonly WeemsHint[] {
    return this.weemsLog;
  }

  /** Live descriptive counters (exact rule-event counts) + the labelled "if you deliver now" score preview. */
  liveStats(): LiveStats {
    const run = this.run;
    const c = this.engine.ruleCounts();
    const detections = ENEMY_IDS.reduce((a, id) => a + c.detections[id], 0);
    const hits = ENEMY_IDS.reduce((a, id) => a + c.hits[id], 0);
    const activeTimeS = Math.round(((run as { deliveredAt?: number | null }).deliveredAt ?? run.t) * 10) / 10;
    const b = scoreV4({ delivered: true, correct: false, cluesFound: run.cluesFound.length, detections, hintsUsed: c.hintsUsed, hits, activeTimeS });
    const withAcc = scoreV4({ delivered: true, correct: true, cluesFound: run.cluesFound.length, detections, hintsUsed: c.hintsUsed, hits, activeTimeS });
    return {
      t: Math.round(run.t * 1000) / 1000, hintsUsed: c.hintsUsed, detections, detectionsBy: c.detections, hits, hitsBy: c.hits,
      blockedHits: c.blockedHits, cluesFound: run.cluesFound.length, cluesTotal: run.caseDef.clues.length, activeTimeS,
      scorePreview: {
        label: 'Preview · if you deliver now',
        parts: { delivery: b.delivery, clues: b.clues, noDetection: b.noDetection, noHints: b.noHints, timeBonus: b.timeBonus, hintPenalty: b.hintPenalty, hitPenalty: b.hitPenalty },
        totalNow: b.total, accusationBonus: withAcc.total - b.total,
      },
    };
  }

  /** Game-over WHY lines (UX_FINAL §3): what ended the run + the last rule cause before it ([] unless DNF). */
  gameOverWhy(): string[] {
    return this.engine.gameOverWhy(this.run);
  }

  /**
   * Live analytics for the HUD (cheap; call at 2–4 Hz): the four forecasts (Bayesian egg / clue odds, Hyde spawn or zone
   * odds, detection, extraction), the messages released since the last call (Thing's Log, WHY, automatic advice — already
   * rate-limited) and the current best feasible action.
   */
  live(): LiveAnalytics {
    const run = this.run;
    const weems = this.weemsQueue;
    this.weemsQueue = [];
    return {
      t: Math.round(run.t * 1000) / 1000, forecasts: this.engine.forecasts(run), messages: this.engine.drain(), advice: this.engine.currentAdvice(run),
      weems, stats: this.liveStats(),
    };
  }

  /** Numbers for the Laptop 1 heartbeat (objective, chases, escapes, top egg site, Hyde zone, extraction, last Thing item). */
  heartbeat(): HeartbeatAnalytics {
    return this.engine.heartbeat(this.run);
  }

  private featureInput(sample: TelemetrySample, prev: TelemetrySample | null): FeatureInput {
    return { snapshot: sample.snapshot, prev: prev?.snapshot ?? null, context: sample.context, duo: this.duo, caseId: this.caseId, clueTotal: this.clueTotal };
  }

  private sample(run: MysteryRun): void {
    const prev = this.collector.lastSample();
    const sample: TelemetrySample = { snapshot: run.snapshot(), context: liveContext(run, { objectivePath: false }) };
    this.collector.addSample(sample);
    const x = this.featureInput(sample, prev);
    const emerged = hydeEmergedOf(run);
    const extraction = this.predictive.extraction(x);
    this.extractionEst = extraction;
    if (!emerged) {
      // the Hyde is absent: no detection risk to forecast (the HUD shows the spawn odds instead)
      this.risk = null;
      this.engine.onSample(run, null, extraction, sample.snapshot.hydeVisible);
      this.storeLiveForecasts(run, sample);
      return;
    }
    const risk = this.predictive.detection(x);
    this.risk = risk;
    this.engine.onSample(run, risk, extraction, sample.snapshot.hydeVisible);
    this.storeLiveForecasts(run, sample);
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

  /**
   * Stores the overhaul forecasts for Supabase (sampled): egg_site / clue_area on a meaningful change (top id changed or
   * |Δp| ≥ 0.02) or every 15 s; hyde_spawn / hyde_zone / extraction every `forecastEveryS` (or on a change ≥ 0.05).
   * `features` are flat primitives (site / zone ids as string values and `p_<id>` keys).
   */
  private storeLiveForecasts(run: MysteryRun, sample: TelemetrySample): void {
    const t = sample.snapshot.t;
    const f = this.engine.forecasts(run);
    const inv = investigationOf(run);
    const put = (target: ForecastTarget, top: string, p: number, label: ForecastRecord['modelLabel'], version: string | null, features: ForecastRecord['features'], everyS: number, minDelta: number, key: string = target) => {
      const last = this.lastStored.get(key);
      if (last && last.top === top && Math.abs(last.p - p) < minDelta && t - last.t < everyS) return;
      this.lastStored.set(key, { t, top, p });
      this.collector.addForecast({ t, target, value: r4(Math.min(1, Math.max(0, p))), modelLabel: label, modelVersion: version, features });
    };
    if (f.egg && f.egg.sites.length > 0) {
      const top = f.egg.sites.reduce((a, b) => (b.p > a.p ? b : a));
      const features: ForecastRecord['features'] = { method: 'bayes', site: top.siteId, traces: inv.traces.length, checked: inv.checkedEggSites.length, seen: inv.eggSeenAt !== null };
      for (const s of f.egg.sites.slice(0, 12)) features[key40('p_', s.siteId)] = r4(s.p);
      put('egg_site', top.siteId, top.p, 'rule_based', 'bayes-1', features, REFRESH_FORECAST_S, 0.02);
    }
    if (f.clueAreas && f.clueAreas.areas.length > 0) {
      const top = f.clueAreas.areas.reduce((a, b) => (b.p > a.p ? b : a));
      const features: ForecastRecord['features'] = { method: 'bayes', area: top.areaId, clues: run.cluesFound.length, checked: inv.checkedClueSites.length };
      for (const a of f.clueAreas.areas.slice(0, 12)) features[key40('p_', a.areaId)] = r4(a.p);
      put('clue_area', top.areaId, top.p, 'rule_based', 'bayes-1', features, REFRESH_FORECAST_S, 0.02);
    }
    if (f.hyde.phase === 'before_emergence') {
      const spawns = f.hyde.spawns.length > 0 ? f.hyde.spawns : (this.engine.world ? spawnProbabilities(this.engine.world, run.player, minSpawnM(run)) : []);
      if (spawns.length > 0) {
        const top = spawns.reduce((a, b) => (b.p > a.p ? b : a));
        const features: ForecastRecord['features'] = { method: 'spawn_rule', spawn: top.spawnId, emergesInS: f.hyde.emergesInS };
        for (const s of spawns.slice(0, 12)) features[key40('p_', s.spawnId)] = r4(s.p);
        put('hyde_spawn', top.spawnId, top.p, 'rule_based', 'spawn-rule-1', features, this.forecastEveryS, 0.05);
      }
    } else if (f.hyde.zones.length > 0) {
      const top = f.hyde.zones.reduce((a, b) => (b.p > a.p ? b : a));
      const world = this.engine.world;
      const own = world ? world.zones[zoneIndexAt(world.zones, run.player.x, run.player.z)]?.id ?? null : null;
      const features: ForecastRecord['features'] = { method: 'zone_hmm', zone: top.zoneId, visible: sample.snapshot.hydeVisible === true, mode: sample.snapshot.hydeMode, own };
      for (const z of f.hyde.zones.slice(0, 12)) features[key40('p_', z.zoneId)] = r4(z.p);
      put('hyde_zone', top.zoneId, top.p, 'rule_based', 'zone-hmm-1', features, this.forecastEveryS, 0.05);
    }
    // Joseph Crackstone: the rule-based P(he sees / scans the player at their spot within 10 s) — every forecastEveryS
    // or on a change ≥ 0.1 (flat features: mode, fact, basis, in his area; never his position)
    const cf = f.crackstone;
    if (cf) {
      const p = run.player;
      const inArea = pointInPolygon(p.x, p.z, cf.area.polygon);
      put('crackstone_risk', `${cf.mode ?? ''}|${cf.here.fact ?? ''}`, cf.here.p, 'rule_based', CRACK_MODEL_VERSION, {
        method: 'crack_rule', horizon_s: cf.horizonS, mode: cf.mode ?? null, fact: cf.here.fact, basis: cf.basis ?? null, in_area: inArea,
        cells: cf.cells.length,
      }, this.forecastEveryS, 0.1);
    }
    // Final (LOCAL until the server accepts the targets): Slurp's rule-based risk; the director's spawn odds per inactive enemy
    const sf = f.slurp;
    if (sf) {
      put('slurp_risk', `${sf.mode}|${sf.here.fact ?? ''}`, sf.here.p, 'rule_based', 'slurp-rule-1', {
        method: 'slurp_rule', horizon_s: sf.horizonS, mode: sf.mode, fact: sf.here.fact, cells: sf.cells.length,
      }, this.forecastEveryS, 0.1);
    }
    for (const layer of Object.values(f.threat?.enemies ?? {})) {
      if (!layer || layer.state !== 'inactive' || !layer.spawns || layer.spawns.length === 0) continue;
      const top = layer.spawns.reduce((a, b) => (b.p > a.p ? b : a));
      if (!(top.p > 0)) continue;
      const features: ForecastRecord['features'] = { method: 'director_rule', enemy: layer.enemy, spawn: top.spawnId, appears_in_s: layer.appearsInS };
      for (const sp of layer.spawns.slice(0, 12)) features[key40('p_', sp.spawnId)] = r4(sp.p);
      put('enemy_spawn', top.spawnId, top.p, 'rule_based', 'director-rule-1', features, this.forecastEveryS, 0.05, `enemy_spawn:${layer.enemy}`);
    }
    const ex = this.extractionEst;
    if (ex) {
      const s = sample.snapshot;
      put('extraction', ex.source, ex.p, ex.source === 'ml' ? 'ml' : 'rule_based', ex.modelVersion, {
        catches: s.catches, hp: s.hp, eggState: s.eggState, eggSecurity: s.eggSecurity, cluesFound: s.cluesFound, objective: s.objective,
      }, this.forecastEveryS, 0.05);
    }
  }

  private contextTrigger(run: MysteryRun, events: readonly StampedEvent[]): boolean {
    if (run.t - this.lastCatchT < 2.5) return false;
    if (events.some((e) => e.type === 'catch')) return false;
    return events.some((e) => (e.type === 'hyde_mode' && ALERT_TO.has(e.to)) || e.type === 'egg_drop'
      || (e.type === 'crackstone_mode' && ((e.to === 'CHASE' && e.from !== 'ATTACK') || e.to === 'INVESTIGATE') && e.reason !== 'deferred' && e.reason !== 'lured'));
  }

  private record(run: MysteryRun, advice: Advice, trigger: 'hint' | 'context'): void {
    const rec = this.collector.addRecommendation({
      t: advice.t, action: advice.action, advice: `${advice.text} — Why: ${advice.reason}`, trigger, accepted: null, outcome: null,
    });
    this.advice.push({
      recNo: rec.recNo, t: advice.t, trigger, advice, followed: null, outcome: null,
      startPos: { x: run.player.x, z: run.player.z }, startHydeDistM: Math.hypot(run.hyde.x - run.player.x, run.hyde.z - run.player.z),
    });
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
        if (followed !== r.followed) this.engine.noteFollowed(r.advice.text, followed);
        r.followed = followed;
        r.outcome = outcome;
        this.collector.updateRecommendation(r.recNo, { accepted: followed, outcome });
      }
    }
  }

  /**
   * Analytics v2: the HUD searched a site whose probability it displayed just before (public forecast, display rounding)
   * and the result is known. One entry per site check; the results screen counts them ("N of M right").
   */
  notePredictionCheck(c: PredictionCheck): void {
    if (!Number.isFinite(c.pct) || this.checks.some((x) => x.siteId === c.siteId && x.site === c.site && x.t === c.t)) return;
    this.checks.push({ ...c });
  }

  get predictionChecks(): readonly PredictionCheck[] {
    return this.checks;
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
    const result = this.collector.result;
    const diag = diagnoseSession(events, {
      initialStance: first?.stance, initialRoom: first?.roomId ?? null, factors: this.collector.meta.factors,
      roomName: (id) => this.roomNames.get(id) ?? id, caseId: this.caseId, result,
    });
    const card = this.predictive.modelCard();
    const rows = this.advice.map((r) => ({
      t: r.t, action: r.advice.action, text: r.advice.text, reason: r.advice.reason, trigger: r.trigger,
      status: (r.followed === true ? 'Followed' : r.followed === false ? 'Not followed' : this.ended ? 'No chance to' : 'Pending') as ResultsAnalytics['prescriptive']['rows'][number]['status'],
      outcome: r.outcome,
    }));
    return {
      descriptive,
      diagnostic: {
        ...diag, top: topCauses(diag.causes, 3), topPattern: diag.patterns[0] ?? null, reasons: failureReasons(diag),
        pointsLost: result?.outcome === 'finished' ? pointsLostItems(events, result.scoreBreakdown ?? null, { initialStance: first?.stance }) : [],
      },
      predictive: { label: card.resultsLabel, source: card.source, series: [...this.series], detections: detectionTimes(events), card, checks: this.checks.map((c) => ({ ...c })) },
      prescriptive: { engine: ENGINE_LABEL, rows, summary: summariseAdvice(this.advice) },
    };
  }

  /** This session as a dashboard record (local / offline dashboard). */
  sessionRecord(): SessionRecord {
    const result = this.collector.result;
    return {
      sessionId: this.collector.meta.sessionId ?? 'local',
      caseId: this.caseId,
      caseVersion: this.caseVersion,
      duo: { ...this.collector.meta.duo },
      offered: this.offered.map((d) => ({ ...d })),
      events: this.collector.events,
      result: result
        ? {
          outcome: result.outcome, verdict: result.verdict, activeTimeS: result.activeTimeS, score: result.score, cluesFound: [...result.cluesFound],
          catches: result.catches, caseId: result.caseId, caseVersion: result.caseVersion, correct: result.correct,
          deductionCorrect: result.deductionCorrect, eggPoints: result.eggPoints, rulesVersion: result.rulesVersion,
          ...(result.hintsUsed !== undefined ? { hintsUsed: result.hintsUsed } : {}),
          ...(result.detections !== undefined ? { detections: result.detections } : {}),
          ...(result.hits !== undefined ? { hits: result.hits } : {}),
          ...(result.defeatedBy !== undefined ? { defeatedBy: result.defeatedBy } : {}),
          ...(result.scoreBreakdown !== undefined ? { scoreBreakdown: result.scoreBreakdown } : {}),
        }
        : null,
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
