// LiveEngine — the four analytics DURING play, for every duo (overhaul; docs/overhaul/OVERHAUL_CONTRACT.md "Analytics",
// UX_OVERHAUL.md §6/§7, R6/R7). Owned by MysteryAnalytics; cheap enough for live() at 2–4 Hz:
//   • Predictive: egg-site + clue-area posteriors (exact Bayes, bayes.ts) recomputed from the public observations;
//     Hyde spawn odds (exact rule) before emergence, the zone filter (hydeZones.ts) after — stepped on the 1 Hz samples;
//     detection (existing model / rule) null before emergence; extraction (existing model / rule).
//   • Descriptive + diagnostic: Thing's Log and WHY messages from the event stream (liveMessages.ts), rate-limited.
//   • Prescriptive: one feasible action (prescriptive.ts) refreshed ≤ 1 Hz; automatic advice ≥ 12 s apart, the same
//     action not within 30 s, skipped when already done; the R7 hint ladder on request.
// Reads only publicState.ts / view.ts for player-facing estimates — never the session's hidden layout.
// Joseph Crackstone (enemy contract): forecasts.crackstone = the rule-based risk (crackstoneRisk.ts via crackstoneLive.ts,
// ≤ 1 Hz), his WHY / LOG messages (liveMessages.ts), the area intro once ~3 s after play starts (P2, THING.crackstone
// lines), Crackstone-aware advice (prescriptive.ts; card title CRACKSTONE) and heartbeat fields. Scan / curse advice is
// the banner's companion: it is the current card (live().advice) but never pushed into the message stream.
import { CASES } from '../data/cases.ts';
import { ENEMY_IDS } from '../types.ts';
import { formatThingLine, THING } from '../data/thing.ts';
import { REGISTRIES } from '../draft.ts';
import type { MysteryRun } from '../run.ts';
import type { CaseWorldDef, CrackstoneMode, EnemyId, HydeMode, StampedEvent } from '../types.ts';
import { clueAreaProbabilities, EggTracker } from './bayes.ts';
import {
  buildZoneModel, spawnProbabilities, ZONE_FILTER_DEFAULTS, zoneIndexAt, zoneProbs, ZoneTracker, type ZoneFilterParams, type ZoneModel,
} from './hydeZones.ts';
import { CrackstoneLive, crackstoneRiskFor } from './crackstoneLive.ts';
import { directorManages, EncounterLive } from './encounterLive.ts';
import { slurpRiskFrom } from './slurpModel.ts';
import { EventRules, isCrackThreat, isSlurpThreat, isThreat, MessageGate, P, TITLES, ADVICE_MAX, WHY_MAX } from './liveMessages.ts';
import { cabinetDoorPhase, oddsCopy, type PrescriptiveService } from './prescriptive.ts';
import {
  cabinetOf, crackstoneModeOf, hydeActiveOf, hydeEmergedOf, hydeVisibleOf, investigationOf, minSpawnM, slurpOf, visibleHydePosition, worldOf,
} from './publicState.ts';
import type { Advice, AdviceOption, CrackstoneForecast, LiveForecasts, LiveMessage, ProbabilityEstimate, RiskEstimate, ThreatMap, ZoneProb } from './types.ts';
import { publicView, topEggSite } from './view.ts';

export const LABEL_BAYES = 'Bayesian estimate' as const;
export const LABEL_RULE = 'Rule-based estimate' as const;
export const LABEL_ML = 'ML estimate' as const;

export const AUTO_ADVICE_GAP_S = 12;
export const SAME_ACTION_GAP_S = 30;
export const SAME_TARGET_GAP_S = 60;
export const ADVICE_REFRESH_S = 1;
/** After a milestone (egg pickup) the next step is advised once the previous card is ≥ this old. */
export const MILESTONE_GAP_S = 4;
/** Spectator rule: an egg-site probability at or above this counts as located (never broadcast with its site). */
export const EGG_LOCATED_P = 0.95;
/** UX_ENEMIES §6: the Crackstone area intro ~3 s after play starts (once). */
export const CRACK_INTRO_AFTER_S = 3;
/** Advice the HUD banners own (scan / curse telegraphs): the current card, never a pushed message. */
const BANNER_ACTIONS: ReadonlySet<string> = new Set(['take_cover', 'leave_curse']);

function fit(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Validated zone-filter parameters from the model artifact (selected on training sessions), else the defaults. */
export function zoneParamsFrom(artifact: unknown): ZoneFilterParams {
  const zf = (artifact as { zoneFilter?: { params?: Partial<Record<keyof ZoneFilterParams, unknown>> } } | null)?.zoneFilter?.params;
  const out: ZoneFilterParams = { ...ZONE_FILTER_DEFAULTS };
  if (!zf) return out;
  const ok = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  if (ok(zf.beta, 0.01, 1)) out.beta = zf.beta;
  if (ok(zf.diffusionPerS, 0, 1)) out.diffusionPerS = zf.diffusionPerS;
  if (ok(zf.offPatrolReturnPerS, 0, 2)) out.offPatrolReturnPerS = zf.offPatrolReturnPerS;
  if (ok(zf.chaseNearM, 1, 60)) out.chaseNearM = zf.chaseNearM;
  if (ok(zf.chaseFarLikelihood, 0, 1)) out.chaseFarLikelihood = zf.chaseFarLikelihood;
  if (ok(zf.alertNearM, 1, 80)) out.alertNearM = zf.alertNearM;
  if (ok(zf.alertFarLikelihood, 0, 1)) out.alertFarLikelihood = zf.alertFarLikelihood;
  return out;
}

/** The Hyde's patrol speed from the tuning (falls back to the designer default 2.4 m/s). */
function patrolSpeed(run: Pick<MysteryRun, 'tuning'>): number {
  const v = (run.tuning.hyde as { speed?: Partial<Record<HydeMode, number>> }).speed?.PATROL;
  return typeof v === 'number' && v > 0 ? v : 2.4;
}

/** Zone filter for one session's map + world (null when the world has no zones). */
export function zoneModelFor(run: Pick<MysteryRun, 'map' | 'caseDef' | 'tuning'>, params: ZoneFilterParams): ZoneModel | null {
  const world = worldOf(run);
  if (!world || world.zones.length === 0) return null;
  return buildZoneModel(world.zones, run.map.patrol, patrolSpeed(run), params);
}

export interface HeartbeatAnalytics {
  objective: string | null;
  chases: number;
  escapes: number;
  catches: number;
  hydeEmerged: boolean;
  hydePhase: 'before_emergence' | 'active';
  hydeZone: { id: string; p: number } | null;
  /**
   * The most probable candidate egg site while the egg is still UNCERTAIN to the player (not seen, top p < 0.95,
   * not carried). Null once it is located — Laptop 1 is visible to the whole booth and must never name the true site.
   */
  eggSite: { id: string; p: number } | null;
  /** The player located the egg (seen at its site, or the posterior is ≥ 0.95) — the board says "located", no name. */
  eggLocated: boolean;
  extraction: { p: number; source: 'ml' | 'rule_based' } | null;
  clues: number;
  cluesTotal: number;
  /** The newest Thing card: kind + stable code (diagnostic code / advice action) + token ref + local text + follow-up. */
  lastThing: { kind: LiveMessage['kind']; code: string; ref: string | null; text: string; followed: boolean | null } | null;
  /** Joseph Crackstone (enemy contract): present in this case, his public mode (HUD pill), chasing / cursing now. */
  crackstonePresent: boolean;
  crackstoneMode: CrackstoneMode | null;
  crackstoneChase: boolean;
  /** His encounters (chase onsets) and escapes this run. */
  crackstoneChases: number;
  crackstoneEscapes: number;
  /** forecasts.crackstone.here.p (rule-based), null without him / before play. Never his position. */
  crackstoneRisk: number | null;
  // ---- final (director / Slurp / scoring evidence) — enums and counts only, never a position
  /** Per enemy: present on this map, on the map now, its public mode (null while away). */
  enemies: Record<EnemyId, { present: boolean; active: boolean; mode: string | null }>;
  slurpChase: boolean;
  slurpChases: number;
  slurpEscapes: number;
  /** forecasts.slurp.here.p (rule-based), null while he is away / absent. */
  slurpRisk: number | null;
  /** Exact rule-event counts: Weems hints, detections, hits (all enemies). */
  hintsUsed: number;
  detections: number;
  hits: number;
  /** Inside a cabinet: 'open' / 'closed' (null outside). */
  cabinet: 'open' | 'closed' | null;
}

export class LiveEngine {
  readonly world: CaseWorldDef | null;
  readonly zoneModel: ZoneModel | null;
  readonly zoneParams: ZoneFilterParams;
  private readonly tracker: ZoneTracker | null;
  private readonly rules: EventRules;
  private readonly gate = new MessageGate();
  private readonly egg: EggTracker;
  private queue: LiveMessage[] = [];
  private zoneP: number[] | null = null;
  private detection: LiveForecasts['detection'] = null;
  private extraction: LiveForecasts['extraction'] = { p: 0.5, source: 'rule', label: LABEL_RULE };
  private advice: { msg: LiveMessage | null; option: AdviceOption | null; at: number } = { msg: null, option: null, at: -Infinity };
  private lastAutoT = -Infinity;
  private readonly lastActionT = new Map<string, number>();
  private readonly lastTargetT = new Map<string, number>();
  private lastCatchT = -Infinity;
  private adviceSeq = 0;
  private adviceKey = '';
  private lastThing: HeartbeatAnalytics['lastThing'] = null;
  /** Crackstone live glue: undefined = not built yet (lazy), null = the case has no Crackstone. */
  private crackLive: CrackstoneLive | null | undefined = undefined;
  private crackIntroDone = false;
  private playStartT: number | null = null;
  /** Final: encounter odds of all three enemies (director spawn rule, filters, threat map, Slurp risk). */
  readonly enc: EncounterLive;
  /** The run this engine serves (zones() needs its director state). */
  private lastRun: MysteryRun | null = null;
  /** The latest threat map (forecasts()), used by the advice router (safer path). */
  private lastThreat: ThreatMap | null = null;

  constructor(run: MysteryRun, private readonly prescriptive: PrescriptiveService, modelArtifact: unknown = null) {
    this.world = worldOf(run);
    this.zoneParams = zoneParamsFrom(modelArtifact);
    this.zoneModel = zoneModelFor(run, this.zoneParams);
    this.tracker = this.zoneModel && this.world ? new ZoneTracker(this.zoneModel, this.world, minSpawnM(run)) : null;
    this.enc = new EncounterLive(run, this.zoneParams, slurpRiskFrom(modelArtifact));
    this.lastRun = run;
    const caseDef = run.caseDef;
    const reg = REGISTRIES;
    const owner = { F: reg.nightshades[run.duo.characterId]?.shortName ?? '', Q: reg.partners[run.duo.pokemonId]?.name ?? '' };
    const abilityName = (key: 'F' | 'Q', id: string) => (key === 'F' ? run.power.def : run.move.def).id === id ? (key === 'F' ? run.power.def : run.move.def).name : 'Your ability';
    const clueById = new Map(caseDef.clues.map((c) => [c.id as string, c]));
    this.rules = new EventRules({
      abilityLabel: (key, id) => {
        const name = abilityName(key, id);
        const full = owner[key] ? `${owner[key]}'s ${name}` : name;
        return full.length <= 30 ? full : name;
      },
      hazards: this.world?.hazards ?? [],
      mentions: (clueId) => clueById.get(clueId)?.mentions.length ?? CASES[caseDef.id]?.clues.find((c) => c.id === clueId)?.mentions.length ?? 0,
      clueTotal: caseDef.clues.length,
    }, run.player.stance);
    const world = this.world;
    this.egg = new EggTracker((kind, id) => {
      if (kind === 'seen') return `Egg seen at the ${world?.eggSites.find((s) => s.id === id)?.label ?? 'site'}`;
      if (kind === 'checked') return `${world?.eggSites.find((s) => s.id === id)?.label ?? 'A spot'} searched`;
      const ex = world?.examines.find((e) => e.id === id);
      if (ex) return `Trace from ${ex.label.replace(/^(examine|inspect|check|read|search)\s+/i, '')}`;
      const clue = clueById.get(id);
      return clue ? `Trace from ${clue.title}` : 'New trace';
    });
  }

  // ------------------------------------------------------------------------------------------------- Crackstone

  /** The Crackstone glue of this run (built lazily on first use; null when the case has none). */
  crack(run: MysteryRun): CrackstoneLive | null {
    if (this.crackLive === undefined) {
      const model = run.crackstoneBrain ? crackstoneRiskFor(run) : null;
      this.crackLive = model ? new CrackstoneLive(run, model) : null;
    }
    return this.crackLive;
  }

  /** Crackstone's chase / curse is on (his position is public then). */
  crackThreat(run: MysteryRun): boolean {
    return isCrackThreat(crackstoneModeOf(run));
  }

  /** Slurp is chasing / grabbing (his position is public then) or searching for you. */
  slurpThreat(run: MysteryRun): boolean {
    return isSlurpThreat(slurpOf(run, false)?.mode ?? null);
  }

  /** Any enemy engaged or alerted near the player (blocks routine advice / patterns). */
  anyThreat(run: MysteryRun): boolean {
    return isThreat(run.hyde.mode, hydeActiveOf(run)) || this.crackThreat(run) || this.slurpThreat(run);
  }

  private crackForecastCache: { t: number; forecast: CrackstoneForecast } | null = null;

  /** The cached rule-based Crackstone forecast (≤ 1 Hz) with the instant fact. Cached per frame to avoid redundant K×C calculations. */
  crackForecast(run: MysteryRun): CrackstoneForecast | null {
    if (!run.crackstoneBrain || (run.status !== 'playing' && run.status !== 'accusing')) return null;
    // Cache the forecast for this frame (multiple calls to crackForecast within one live() tick)
    if (this.crackForecastCache && this.crackForecastCache.t === run.t) {
      return this.crackForecastCache.forecast;
    }
    const forecast = this.crack(run)?.current(run) ?? null;
    if (forecast) {
      this.crackForecastCache = { t: run.t, forecast };
    }
    return forecast;
  }

  // ------------------------------------------------------------------------------------------------- events + samples

  /** One frame's events (in order). Messages are rate-limited and queued for the next live() call. */
  onEvents(run: MysteryRun, events: readonly StampedEvent[]): void {
    this.lastRun = run;
    const emerged = hydeEmergedOf(run);
    const crack = run.status === 'playing' || run.status === 'accusing' || events.some((e) => e.type.startsWith('crackstone') || e.type === 'curse') ? this.crack(run) : null;
    const facts = crack ? crack.frameFacts(run) : null;
    for (const e of events) {
      if (e.seq === 0) continue; // tutorial
      if (e.type === 'catch' || e.type === 'enemy_hit') this.lastCatchT = e.t;
      this.enc.onEvent(e);
      if (crack && (e.type === 'crackstone_mode' || e.type === 'crackstone_scan' || e.type === 'curse')) crack.onEvent(run, e);
      for (const c of this.rules.onEvent(e, run.player.hidden, facts)) this.gate.offer(c);
    }
    crack?.noteFrame(run);
    const threat = isThreat(run.hyde.mode, emerged) || this.crackThreat(run) || this.slurpThreat(run);
    if (run.status === 'playing' && this.playStartT === null) this.playStartT = run.t;
    if (crack && !this.crackIntroDone && run.status === 'playing' && this.playStartT !== null && run.t - this.playStartT >= CRACK_INTRO_AFTER_S && !threat) {
      this.crackIntroDone = true;
      const text = formatThingLine(THING.crackstone.area.text, { area: crack.areaName });
      this.adviceSeq++;
      const msg: LiveMessage = {
        id: `advice:crackstone_area:${run.t.toFixed(2)}:${this.adviceSeq}`, kind: 'advice', title: TITLES.crackstone, text: fit(text, ADVICE_MAX),
        why: fit(THING.crackstone.deaf.text, WHY_MAX), t: Math.round(run.t * 1000) / 1000, priority: P.routineAdvice, target: null, free: true,
        enemy: 'crackstone',
      };
      this.push(msg, 'crackstone_area', null);
    }
    if (!threat && !this.gate.patternUsed) {
      const pat = this.rules.pattern(run.t);
      if (pat) this.gate.offer(pat);
    }
    for (const r of this.gate.release(run.t, threat)) this.push(r.msg, r.code, r.ref);
  }

  /** 1 Hz sample: steps the zone filter and caches the model outputs (same cadence as the evaluation). */
  onSample(run: MysteryRun, risk: RiskEstimate | null, extraction: ProbabilityEstimate, snapshotVisible?: boolean): void {
    const inv = investigationOf(run);
    const emerged = hydeEmergedOf(run, inv);
    const t = run.t;
    this.extraction = { p: extraction.p, source: extraction.source, label: extraction.source === 'ml' ? LABEL_ML : LABEL_RULE };
    if (run.crackstoneBrain && (run.status === 'playing' || run.status === 'accusing')) this.crack(run)?.sample(run);
    this.detection = emerged && risk && hydeActiveOf(run)
      ? { p: risk.p, band: risk.band, source: risk.source, label: risk.label, topFactors: risk.topFactors }
      : null;
    if (run.status === 'playing' || run.status === 'accusing') this.enc.sample(run, snapshotVisible);
    if (!this.tracker || directorManages(run, 'hyde')) return;
    const visible = emerged && hydeVisibleOf(run, snapshotVisible);
    const p = this.tracker.sample({
      t, emerged, emergedAt: inv.hydeEmergedAt, player: { x: run.player.x, z: run.player.z }, mode: run.hyde.mode, visible,
      hydePos: visibleHydePosition(run, visible),
    });
    if (p) this.zoneP = p;
  }

  // ------------------------------------------------------------------------------------------------- forecasts

  zones(): ZoneProb[] | null {
    if (!this.world) return null;
    const p = (this.lastRun ? this.enc.hydeZones(this.lastRun) : null) ?? this.zoneP;
    if (!p) return null;
    return zoneProbs(this.world.zones, p);
  }

  forecasts(run: MysteryRun): LiveForecasts {
    const world = this.world;
    const inv = investigationOf(run);
    const emerged = hydeEmergedOf(run, inv);
    const t = run.t;
    let egg: LiveForecasts['egg'] = null;
    let clueAreas: LiveForecasts['clueAreas'] = null;
    let hyde: LiveForecasts['hyde'];
    if (world) {
      if (run.egg.state !== 'carried' && run.egg.state !== 'delivered') {
        egg = { sites: this.egg.update(world, inv, t), label: LABEL_BAYES, lastChange: this.egg.lastChange() };
      }
      if (run.cluesFound.length < run.caseDef.clues.length) clueAreas = { areas: clueAreaProbabilities(world, inv, run.cluesFound), label: LABEL_BAYES };
    }
    const director = directorManages(run, 'hyde');
    let legacySpawns: ReturnType<typeof spawnProbabilities> | null = null;
    if (director && !hydeActiveOf(run)) {
      // the director's Hyde is away (not spawned yet / despawned): where it may appear next (exact spawn rule)
      hyde = {
        phase: 'before_emergence', emergesInS: this.enc.appearsInS(run, 'hyde') ?? 0,
        spawns: this.enc.spawnOdds(run, 'hyde'), label: LABEL_RULE,
      };
    } else if (!emerged && !director) {
      legacySpawns = world ? spawnProbabilities(world, run.player, minSpawnM(run)) : [];
      hyde = { phase: 'before_emergence', emergesInS: Math.max(0, inv.hydeEmergesInS ?? 0), spawns: legacySpawns, label: LABEL_RULE };
    } else {
      let zones = this.zones() ?? (world && this.zoneModel ? zoneProbs(world.zones, this.zoneModel.occupancy) : []);
      // an instant sighting is shown at once (the next 1 Hz filter step makes the same collapse)
      if (world && world.zones.length > 0 && hydeVisibleOf(run)) {
        const k = zoneIndexAt(world.zones, run.hyde.x, run.hyde.z);
        zones = zones.map((z, i) => ({ ...z, p: i === k ? 1 : 0 }));
      }
      hyde = { phase: 'active', zones, label: LABEL_BAYES };
    }
    const crackstone = this.crackForecast(run);
    const hydeZoneP = hyde.phase === 'active' ? hyde.zones.map((z) => z.p) : null;
    const live = run.status === 'playing' || run.status === 'accusing';
    const threat = live ? this.enc.threatMap(run, hydeZoneP, legacySpawns, crackstone ?? null) : null;
    this.lastThreat = threat;
    return {
      detection: emerged && hydeActiveOf(run) ? this.detection : null, extraction: this.extraction, egg, clueAreas, hyde, crackstone,
      threat,
      noise: live ? this.enc.noiseRisk(run, hydeZoneP) : null,
      slurp: live ? this.enc.slurpForecast(run) : null,
    };
  }

  // ------------------------------------------------------------------------------------------------- messages

  private push(m: LiveMessage, code: string, ref: string | null): void {
    this.queue.push(m);
    if (m.kind !== 'log') this.lastThing = { kind: m.kind, code, ref, text: m.text, followed: null };
  }

  /** Messages released since the last call. */
  drain(): LiveMessage[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  /** Marks the follow-up of the latest advice (heartbeat "followed ✓"). */
  noteFollowed(text: string, followed: boolean | null): void {
    if (this.lastThing && this.lastThing.kind === 'advice' && this.lastThing.text === text) this.lastThing = { ...this.lastThing, followed };
  }

  private adviceMessage(o: AdviceOption, t: number, priority: number, prefix: 'advice' | 'hint'): LiveMessage {
    this.adviceSeq++;
    return {
      id: `${prefix}:${o.action}:${t.toFixed(2)}:${this.adviceSeq}`, kind: 'advice', title: o.enemy === 'crackstone' ? TITLES.crackstone : TITLES.advice,
      text: fit(o.text, ADVICE_MAX), why: fit(o.reason, WHY_MAX), t: Math.round(t * 1000) / 1000, priority, free: true,
      ...(o.enemy ? { enemy: o.enemy } : {}),
      target: o.target ? { x: Math.round(o.target.x * 100) / 100, z: Math.round(o.target.z * 100) / 100, label: o.targetLabel ?? 'Target' } : null,
    };
  }

  /** The current best feasible action (refreshed ≤ 1 Hz), as a Thing's-advice card. */
  currentAdvice(run: MysteryRun): LiveMessage | null {
    if (run.status !== 'playing' && run.status !== 'accusing') return null;
    // refresh ≤ 1 Hz — but at once when the cabinet door state changed (never "Close the cabinet." after it is shut)
    const key = cabinetDoorPhase(run) ?? '';
    if (run.t - this.advice.at < ADVICE_REFRESH_S && this.advice.at <= run.t && key === this.adviceKey) return this.advice.msg;
    this.adviceKey = key;
    const rec = this.prescriptive.recommend(run, this.zones(), this.crackForecast(run), this.lastThreat);
    // Crackstone advice during his threat is P4 (UX_ENEMIES §6); "avoid his area" while he patrols stays routine
    const threat = this.anyThreat(run) || (rec?.enemy === 'crackstone' && rec.action !== 'avoid_area');
    this.advice = { msg: rec ? this.adviceMessage(rec, run.t, threat ? P.threatAdvice : P.routineAdvice, 'advice') : null, option: rec, at: run.t };
    return this.advice.msg;
  }

  /**
   * Automatic advice (UX §6): `threat` = an alert / egg drop just happened (P4), else routine (P2, score ≥ 60). ≥ 12 s
   * apart, the same action not within 30 s, the same target not within 60 s, never right after a catch, skipped when
   * already done (the player stands at the target). Returns the advice to record, and queues the card.
   */
  autoAdvice(run: MysteryRun, threat: boolean, milestone = false): Advice | null {
    if (run.status !== 'playing') return null;
    const t = run.t;
    // a milestone (egg picked up) may speak sooner, but never on top of the previous card
    const gap = milestone ? MILESTONE_GAP_S : AUTO_ADVICE_GAP_S;
    if (t - this.lastAutoT < gap || t - this.lastCatchT < 2.5) return null;
    const crackF = this.crackForecast(run);
    let rec = this.prescriptive.recommend(run, this.zones(), crackF, this.lastThreat);
    if (milestone && rec && run.egg.state === 'carried' && !this.anyThreat(run)) {
      // the first carrying advice is the next step of the objective (the route to Iago Tower), not a side tip
      const tower = this.prescriptive.candidates(run, this.zones(), crackF, this.lastThreat).find((o) => o.action === 'go_to_tower' || o.action === 'deposit');
      if (tower) rec = { ...tower, t: Math.round(t * 1000) / 1000, alternatives: [], engine: 'rule-based decision engine' };
    }
    if (!rec) return null;
    if (BANNER_ACTIONS.has(rec.action)) return null; // the scan / curse banner owns this moment (UX_ENEMIES §6)
    if (!threat && rec.score < 60) return null;
    if (t - (this.lastActionT.get(rec.action) ?? -Infinity) < SAME_ACTION_GAP_S) return null;
    const key = `${rec.action}|${rec.targetLabel ?? ''}`;
    if (t - (this.lastTargetT.get(key) ?? -Infinity) < SAME_TARGET_GAP_S) return null;
    if (rec.target && Math.hypot(rec.target.x - run.player.x, rec.target.z - run.player.z) < 4 && rec.action !== 'deposit') return null;
    this.lastAutoT = t;
    this.lastActionT.set(rec.action, t);
    this.lastTargetT.set(key, t);
    const msg = this.adviceMessage(rec, t, threat ? P.threatAdvice : P.routineAdvice, 'advice');
    this.advice = { msg, option: rec, at: t };
    this.push(msg, rec.action, rec.ability?.id ?? null);
    return rec;
  }

  /**
   * R7 hint ladder (the frontend owns the idle timer and V): L1 = the case's area line, L2 = the most probable clue area
   * (or the egg's most probable area) as a target with its chance, L3 = the most probable candidate SITE (Bayesian; it
   * may be wrong — the copy says so). During a threat the safest feasible action replaces the ladder.
   */
  hint(run: MysteryRun, level: 1 | 2 | 3, requested: boolean): { msg: LiveMessage; advice: Advice } | null {
    if (run.status !== 'playing' && run.status !== 'accusing') return null;
    const t = run.t;
    const zones = this.zones();
    const priority = requested ? P.threatAdvice : P.routineAdvice;
    const make = (o: AdviceOption, kind: 'advice' | 'log' = 'advice'): { msg: LiveMessage; advice: Advice } => {
      const advice: Advice = { ...o, t: Math.round(t * 1000) / 1000, alternatives: [], engine: 'rule-based decision engine' };
      const msg = this.adviceMessage(o, t, priority, 'hint');
      const out = kind === 'log' ? { ...msg, kind: 'log' as const, title: TITLES.log, priority: requested ? priority : P.log } : msg;
      if (out.kind !== 'log') this.lastThing = { kind: out.kind, code: o.action, ref: o.ability?.id ?? null, text: out.text, followed: null };
      return { msg: out, advice };
    };
    const option = (action: AdviceOption['action'], text: string, reason: string, extra: Partial<AdviceOption> = {}): AdviceOption => ({
      action, text: fit(text, ADVICE_MAX), reason: fit(reason, WHY_MAX), feasible: true, score: 50, target: extra.target ?? null,
      ability: null, clueId: extra.clueId ?? null, ...(extra.targetLabel ? { targetLabel: extra.targetLabel } : {}),
    });
    if (run.status === 'accusing') return make(option('review_evidence', 'Review the evidence on Tab.', 'Weigh what each clue you found says'));
    if (this.anyThreat(run)) {
      const rec = this.prescriptive.recommend(run, zones, this.crackForecast(run), this.lastThreat);
      if (rec) return make(rec);
    }
    const view = publicView(run, zones);
    const obj = run.objective();
    const tower = run.map.tower;
    if (obj === 'deliver_egg') {
      return make(option('go_to_tower', 'Take the egg to Iago Tower.', 'Deposit it inside the tower circle',
        level >= 2 ? { target: { x: tower.x, z: tower.z }, targetLabel: 'Iago Tower' } : {}));
    }
    if (obj === 'retrieve_egg' && view.eggKnownAt) {
      return make(option('retrieve_egg', 'Go back and pick up the egg (E).', 'You dropped it here', { target: view.eggKnownAt, targetLabel: 'Dropped egg' }));
    }
    if (obj === 'find_clues' && view.world) {
      if (level === 1) {
        // the designer's case line verbatim (never cut mid-sentence; the UI wraps it)
        const line = run.caseDef.thing.whereHint || 'Search the marked areas for clues.';
        const out = make(option('search_room', line, 'Areas on your map hold the clues'), 'log');
        return { ...out, msg: { ...out.msg, text: line } };
      }
      const areas = view.areas.filter((a) => a.p > 1e-6).sort((a, b) => b.p - a.p);
      const topArea = areas[0];
      if (topArea && level === 2) {
        const clue = view.clueSites.filter((s) => s.areaId === topArea.areaId).sort((a, b) => b.p - a.p)[0];
        return make(option('search_room', `Try the ${topArea.name}.`, oddsCopy(topArea.p, (x) => `Clue chance ${x} · ${LABEL_BAYES}`, 'A missing clue is there'),
          { target: { x: topArea.x, z: topArea.z }, targetLabel: topArea.name, clueId: clue?.clueId ?? null }));
      }
      const sites = view.clueSites.filter((s) => s.p > 1e-6);
      const d = (s: { x: number; z: number }) => Math.hypot(s.x - run.player.x, s.z - run.player.z);
      const site = sites.sort((a, b) => b.p - a.p || d(a) - d(b))[0];
      if (site) {
        const area = view.world.areas.find((a) => a.id === site.areaId);
        return make(option('inspect_clue', `Check the ${site.label}${area ? ` in the ${area.name}` : ''}.`, oddsCopy(site.p, (x) => `Most likely spot: ${x} (may be wrong)`, 'The only spot left for this clue'),
          { target: { x: site.x, z: site.z }, targetLabel: site.label, clueId: site.clueId }));
      }
    }
    if ((obj === 'find_egg' || obj === 'find_clues') && view.world && run.egg.state === 'resting') {
      if (level === 1) {
        const line = run.caseDef.thing.findEgg || 'Find the egg.';
        const out = make(option('get_egg', line, 'The egg map shows where it may be'), 'log');
        return { ...out, msg: { ...out.msg, text: line } };
      }
      const top = topEggSite(view, run.player);
      if (top) {
        const area = view.world.areas.find((a) => a.id === top.def.areaId);
        if (level === 2 && area && !view.inv.eggSeenAt) {
          return make(option('get_egg', `Try the ${area.name} for the egg.`, oddsCopy(top.p, (x) => `Egg odds ${x} · ${LABEL_BAYES}`, 'The egg can only be there'), { target: { x: area.x, z: area.z }, targetLabel: area.name }));
        }
        return make(option('get_egg', view.inv.eggSeenAt ? `Pick up the egg at the ${top.def.label}.` : `Check the ${top.def.label} for the egg.`,
          view.inv.eggSeenAt ? 'You saw it there' : oddsCopy(top.p, (x) => `Egg odds ${x} (may be wrong)`, 'The only spot left for the egg'), { target: { x: top.def.x, z: top.def.z }, targetLabel: top.def.label }));
      }
    }
    const rec = this.prescriptive.recommend(run, zones, this.crackForecast(run), this.lastThreat);
    return rec ? make(rec) : null;
  }

  // ------------------------------------------------------------------------------------------------- heartbeat

  heartbeat(run: MysteryRun): HeartbeatAnalytics {
    const f = this.forecasts(run);
    const topEgg = f.egg?.sites.reduce<{ id: string; p: number } | null>((b, s) => (!b || s.p > b.p ? { id: s.siteId, p: s.p } : b), null) ?? null;
    const located = investigationOf(run).eggSeenAt !== null || (topEgg !== null && topEgg.p >= EGG_LOCATED_P);
    const topZone = f.hyde.phase === 'active'
      ? f.hyde.zones.reduce<{ id: string; p: number } | null>((b, z) => (!b || z.p > b.p ? { id: z.zoneId, p: z.p } : b), null)
      : null;
    const status = run.status;
    return {
      objective: status === 'tutorial' ? null : run.objective(),
      chases: this.rules.chases,
      escapes: this.rules.escapes,
      catches: run.player.catches,
      hydeEmerged: hydeEmergedOf(run),
      hydePhase: f.hyde.phase,
      hydeZone: topZone,
      eggSite: located ? null : topEgg,
      eggLocated: located,
      extraction: { p: f.extraction.p, source: f.extraction.source === 'ml' ? 'ml' : 'rule_based' },
      clues: run.cluesFound.length,
      cluesTotal: run.caseDef.clues.length,
      lastThing: this.lastThing,
      crackstonePresent: run.crackstonePresent === true,
      crackstoneMode: crackstoneModeOf(run),
      crackstoneChase: this.crackThreat(run),
      crackstoneChases: this.rules.crackChases,
      crackstoneEscapes: this.rules.crackEscapes,
      crackstoneRisk: f.crackstone ? f.crackstone.here.p : null,
      enemies: this.enemiesBeat(run),
      slurpChase: (() => { const m = slurpOf(run, false); return !!m && m.active && (m.mode === 'CHASE' || m.mode === 'ATTACK'); })(),
      slurpChases: this.rules.slurpChases,
      slurpEscapes: this.rules.slurpEscapes,
      slurpRisk: f.slurp ? f.slurp.here.p : null,
      hintsUsed: this.rules.hintsUsed,
      detections: this.rules.detectionsTotal,
      hits: this.rules.hitsTotal,
      cabinet: (() => { const c = cabinetOf(run); return c && (c.phase === 'open' || c.phase === 'closed') ? c.phase : null; })(),
    };
  }

  private enemiesBeat(run: MysteryRun): HeartbeatAnalytics['enemies'] {
    const out = {} as HeartbeatAnalytics['enemies'];
    for (const id of ENEMY_IDS) {
      const present = this.enc.presentOf(run, id);
      const active = present && this.enc.activeOf(run, id);
      const mode = !active ? null : id === 'hyde' ? run.hyde.mode : id === 'crackstone' ? crackstoneModeOf(run) : slurpOf(run, false)?.mode ?? null;
      out[id] = { present, active, mode };
    }
    return out;
  }

  get escapes(): number {
    return this.rules.escapes;
  }

  // ------------------------------------------------------------------------------------------------- final: descriptive

  /** Exact counts of the scoring RULE events seen so far (enemy_detected / enemy_hit / hint_requested). */
  ruleCounts(): { hintsUsed: number; detections: Record<EnemyId, number>; hits: Record<EnemyId, number>; blockedHits: number; slurpChases: number; slurpEscapes: number } {
    const r = this.rules;
    return { hintsUsed: r.hintsUsed, detections: { ...r.detections }, hits: { ...r.hits }, blockedHits: r.blockedHits, slurpChases: r.slurpChases, slurpEscapes: r.slurpEscapes };
  }

  /**
   * Game-over WHY (UX_FINAL §3): 1–2 lines ≤ 52 — what ended the run (from the dnf event + its monster) and the last
   * rule cause before it (how it found you), when that happened within the last 30 s.
   */
  gameOverWhy(run: MysteryRun): string[] {
    if (run.status !== 'dnf') return [];
    const dnf = [...run.log].reverse().find((e) => e.type === 'dnf');
    if (!dnf || dnf.type !== 'dnf') return [];
    const by = dnf.by ?? null;
    const first = by === 'slurp' ? "Slurp's lunge took the last of your HP."
      : by === 'crackstone' ? "Crackstone's curse took the last of your HP."
      : by === 'hyde' ? (dnf.reason === 'second_catch' ? 'The Hyde caught you a second time.' : "The Hyde's grab took the last of your HP.")
      : dnf.reason === 'second_catch' ? 'You were caught a second time.' : 'Your HP ran out.';
    const out = [fit(first, 52)];
    // prefer the newest cause about the monster that ended the run over a newer one about another monster
    const c = (by ? this.rules.lastCauseBy[by] : undefined) ?? this.rules.lastCause;
    if (c && dnf.t - c.t <= 30 && c.text !== first) out.push(fit(c.text, 52));
    return out;
  }

  get chases(): number {
    return this.rules.chases;
  }
}
