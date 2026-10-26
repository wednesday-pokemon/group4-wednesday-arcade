// Owns one MysteryRun + MysteryScene + input controller per attempt and drives them from a single
// requestAnimationFrame loop: run.update(dt, input) then scene.render(run, events, dt). Pause / board / accusation stop
// the sim clock (update is not called). Turns run state + events into a throttled HUD model (≈15 Hz React), audio cues,
// directional captions, the TL;DR ClueCard, ExamineToast and ONE Thing message stack (UX_OVERHAUL §6) fed by the
// analytics layer's live() feed (≈3 Hz; LiveAnalytics.messages + advice) and the progressive hint ladder (R7).
// The compass + minimap pull their own feed (`nav()`) at ≤ 30 Hz from refs, outside React render. Exposes debug/advance
// hooks for tests, plus a TEST-ONLY autopilot that feeds the game-developer's seeded Bot (src/mystery/bot.ts) through
// the same update() path a player uses.
//
// HIDDEN TRUTH: nothing here reads run.layout, map.clues or map.eggSpawn. A RESTING egg's position is read only while a
// reveal power shows it (ActiveEffects.revealEgg); the Hyde's position only while it is visible or chasing (or an
// enemy reveal shows it); Joseph Crackstone's position only per ENEMY_CONTRACT R4 (hud/crackstone.ts crackMarkerKind).
// Crackstone (UX_ENEMIES): plaque, scan / curse banner, CURSED row, one threat-edge chevron, captions + cues, his
// CRACKSTONE stack items (rate-limited by AlertLimiter), the organ drone (audio.setThreat source) and the spectator
// status fields.
import { useContext, useEffect, useRef, useState } from 'react';
import { createMysteryAnalytics, type Advice, type MysteryAnalytics } from '../../mystery/analytics/index.ts';
import type { LiveAnalytics, LiveMessage } from '../../mystery/analytics/types.ts';
import type { MysteryRun } from '../../mystery/run.ts';
import type { Accusation, CaseDef, ClueId, Duo, InvestigationState, StampedEvent, Vec2 } from '../../mystery/types.ts';
import { mapGeometry, type MapTarget, type PublicMapState } from '../../ui/mystery/map/mapData.ts';
import { headingDeg, relBearingDeg } from '../../ui/mystery/map/mapRender.ts';
import { announce } from '../announce.tsx';
import { audio, type Sfx, type ThreatSource } from '../audio.ts';
import { getSettings, useSettings } from '../settings.ts';
import { heardBearing } from './hud/compass.ts';
import { HintLadder, HINT_SHOW_S, ladderPaused } from './hud/hintLadder.ts';
import { buildNavFeed, mapFeedKey, type NavFeed } from './hud/navFeed.ts';
import { OddsDeltaTracker } from './hud/oddsModel.ts';
import { FinalHud, type FinalRunLike, type SceneDeathApi } from './hud/finalHud.ts';
import { deltaText } from '../../ui/mystery/odds.ts';
import {
  AlertLimiter, CHASE_WHY, CRACK_HEAD, CrackThreatHold, ESCAPE_WHY, TelegraphTracker, crackHudView, crackMapState, crackMarkerKind, crackPillKey,
  crackstoneOf, curseEdgeWanted, encounterStart, revealedByEffect, type TelegraphOutput,
} from './hud/crackstone.ts';
import { THING } from '../../mystery/data/thing.ts';
import { thing as thingLines } from './thingLines.ts';
import { hydeEmergedOf, hydeVisibleOf, investigationOf, lineOfSightOf, routeOf } from './hud/publicRun.ts';
import { stackKindOf, ThingStack, type StackItem } from './hud/thingStack.ts';
import {
  buildHud, CaptionLog, captionFor, clueCardContent, directionOf, effectChip, hudRenderKey, NoiseMeter, noiseBand, objectiveText, RiskHold, ThreatHold, threatEdgePoint,
  type AbilityMeta, type ClueCardView, type ExamineToastView, type HudExtras, type MysteryHudModel, type StackView, type Toast,
} from './hudModel.ts';
import { IDLE_INPUT, MysteryInputController, type MysteryFrameInput } from './input.ts';
import { integrationStatus, loadCaseSolution, loadCrackstoneFreeMap, loadRunCtor, loadSceneCtor, nightshadeDef, partnerDef } from './integration.ts';
import { LiveRunContext } from './liveContext.ts';
import { ctrlCrouchEnabled } from './kiosk.ts';
import { browserStorage, writeLive, type LivePhase } from './records.ts';
import type { MysteryRunLike, MysterySceneLike } from './runTypes.ts';
import type { LiveStatusWithInsights } from '../../ui/mystery/stationView.ts';

const HUD_INTERVAL_MS = 66;
/** The React HUD re-renders at least this often even when hudRenderKey is unchanged (safety net). */
const HUD_FORCE_S = 0.5;
/** Events after which the public investigation state is re-read at once (else 4 Hz). */
const INV_EVENTS: ReadonlySet<string> = new Set(['site_checked', 'trace_found', 'clue_found', 'examined', 'passage_opened', 'hyde_emerged']);
/** Low graphics also cuts CPU: the React HUD snapshot at 10 Hz instead of 15 (the canvases drop to 15 Hz). */
const HUD_INTERVAL_LOW_MS = 100;
/** Crackstone's area intro, this long after "Go." (UX_ENEMIES §6). */
const CRACK_INTRO_DELAY_S = 3;
/** Captions for his scan chant only within this distance; the cloak rustle only within 12 m. */
const CRACK_CHANT_M = 40;
const CRACK_RUSTLE_M = 12;
const END_DELAY_S = { finished: 1.4, dnf: 2.4 } as const;
const BOARD_LOCK_TOAST_S = 1.2;
/** analytics.live() cadence (~3 Hz; the contract allows 2–4 Hz). */
const LIVE_EVERY_S = 0.33;
/** Station status (localStorage + LIVE hooks) cadence. */
const STATUS_EVERY_S = 1;
/** Seen-tracker / visibility / shimmer cadence. */
const SLOW_EVERY_S = 0.25;
const CLUE_CARD_S = 6;
const CLUE_CARD_BLOCK_S = 2;
const EXAMINE_TOAST_S = 3;
const EMPTY_TOAST_GAP_S = 3;
const SEEN_M = 12;
const ADVICE_TARGET_S = 16;
const HEARD_HYDE_S = 3;
const SHIMMER_FAR_M = 6;
const SHIMMER_NEAR_M = 2;

export type LoopPhase = 'loading' | 'missing' | 'webgl_failed' | 'error' | 'ready';
export type AutopilotProfile = 'stealthy' | 'careless';

export interface MysteryLoopOptions {
  duo: Duo;
  seed: string;
  /** The session's assigned case (public definition; the answer key is loaded only at the accusation). */
  caseDef: CaseDef;
  /** LIVE station: never echo the seed into debug output. */
  hideSeed?: boolean;
  tutorial: boolean;
  /** Sim clock stopped (pause / board overlay). */
  paused: boolean;
  /** Keyboard → game input enabled (no overlay, not accusing). */
  inputEnabled: boolean;
  characterName: string;
  pokemonName: string;
  characterArt: string;
  pokemonArt: string;
  /** Session identity for the analytics collector (Supabase rows later). */
  sessionId: string;
  stationId: string;
  nickname: string;
  offered: Duo[];
  onDeposited: () => void;
  onEnded: (run: MysteryRunLike, analytics: MysteryAnalytics) => void;
}

export interface MysteryLoopHandle {
  phase: LoopPhase;
  missing: string[];
  error: string | null;
  hud: MysteryHudModel | null;
  run: () => MysteryRunLike | null;
  input: () => MysteryInputController | null;
  endTutorial: () => void;
  /** The one-shot accusation (loads the case's answer key first); resolves false when it was not accepted. */
  accuse: (a: Accusation) => Promise<boolean>;
  /** Board may open now (blocked during CHASE); shows the 1.2 s "Board locked" toast when not. */
  tryOpenBoard: () => boolean;
  setAutopilot: (p: AutopilotProfile | null) => Promise<boolean>;
  analytics: () => MysteryAnalytics | null;
  /** Compass + minimap feed (≤ 30 Hz pull, outside React render). */
  nav: () => NavFeed | null;
  /** The public map state (also for the Tab investigation map). */
  mapState: () => PublicMapState | null;
  /** Latest live analytics sample (forecasts + current advice), null before the first / without the API. */
  liveAnalytics: () => LiveAnalytics | null;
  /** Ask Weems button (same flow as V): note / paid hint / no-op without a charge. */
  askWeems: () => void;
  /** Death sequence: skip the cutscene (keydown timeStamp on the keyboard clock, or a click). */
  skipDeath: (input: { startedAt: number; repeat?: boolean; click?: boolean }) => boolean;
  /** Death card "See results". */
  deathContinue: () => void;
  /** A death sequence is running (input lock; Esc skips instead of pausing). */
  dying: () => boolean;
  /** Principal Weems' hints given this run (Tab -> "Weems' hints (n)"). */
  weemsHints: () => readonly { level: 1 | 2 | 3; text: string }[];
  /** Accusation step: "Ask Weems (-50)" (run.requestHint() applies at once there); undefined when the sim has no API. */
  accuseWeems: (() => void) | undefined;
  debug: () => object | null;
  advance: (ms: number) => void;
}

export function isWebGLAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

type BotLike = { decide(): MysteryFrameInput; o: { decisionHz: number } };
type LiveApi = { live?: () => LiveAnalytics; hint?: (level: 1 | 2 | 3, o?: { requested?: boolean }) => LiveMessage | null };

export function useMysteryLoop(container: HTMLElement | null, o: MysteryLoopOptions): MysteryLoopHandle {
  const [phase, setPhase] = useState<LoopPhase>('loading');
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hud, setHud] = useState<MysteryHudModel | null>(null);
  const settings = useSettings();
  const opts = useRef(o);
  opts.current = o;
  const runRef = useRef<MysteryRunLike | null>(null);
  const inputRef = useRef<MysteryInputController | null>(null);
  const sceneRef = useRef<MysterySceneLike | null>(null);
  const analyticsRef = useRef<MysteryAnalytics | null>(null);
  const accusingRef = useRef(false);
  const api = useRef<{
    handle: (events: StampedEvent[], advice: Advice | null) => void;
    boardLocked: () => void;
    autopilot: (bot: BotLike | null) => void;
    nav: () => NavFeed | null;
    mapState: () => PublicMapState | null;
    live: () => LiveAnalytics | null;
    final: FinalHud;
    now: () => number;
  } | null>(null);
  const debugRef = useRef<(() => object) | null>(null);
  const advanceRef = useRef<((ms: number) => void) | null>(null);
  // LIVE station only (null in LOCAL DEMO): upload / finalize / heartbeat hooks of the verified session.
  const liveHooks = useContext(LiveRunContext);
  const liveRef = useRef(liveHooks);
  liveRef.current = liveHooks;

  // Live look/crouch preferences + scene options.
  useEffect(() => {
    const input = inputRef.current;
    if (input) input.prefs = { sensitivity: settings.lookSensitivity, invertY: settings.invertY, crouchToggle: settings.crouchToggle };
    sceneRef.current?.setOptions?.({ reducedMotion: settings.reducedMotion, lowGraphics: settings.lowGraphics });
  }, [settings]);

  useEffect(() => {
    if (!container) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      // A sibling module that exists but cannot load (mid-development import error) counts as missing.
      const safe = async <T,>(load: () => Promise<T | null>, label: string): Promise<{ ctor: T | null; why: string | null }> => {
        try {
          const ctor = await load();
          return { ctor, why: ctor ? null : label };
        } catch (err) {
          console.warn(`[mystery] ${label} failed to load`, err);
          return { ctor: null, why: `${label} — present but failed to load` };
        }
      };
      const [r, sc] = await Promise.all([safe(loadRunCtor, 'src/mystery/run.ts (MysteryRun)'), safe(loadSceneCtor, 'src/three/mystery/MysteryScene.ts (MysteryScene)')]);
      if (disposed) return;
      const Run = r.ctor;
      const Scene = sc.ctor;
      if (!Run || !Scene) {
        setMissing([r.why, sc.why].filter((x): x is string => x !== null));
        setPhase('missing');
        return;
      }
      if (!isWebGLAvailable()) {
        setPhase('webgl_failed');
        return;
      }
      try {
        // TEST FIXTURE only (local demo): `&crackstone=0` plays the case without its second enemy
        const noCrack = !opts.current.hideSeed && typeof location !== 'undefined' && new URLSearchParams(location.search).get('crackstone') === '0';
        const fixtureMap = noCrack ? await loadCrackstoneFreeMap(opts.current.caseDef.id) : null;
        if (disposed) return;
        const run = new Run({ duo: opts.current.duo, seed: opts.current.seed, caseDef: opts.current.caseDef, tutorial: opts.current.tutorial, ...(fixtureMap ? { map: fixtureMap } : {}) });
        const s = getSettings();
        // The renderer gets the run's per-session map (run.map), never the shared case map.
        cleanup = start(run, new Scene(container, run.map, opts.current.duo, { reducedMotion: s.reducedMotion, lowGraphics: s.lowGraphics }));
        setPhase('ready');
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };

    function start(run: MysteryRunLike, scene: MysterySceneLike): () => void {
      runRef.current = run;
      sceneRef.current = scene;
      const s0 = getSettings();
      const input = new MysteryInputController({ sensitivity: s0.lookSensitivity, invertY: s0.invertY, crouchToggle: s0.crouchToggle }, ctrlCrouchEnabled);
      inputRef.current = input;

      const n = nightshadeDef(run.duo.characterId);
      const p = partnerDef(run.duo.pokemonId);
      const power: AbilityMeta = { def: n.power, name: n.power.name, art: opts.current.characterArt, cooldownS: n.power.cooldownS, denied: null };
      const move: AbilityMeta = { def: p.move, name: p.move.name, art: opts.current.pokemonArt, cooldownS: p.move.cooldownS, denied: null };
      const abilityName = (key: 'F' | 'Q') => (key === 'F' ? power.name : move.name);
      const hasSwitch = [n.power, p.move].some((a) => a.effects.some((e) => e.kind === 'power_switch'));
      // Phase 4: the game-wide analytics session (identical for every duo). LOCAL DEMO: batches stay in the collector
      // (no network, no "unsynced" noise). LIVE station: liveRun.ts uploads pendingBatch() → mystery-append-events.
      const analytics = createMysteryAnalytics(run as unknown as MysteryRun, {
        sessionId: opts.current.sessionId, stationId: opts.current.stationId, offered: opts.current.offered,
      });
      analyticsRef.current = analytics;
      liveRef.current?.runStarted(run, analytics);
      // Overhaul live feed (fullstack-developer): feature-detected so the HUD degrades if the API is missing.
      const liveApi = analytics as unknown as LiveApi;
      const hasLive = typeof liveApi.live === 'function';
      const geometry = mapGeometry(run.map);
      const world = run.map.world ?? null;
      const los = lineOfSightOf(run);
      const riskHold = new RiskHold();
      let lastAdvice: Advice | null = null;
      let nextLiveAt = 0;
      let nextStatusAt = 0;

      const noise = new NoiseMeter();
      const captions = new CaptionLog();
      const stack = new ThingStack();
      const ladder = new HintLadder();
      const tracker = new OddsDeltaTracker();
      const threat = new ThreatHold();
      let realT = 0;
      let lastStatus = run.status;
      let ending: { outcome: 'finished' | 'dnf'; at: number } | null = null;
      let reported = false;
      let prevPowerReady = true;
      let prevMoveReady = true;
      let lastHudAt = 0;
      let deniedSeq = 0;
      let toastSeq = 0;
      let toast: { t: Toast; until: number } | null = null;
      let catchFlashSeq = 0;
      let bot: BotLike | null = null;
      let botEvery = 1;
      let botStep = 0;
      let botHeld: MysteryFrameInput = IDLE_INPUT;
      let lastPose: Parameters<NonNullable<MysterySceneLike['setThingPose']>>[0] = null;
      // ---- overhaul HUD state
      let liveA: LiveAnalytics | null = null;
      let inv: InvestigationState = investigationOf(run);
      let emerged = hydeEmergedOf(run, inv);
      let hydeVisible = false;
      let nextSlowAt = 0;
      let obsEpoch = 0;
      let clueCard: { v: Omit<ClueCardView, 'leaving'>; shownAt: number; until: number } | null = null;
      let examine: { v: ExamineToastView; until: number; trace: { siteId: string; before: number | undefined; label: string } | null } | null = null;
      let lastEmptyToastAt = -Infinity;
      let hintShow: { level: 2 | 3; areaId: string | null; target: MapTarget | null; until: number } | null = null;
      let adviceTarget: (MapTarget & { until: number }) | null = null;
      let heard: { bearing: number; until: number } | null = null;
      let route: { pts: Vec2[]; key: string; at: number } | null = null;
      const seenHazards = new Set<string>();
      let leverSeen = false;
      const visitedAreas = new Set<string>();
      const areaDoneAt: Record<string, number> = {};
      const flashes: PublicMapState['flashes'][number][] = [];
      let knownSites = new Set<string>(Object.values(inv.knownClueSites).filter((x): x is string => !!x));
      let eggSeenWas = inv.eggSeenAt;
      const shimmerSaid = new Set<string>();
      let shimmer = 0;
      let firstCarryTip = false;
      // nav feed: one build per frame at most, and none while its content key is unchanged (canvases then skip too)
      let feedCache: { realT: number; simT: number; feed: NavFeed } | null = null;
      let seenArr: string[] = [];
      let visitedArr: string[] = [];
      let flashArr: PublicMapState['flashes'][number][] = [];
      let flashLast: PublicMapState['flashes'][number] | undefined;
      // React HUD: setState only when something visible changed (or every 0.5 s as a safety net)
      let lastHudKey = '';
      let lastHudSetAt = -Infinity;
      // reused every frame (no per-frame object literal for the idle-ladder rule)
      const ladderIn: Parameters<typeof ladderPaused>[0] = { status: '', emerged: false, hydeMode: '', objective: '', interacting: null };
      let lastCardId: string | null = null;
      // ---- Joseph Crackstone (null = this case has none: nothing of him runs or renders)
      const crack = crackstoneOf(run);
      const crackHold = new CrackThreatHold();
      const telegraph = new TelegraphTracker();
      const limiter = new AlertLimiter();
      let tele: TelegraphOutput = { banner: null, cursedLeftS: null, announce: [], log: null };
      let crackAnnouncedAt: number | null = null;
      let crackIntroAt: number | null = null;
      let heardCrack: { bearing: number; until: number } | null = null;
      let heardSlurp: { bearing: number; until: number } | null = null;
      let crackEscapes = 0;
      let crackChases = 0;
      let hydeChases = 0;
      let lastEdge: MysteryHudModel['threatEdge'] = null;
      // ---- final HUD (UX_FINAL): threats strip, Odds v3, lens, tally, cabinet, Weems, death sequence
      let endCalled = false;
      let deathDone = false;
      const endRun = () => {
        if (endCalled || !reported) return;
        endCalled = true;
        opts.current.onEnded(run, analytics);
      };
      const final = new FinalHud(run as unknown as FinalRunLike, scene as unknown as SceneDeathApi, analytics, {
        caption: (text, tone) => captions.push({ text, tone, dir: null }, realT),
        announce: (text, mode) => announce(text, mode),
        sound: (name) => audio.play(name as Sfx),
        why: (id, head, text) => say({ id, kind: 'why', head, text, priority: 5, basis: 'rule' }),
        catchFlash: () => {
          catchFlashSeq++;
        },
        flashAreas: (target) => {
          for (const a of world?.areas ?? []) {
            if (!target || Math.hypot(a.x - target.x, a.z - target.z) <= a.radiusM + 2) flash({ kind: 'reveal', x: a.x, z: a.z, t0: run.t });
          }
        },
        deathContinue: () => {
          deathDone = true;
          endRun();
        },
      });

      const showToast = (t: Omit<Toast, 'id'>, s: number) => {
        toast = { t: { ...t, id: ++toastSeq }, until: realT + s };
      };
      const bearing = () => run.hydeBearing?.() ?? null;
      /** Every stack item passes the §6 limiter (Crackstone P5 ≤ 1 / 20 s, same code ≥ 45 s, alerts ≤ 4 / min). */
      const say = (item: Omit<StackItem, 't'> & { t?: number }) => {
        if (!limiter.allow(item, realT)) return;
        stack.push({ ...item, t: item.t ?? realT }, realT);
      };
      const crackHunting = () => !!crack && crack.active() && (crack.rt.mode === 'CHASE' || crack.rt.mode === 'ATTACK');
      /** Caption direction toward Crackstone (only used for the public telegraph / sighting / nearby-rustle captions). */
      const crackDir = () => {
        const b = crack?.bearing() ?? null;
        return b ? { dir: directionOf(b.angle), distanceM: b.distanceM, angle: b.angle } : null;
      };
      const crackCaption = (text: string, tone: 'info' | 'warn' | 'danger' | 'good', directional: boolean) => {
        const d = directional ? crackDir() : null;
        captions.push({ text, tone, dir: d?.dir ?? null }, realT);
        if (d) heardCrack = { bearing: heardBearing(run.player.yaw, d.angle), until: realT + HEARD_HYDE_S };
      };
      const sayLog = (id: string, text: string, auto = true) => say({ id, kind: 'log', head: "THING'S LOG", text, priority: 0, auto });
      const fromMsg = (m: LiveMessage, auto = true, priority = m.priority): Omit<StackItem, 't'> => ({
        id: m.id, kind: stackKindOf(m.kind), head: m.title, text: m.text, why: m.why ?? null, ...(m.basis ? { basis: m.basis } : {}), priority, auto, target: m.target ?? null,
      });
      const threatNow = () => (emerged && (run.hyde.mode === 'INVESTIGATE_SOUND' || run.hyde.mode === 'SEARCH' || run.hyde.mode === 'CHASE')) || crackHunting();
      const towerTarget: MapTarget = { x: run.map.tower.x, z: run.map.tower.z, label: 'Iago Tower', kind: 'tower' };
      const areaIdNear = (t: { x: number; z: number }) => world?.areas.find((a) => Math.hypot(a.x - t.x, a.z - t.z) <= a.radiusM + 1)?.id ?? null;
      const flash = (f: PublicMapState['flashes'][number]) => {
        flashes.push(f);
        while (flashes.length > 8) flashes.shift();
      };

      /** Legacy-advice adapter (analytics without live()): a prescriptive Advice as a THING'S ADVICE card. */
      const sayAdvice = (a: Advice, priority: number, auto: boolean) => {
        lastAdvice = a;
        say({ id: `advice_${a.t}_${a.action}`, kind: 'advice', head: "THING'S ADVICE", text: a.text, why: a.reason, priority, auto, target: a.target ? { ...a.target, label: '' } : null });
      };

      // ---------------------------------------------------------------------------------------- hint ladder (R7)
      const fallbackHint = (level: 1 | 2 | 3): LiveMessage | null => {
        const ob = run.objective();
        if (level === 1) return { id: `hint1_${realT}`, kind: 'log', title: "THING'S LOG", text: ob === 'find_egg' ? 'Find the egg. Check the odds.' : run.caseDef.thing.whereHint, t: run.t, priority: 0 };
        const f = liveA?.forecasts;
        if (ob === 'find_clues' && f?.clueAreas?.areas.length) {
          const top = [...f.clueAreas.areas].sort((a, b) => b.p - a.p)[0]!;
          return { id: `hint${level}_${realT}`, kind: 'advice', title: "THING'S ADVICE", text: `Try the ${top.name}. Clue chance ${Math.round(top.p * 20) * 5}%.`, why: f.clueAreas.label, t: run.t, priority: 2, target: { x: top.x, z: top.z, label: top.name } };
        }
        if (ob === 'find_egg' && f?.egg?.sites.length) {
          const top = [...f.egg.sites].filter((s) => !s.ruledOut).sort((a, b) => b.p - a.p)[0];
          if (top) return { id: `hint${level}_${realT}`, kind: 'advice', title: "THING'S ADVICE", text: `Search the ${top.label}. The egg is most likely there.`, why: f.egg.label, t: run.t, priority: 2, target: { x: top.x, z: top.z, label: top.label } };
        }
        return null;
      };
      const showHint = (level: 1 | 2 | 3, requested: boolean) => {
        let msg: LiveMessage | null = null;
        if (hasLive && typeof liveApi.hint === 'function') {
          try {
            msg = liveApi.hint(level, { requested });
          } catch (err) {
            console.warn('[mystery] analytics.hint failed', err);
          }
        }
        msg ??= fallbackHint(level);
        if (!msg) return;
        say({ ...fromMsg(msg, !requested, requested ? Math.max(4, msg.priority) : msg.priority) });
        if (level === 1 && world) {
          for (const a of world.areas) flash({ kind: 'reveal', x: a.x, z: a.z, t0: run.t });
        }
        if (level >= 2 && msg.target) {
          const lvl = level as 2 | 3;
          hintShow = { level: lvl, areaId: areaIdNear(msg.target), target: { ...msg.target, kind: lvl === 2 ? 'area' : 'site' }, until: realT + HINT_SHOW_S[lvl] };
          route = null;
          if (lvl === 3) scene.pointThing?.({ x: msg.target.x, z: msg.target.z });
        }
      };

      // ---------------------------------------------------------------------------------------- events
      const handle = (events: StampedEvent[], advice: Advice | null) => {
        // Without the live feed: context advice from the prescriptive service (analytics-paced).
        if (!hasLive && advice && !events.some((e) => e.type === 'hint_requested')) sayAdvice(advice, threatNow() ? 4 : 2, true);
        if (hasLive && advice) lastAdvice = advice;
        for (const e of events) {
          const b = bearing();
          const cap = captionFor(e, abilityName, b ? directionOf(b.angle) : null, b?.distanceM ?? Math.hypot(run.hyde.x - run.player.x, run.hyde.z - run.player.z));
          if (cap) {
            captions.push(cap, realT); // captions are always on (UX §7), muted or not
            if (e.type === 'hyde_mode' && b && cap.dir) heard = { bearing: heardBearing(run.player.yaw, b.angle), until: realT + HEARD_HYDE_S };
          }
          if (crack) crackEvent(e, events);
          switch (e.type) {
            case 'hyde_mode':
              if (e.to === 'CHASE') hydeChases++;
              if (e.to === 'CHASE') {
                audio.play('growl');
                announce('The Hyde is chasing you!', 'alert');
                if (!hasLive) say({ id: `chase_${e.seq}`, kind: 'why', head: 'HYDE ALERT', text: 'It sees you! Break its line of sight!', priority: 5 });
              } else if (e.to === 'INVESTIGATE_SOUND') {
                audio.play('sting');
                announce('The Hyde heard a noise.');
              } else if (e.to === 'SEARCH') {
                announce('The Hyde is searching.');
              } else if (e.to === 'COOLDOWN' && e.from === 'CHASE' && !hasLive) {
                sayLog(`lost_${e.seq}`, 'Hyde lost you.');
              }
              break;
            case 'catch':
              audio.play(e.blocked ? 'clean' : 'rescue');
              catchFlashSeq++;
              if (e.blocked) showToast({ tone: 'success', icon: 'shieldCheck', headline: `BLOCKED — no damage. Catch still counts: ${e.catchNumber} of 2`, sub: null }, 2);
              else if (e.catchNumber === 1) showToast({ tone: 'danger', icon: 'claw', headline: `CAUGHT — 1 of 2 · −${Math.round(e.hpLost)} HP`, sub: 'Released at a safe spot. Next catch ends the run.' }, 2);
              announce(e.blocked ? `Grab blocked. The catch still counts: ${e.catchNumber} of 2.` : `Caught! ${e.catchNumber} of 2.`, 'alert');
              break;
            case 'clue_found': {
              audio.play('chime');
              audio.play('paper');
              const c = clueCardContent(run.caseDef, e.clueId);
              clueCard = { v: { id: ++toastSeq, clueId: e.clueId, ...c }, shownAt: realT, until: realT + CLUE_CARD_S };
              announce(`Clue found: ${c.fullTitle}. ${c.short}${c.meaning ? ` Meaning: ${c.meaning}` : ''}`);
              if (!hasLive) sayLog(`clues_${e.cluesFound}`, `${e.cluesFound} of ${run.caseDef.clues.length} clues found.`);
              ladder.progress();
              hintShow = null;
              obsEpoch++;
              break;
            }
            case 'egg_pickup':
              audio.play('clean');
              ladder.progress();
              hintShow = null;
              // With live analytics the first carrying advice is "Take the egg to Iago Tower." and the centre prompt already
              // shows "Hold E: set the egg down", so this tip is only the fallback.
              if (!firstCarryTip && !hasLive) {
                firstCarryTip = true;
                say({ id: 'tip_carry', kind: 'advice', head: "THING'S ADVICE", text: 'Hold E: set the egg down', why: 'Heavy egg: you are slower and louder.', priority: 2 });
              }
              break;
            case 'egg_drop':
              audio.play('thud');
              if (e.reason !== 'manual') announce('You dropped the egg.', 'alert');
              break;
            case 'egg_delivered':
              audio.play('fanfare');
              if (!hasLive) sayLog('egg_secured', 'Egg secured.');
              break;
            case 'ability_used':
              audio.play('whoosh');
              if (e.success && e.kinds.includes('power_switch') && run.map.powerSwitch && run.isWallOpen(run.map.powerSwitch.gateWallId)) {
                examine = { v: { id: ++toastSeq, kind: 'switch', head: 'GATE POWERED', text: 'The shortcut gate is open.', odds: null }, until: realT + EXAMINE_TOAST_S, trace: null };
              }
              break;
            case 'ability_denied': {
              audio.play('denied');
              const meta = e.key === 'F' ? power : move;
              const st = e.key === 'F' ? run.powerStatus() : run.moveStatus();
              meta.denied = { seq: ++deniedSeq, at: realT, text: e.reason === 'no_target' ? 'No Hyde in range' : `Not ready · ${Math.ceil(st.cooldownLeftS)} s` };
              break;
            }
            case 'examined': {
              const ex = world?.examines.find((x) => x.id === e.examineId);
              examine = { v: { id: ++toastSeq, kind: 'examine', head: null, text: ex?.text ?? 'You look closely.', odds: null }, until: realT + EXAMINE_TOAST_S, trace: null };
              ladder.progress();
              break;
            }
            case 'trace_found': {
              const site = world?.eggSites.find((x) => x.id === e.siteId);
              const trace = { siteId: e.siteId, before: tracker.lastPct(`egg:${e.siteId}`), label: site?.label ?? 'egg' };
              if (examine && examine.v.kind === 'examine' && realT < examine.until) examine.trace = trace;
              else examine = { v: { id: ++toastSeq, kind: 'examine', head: null, text: site?.traceText ?? 'A trace of the egg.', odds: null }, until: realT + EXAMINE_TOAST_S, trace };
              obsEpoch++;
              break;
            }
            case 'site_checked':
              obsEpoch++;
              ladder.progress();
              if (!e.found && realT - lastEmptyToastAt >= EMPTY_TOAST_GAP_S && !(examine && realT < examine.until)) {
                lastEmptyToastAt = realT;
                examine = {
                  v: { id: ++toastSeq, kind: 'empty', head: null, text: e.site === 'clue' ? 'Nothing here.' : 'Not here.', odds: e.site === 'clue' ? 'Clue odds updated.' : 'Egg odds updated.' },
                  until: realT + EXAMINE_TOAST_S, trace: null,
                };
                if (e.site === 'egg') sayLog(`egg_empty_${e.siteId}`, 'Not here. Odds updated.');
              }
              break;
            case 'passage_opened': {
              const ps = world?.passage;
              examine = { v: { id: ++toastSeq, kind: 'passage', head: 'PASSAGE OPEN', text: ps?.text ?? 'A hidden passage opens.', odds: null }, until: realT + EXAMINE_TOAST_S, trace: null };
              const dir = ps ? relDir({ x: ps.leverX, z: ps.leverZ }) : null;
              captions.push({ text: '[Stone grinds open]', tone: 'info', dir }, realT);
              sayLog('passage_open', 'Hidden passage open.');
              audio.play('grind');
              announce('Hidden passage open.');
              if (ps) flash({ kind: 'passage', wallId: ps.wallId, x: ps.leverX, z: ps.leverZ, t0: run.t });
              break;
            }
            case 'hazard_triggered': {
              const hz = world?.hazards.find((h) => h.id === e.hazardId);
              const text = !hz ? '[A loud noise]' : hz.kind === 'searchlight' ? '[Searchlight hums]'
                : hz.look === 'glass' ? '[Glass crunches]' : hz.look === 'boards' ? '[Boards creak]' : hz.look === 'rubble' ? '[Rubble shifts]' : '[Water splashes]';
              captions.push({ text, tone: 'warn', dir: null }, realT);
              if (hz) seenHazards.add(hz.id);
              break;
            }
            case 'hyde_emerged':
              emerged = true;
              announce('The Hyde has emerged.', 'alert');
              audio.play('sting');
              break;
            case 'hyde_sighted':
              obsEpoch++;
              break;
            case 'slurp_mode': {
              // his groans are directional when he is within earshot (compass outline 3 s, like the Hyde's)
              const sb = (run as unknown as { slurpBearing?: () => { angle: number; distanceM: number } }).slurpBearing?.();
              if (sb && sb.distanceM <= 25 && e.to !== 'WANDER') heardSlurp = { bearing: heardBearing(run.player.yaw, sb.angle), until: realT + HEARD_HYDE_S };
              final.forceOdds();
              break;
            }
            case 'cabinet':
              final.forceOdds(); // "Hidden" facts follow the door at once
              break;
            case 'dnf':
              // the death sequence (FinalHud) takes over: letterbox, cutscene, GAME-OVER card (UX_FINAL §3)
              if (!ending) ending = { outcome: 'dnf', at: realT };
              catchFlashSeq++;
              audio.play('toll');
              break;
            case 'finish':
              if (!ending) ending = { outcome: 'finished', at: realT };
              break;
            default:
              break;
          }
        }
      };

      /** Caption direction of a world point relative to the facing. */
      const relDir = (pt: Vec2) => directionOf((-relBearingDeg(run.player.yaw, run.player, pt) * Math.PI) / 180);

      // ---------------------------------------------------------------------------------------- Crackstone events
      const crackEvent = (e: StampedEvent, batch: readonly StampedEvent[]) => {
        if (!crack) return;
        const cfg = crack.tuning;
        switch (e.type) {
          case 'crackstone_mode': {
            final.forceOdds(); // rebuild the odds rows now so a stale "Hunting you" fact clears with the chip, not a second later
            if (e.reason === 'deferred') return; // he yielded to a Hyde chase (R6): say nothing
            if (encounterStart(e)) {
              crackChases++;
              announce('Crackstone is hunting you!', 'alert');
              // with the live feed the analytics layer writes the CRACKSTONE items (liveMessages.ts); this is the fallback
              const why = CHASE_WHY[e.reason];
              if (!hasLive && why) say({ id: `crack_chase_${e.reason}_${e.seq}`, kind: 'why', head: CRACK_HEAD, text: why, priority: 5, basis: 'rule' });
              if (!hasLive) say({ id: `crack_advice_hide_${e.seq}`, kind: 'advice', head: "THING'S ADVICE", text: 'Get behind a wall or hide.', why: 'He hunts by sight, not sound.', priority: 4 });
            } else if ((e.from === 'CHASE' || e.from === 'ATTACK') && e.to === 'SEARCH' && ESCAPE_WHY[e.reason]) {
              crackEscapes++;
              if (!hasLive) {
                say({ id: `crack_escape_${e.reason}_${e.seq}`, kind: 'why', head: CRACK_HEAD, text: ESCAPE_WHY[e.reason]!, priority: 3, basis: 'rule' });
                sayLog(`crack_lost_${e.seq}`, `Crackstone lost you. Escapes: ${crackEscapes}.`);
              }
              announce('Crackstone lost you.');
            } else if (e.to === 'PATROL') {
              const d = crackDir();
              if (d && d.distanceM <= CRACK_RUSTLE_M) crackCaption('[Cloak rustles]', 'info', true);
            }
            return;
          }
          case 'crackstone_sighted':
            audio.play('knell');
            crackCaption('[A bell tolls]', 'danger', true);
            return;
          case 'crackstone_scan': {
            const d = crackDir();
            const near = !!d && d.distanceM <= CRACK_CHANT_M;
            if (e.phase === 'warning') {
              if (near) {
                audio.play('chant', { durS: cfg.scanWarnS });
                crackCaption('[Crackstone chants]', 'warn', true);
              }
            } else if (near || e.hit) {
              audio.play('pulse');
              crackCaption('[A cold wave passes]', e.hit ? 'danger' : 'info', false);
            }
            return;
          }
          case 'curse':
            if (e.phase === 'cast') {
              audio.play('curseCast', { durS: cfg.curseWindupS });
              crackCaption('[A curse hisses]', 'danger', false);
            } else if (e.phase === 'hit') {
              if (e.blocked) {
                audio.play('curseFizzle');
                audio.play('clean');
                crackCaption('[The curse fizzles]', 'good', false);
                announce('Curse blocked. No damage.', 'alert');
              } else {
                audio.play('curseHit');
                crackCaption('[The curse strikes you]', 'danger', false);
                announce(`Cursed! Minus ${Math.round(e.hpLost)} HP. You are slowed.`, 'alert');
                if (!hasLive) say({ id: `crack_curse_hit_${e.seq}`, kind: 'why', head: CRACK_HEAD, text: 'The curse hit: you stayed in the ring.', priority: 5, basis: 'rule' });
              }
            } else {
              audio.play('curseFizzle');
              crackCaption('[The curse fizzles]', 'info', false);
              // a dodge (not a cancellation by a stun / lure / the Hyde's chase in the same step)
              const cancelled = batch.some((x) => x.type === 'crackstone_mode' && (x.reason === 'stunned' || x.reason === 'lured' || x.reason === 'deferred'))
                || run.effects().crackstoneStunned;
              if (!hasLive && !cancelled) say({ id: `crack_curse_dodged_${e.seq}`, kind: 'why', head: CRACK_HEAD, text: 'Curse dodged: you left the ring in time.', priority: 3, basis: 'rule' });
            }
            return;
          default:
            return;
        }
      };

      const watchStatus = () => {
        if (run.status === lastStatus) return;
        const prev = lastStatus;
        lastStatus = run.status;
        if (prev === 'tutorial' && run.status === 'playing') {
          sayLog('go', 'Go. Tab shows your evidence.', false);
          if (crack) crackIntroAt = realT + CRACK_INTRO_DELAY_S;
        }
        if (run.status === 'accusing') {
          liveRef.current?.flushNow('deposit');
          opts.current.onDeposited();
        }
        if ((run.status === 'finished' || run.status === 'dnf') && !ending) ending = { outcome: run.status, at: realT };
      };

      // ---------------------------------------------------------------------------------------- slow tick (4 Hz)
      const slowTick = () => {
        inv = investigationOf(run);
        emerged = hydeEmergedOf(run, inv);
        hydeVisible = emerged && hydeVisibleOf(run);
        const me = { x: run.player.x, z: run.player.z };
        // seen hazards / lever (≤ 12 m with line of sight) or outlined by a reveal power
        const fx = run.effects();
        for (const h of world?.hazards ?? []) {
          if (seenHazards.has(h.id)) continue;
          const pts = h.kind === 'searchlight' ? [{ x: h.x, z: h.z }] : h.polygon;
          const near = pts.some((q) => Math.hypot(q.x - me.x, q.z - me.z) <= (fx.revealHazards ? 25 : SEEN_M) && (fx.revealHazards || los(me, q)));
          if (near) seenHazards.add(h.id);
        }
        const ps = world?.passage;
        if (ps && !leverSeen && Math.hypot(ps.leverX - me.x, ps.leverZ - me.z) <= SEEN_M && los(me, { x: ps.leverX, z: ps.leverZ })) leverSeen = true;
        // visited areas + "nothing left" times
        for (const a of world?.areas ?? []) {
          if (Math.hypot(a.x - me.x, a.z - me.z) <= a.radiusM) visitedAreas.add(a.id);
          if (areaDoneAt[a.id] === undefined && areaIsDone(a.id)) areaDoneAt[a.id] = run.t;
        }
        // reveal pulses: a clue site / the egg just became known
        const known = new Set(Object.values(inv.knownClueSites).filter((x): x is string => !!x));
        for (const id of known) {
          if (knownSites.has(id)) continue;
          const st = world?.clueSites.flatMap((g) => g.sites).find((x) => x.id === id);
          if (st) flash({ kind: 'reveal', x: st.x, z: st.z, t0: run.t });
        }
        knownSites = known;
        if (inv.eggSeenAt && inv.eggSeenAt !== eggSeenWas) {
          const st = world?.eggSites.find((x) => x.id === inv.eggSeenAt);
          if (st) flash({ kind: 'reveal', x: st.x, z: st.z, t0: run.t });
        }
        eggSeenWas = inv.eggSeenAt;
        // proximity shimmer: only near a KNOWN (seen) uncollected clue site — never the hidden truth
        let best: { d: number; pt: Vec2; area: string } | null = null;
        for (const [clueId, siteId] of Object.entries(inv.knownClueSites)) {
          if (!siteId || run.cluesFound.includes(clueId as ClueId)) continue;
          const st = world?.clueSites.flatMap((g) => g.sites).find((x) => x.id === siteId);
          if (!st) continue;
          const d = Math.hypot(st.x - me.x, st.z - me.z);
          if (!best || d < best.d) best = { d, pt: st, area: st.areaId };
        }
        const level = run.status === 'playing' && best ? (best.d >= SHIMMER_FAR_M ? 0 : best.d <= SHIMMER_NEAR_M ? 1 : (SHIMMER_FAR_M - best.d) / (SHIMMER_FAR_M - SHIMMER_NEAR_M)) : 0;
        shimmer = level;
        const pan = best ? Math.max(-1, Math.min(1, relBearingDeg(run.player.yaw, me, best.pt) / 90)) : 0;
        audio.setShimmer(level, pan);
        if (best && level > 0 && !shimmerSaid.has(best.area)) {
          shimmerSaid.add(best.area);
          captions.push({ text: '[Faint shimmer]', tone: 'good', dir: relDir(best.pt) }, realT);
        }
      };
      const areaIsDone = (areaId: string): boolean => {
        if (!world) return false;
        const open = world.clueSites.filter((g) => !run.cluesFound.includes(g.clueId));
        if (open.length === 0) return true;
        return !open.some((g) => {
          const known = inv.knownClueSites[g.clueId];
          return g.sites.some((s) => s.areaId === areaId && (known ? known === s.id : !inv.checkedClueSites.includes(s.id)));
        });
      };

      /**
       * Crackstone items from the analytics feed: scan / curse warnings never enter the stack (the banner owns them), a
       * deferral says nothing; other Crackstone diagnostics carry the CRACKSTONE headword. null = not about him.
       */
      const CRACK_SILENT = new Set([THING.crackstone.scanWarn.text, THING.crackstone.curseWarn.text, THING.crackstone.deferred.text]);
      const crackMessage = (m: LiveMessage): 'drop' | 'crack' | null => {
        const about = /crack|curse/i.test(m.id) || /crackstone/i.test(m.title);
        if (!about) return null;
        if (CRACK_SILENT.has(m.text) || /scan_?warn|curse_?warn|deferred/i.test(m.id)) return 'drop';
        return 'crack';
      };

      // ---------------------------------------------------------------------------------------- live tick (~3 Hz)
      const liveTick = () => {
        if (!hasLive) return;
        try {
          liveA = liveApi.live!();
        } catch (err) {
          console.warn('[mystery] analytics.live failed', err);
          return;
        }
        for (const m of liveA.messages) {
          if (/WEEMS/i.test(m.title)) continue; // UX_FINAL §4: Weems' text never enters Thing's stack (her card shows it)
          const cm = crackMessage(m);
          if (cm === 'drop') continue;
          if (/crackstone_area/.test(m.id) && crackAnnouncedAt === null) crackAnnouncedAt = run.t; // label promoted 30 s
          if (m.kind === 'advice' && m.target) adviceTarget = { ...m.target, kind: 'advice', until: realT + ADVICE_TARGET_S };
          const item = fromMsg(m);
          say(cm === 'crack' && item.kind === 'why' ? { ...item, head: CRACK_HEAD } : item);
        }
        const prevLatest = tracker.latest;
        tracker.update(liveA.forecasts, inv, obsEpoch, realT);
        const nl = tracker.latest;
        if (nl && nl !== prevLatest) {
          // an observation moved an egg / clue estimate by ≥ 10 points: glass tick; ≥ 20 points is announced politely
          audio.play('glass');
          if (Math.abs(nl.to - nl.from) >= 20) announce(`${nl.id.startsWith('egg:') ? 'Egg' : 'Clue'} odds: ${nl.name} ${nl.from} to ${nl.to} percent.`);
        }
        if (examine?.trace && examine.v.odds === null) {
          const after = tracker.lastPct(`egg:${examine.trace.siteId}`);
          const before = examine.trace.before;
          examine.v = { ...examine.v, odds: before !== undefined && after !== undefined && before !== after ? `Egg odds: ${examine.trace.label} ${deltaText(before, after)}` : 'Egg odds updated.' };
        }
      };

      // ---------------------------------------------------------------------------------------- nav feed (≤ 30 Hz)
      const objectiveTarget = (): MapTarget | null => {
        const ob = run.objective();
        if (ob === 'deliver_egg' || ob === 'accuse') return towerTarget;
        if (ob === 'retrieve_egg' && run.egg.state === 'dropped') return { x: run.egg.x, z: run.egg.z, label: 'Dropped egg', kind: 'egg' };
        if (final.weemsMark && realT < final.weemsMark.until) return { x: final.weemsMark.x, z: final.weemsMark.z, label: final.weemsMark.label, kind: 'site' };
        if (hintShow && realT < hintShow.until && hintShow.target) return hintShow.target;
        if (adviceTarget && realT < adviceTarget.until) return adviceTarget;
        return null;
      };
      const routeFor = (target: MapTarget | null): Vec2[] | null => {
        const ob = run.objective();
        const want = ob === 'deliver_egg' || ob === 'retrieve_egg' || (hintShow?.level === 3 && realT < hintShow.until);
        if (!want || !target) return null;
        const key = `${target.x.toFixed(1)},${target.z.toFixed(1)}`;
        if (!route || route.key !== key || realT - route.at > 1) {
          route = { pts: routeOf(run, run.player, target) ?? [{ x: run.player.x, z: run.player.z }, target], key, at: realT };
        }
        return route.pts;
      };
      const mapState = (): PublicMapState => {
        const fx = run.effects();
        const egg = run.egg;
        const chase = emerged && run.hyde.mode === 'CHASE';
        const target = objectiveTarget();
        return {
          t: run.t,
          geometry,
          world,
          investigation: inv,
          forecasts: liveA?.forecasts ?? null,
          cluesFound: run.cluesFound,
          objective: run.objective(),
          player: {
            x: run.player.x, z: run.player.z, yaw: run.player.yaw, stance: run.player.stance, crouched: run.player.crouched,
            noiseRadiusM: run.noiseRadiusM?.() ?? 0, noiseBand: noiseBand(noise.value),
          },
          eggState: egg.state,
          // dropped: the player saw it fall; resting: only while a reveal power shows it (power-justified)
          eggMarker: egg.state === 'dropped' ? { x: egg.x, z: egg.z, kind: 'dropped' } : egg.state === 'resting' && fx.revealEgg ? { x: egg.x, z: egg.z, kind: 'revealed' } : null,
          // R4 for both enemies: visible, chasing, or shown by an enemy reveal effect in range
          hyde: emerged && ((run as { hydeActive?: boolean }).hydeActive ?? true) && (hydeVisible || chase || revealedByEffect(fx, Math.hypot(run.hyde.x - run.player.x, run.hyde.z - run.player.z)))
            ? { x: run.hyde.x, z: run.hyde.z, mode: chase ? 'chase' : 'visible' } : null,
          crack: crack ? crackMapState(crack, fx, run.player, crackAnnouncedAt) : null,
          ...final.mapExtras(),
          openWalls: [world?.passage?.wallId, run.map.powerSwitch?.gateWallId].filter((id): id is string => !!id && run.isWallOpen(id)),
          seenHazards: seenArr.length === seenHazards.size ? seenArr : (seenArr = [...seenHazards]),
          leverSeen,
          showSwitch: hasSwitch,
          hint: hintShow && realT < hintShow.until ? { level: hintShow.level, areaId: hintShow.areaId, target: hintShow.target } : { level: 0, areaId: null, target: null },
          target,
          route: routeFor(target),
          visitedAreas: visitedArr.length === visitedAreas.size ? visitedArr : (visitedArr = [...visitedAreas]),
          areaDoneAt,
          flashes: flashArr.length === flashes.length && flashLast === flashes[flashes.length - 1] ? flashArr : ((flashLast = flashes[flashes.length - 1]), (flashArr = [...flashes])),
        };
      };
      const navFeed = (): NavFeed | null => {
        if (feedCache && feedCache.realT === realT && feedCache.simT === run.t) return feedCache.feed; // same frame
        const st = getSettings();
        const s = mapState();
        const o = {
          heardHydeBearing: heard && realT < heard.until ? heard.bearing : null,
          heardCrackBearing: heardCrack && realT < heardCrack.until ? heardCrack.bearing : null,
          heardSlurpBearing: heardSlurp && realT < heardSlurp.until ? heardSlurp.bearing : null,
          showPredictions: st.showRisk, highContrast: st.highContrast, reducedMotion: st.reducedMotion, lowGraphics: st.lowGraphics,
        };
        const key = mapFeedKey(s, o) + (st.lowGraphics ? '|L' : '');
        if (feedCache && feedCache.feed.key === key) {
          // nothing the minimap / compass show has changed: keep the built layers + markers (and the canvases skip)
          feedCache.realT = realT;
          feedCache.simT = run.t;
          return feedCache.feed;
        }
        const feed = buildNavFeed(s, o, key);
        feedCache = { realT, simT: run.t, feed };
        return feed;
      };

      // ---------------------------------------------------------------------------------------- HUD snapshot (15 Hz)
      const stackBlocked = () => run.status !== 'playing' || (!!clueCard && realT - clueCard.shownAt < CLUE_CARD_BLOCK_S) || (!!toast && toast.t.tone === 'danger');
      const stackView = (sh: { item: StackItem } | null): StackView | null => sh && {
        id: sh.item.id, kind: sh.item.kind, head: sh.item.head, text: sh.item.text, why: sh.item.why ?? null, basis: sh.item.basis ?? null, priority: sh.item.priority,
      };
      const hudSnapshot = (): MysteryHudModel => {
        const shown = stack.update(realT, stackBlocked());
        // The in-world Thing mirrors the card's gesture (null = its own idle).
        const card = shown.card?.item ?? null;
        if (card && card.id !== lastCardId) {
          lastCardId = card.id;
          // UX §6 sounds: ADVICE double knock; POWER STATUS soft rise; INVESTIGATION page flip (Hyde alerts: the sting already played)
          if (card.kind === 'advice') audio.play('knock');
          else if (card.head === 'POWER STATUS') audio.play('rise');
          else if (card.head === 'INVESTIGATION') audio.play('page');
        }
        const pose = run.status === 'tutorial' || !card ? null : card.kind === 'advice' ? 'point' : card.head === 'HYDE ALERT' ? 'fist' : 'tap';
        if (pose !== lastPose) {
          scene.setThingPose?.(pose);
          lastPose = pose;
        }
        if (card?.kind === 'advice' && card.target) adviceTarget = { ...card.target, kind: 'advice', until: Math.max(adviceTarget?.until ?? 0, realT + ADVICE_TARGET_S) };
        if (toast && realT > toast.until) toast = null;
        if (clueCard && realT > clueCard.until) clueCard = null;
        if (examine && realT > examine.until) examine = null;
        // ---- Crackstone: plaque (0.5 s hold; CHASE / ATTACK bypass), edge candidates (R4-gated), banner, CURSED row
        let crackView: MysteryHudModel['crack'] = null;
        let crackEdge: HudExtras['crackEdge'] = null;
        if (crack && crack.active()) {
          const fx = run.effects();
          crackView = crackHudView(crack, crackHold.update(crackPillKey(crack.rt), realT), fx, run.t);
          const kind = crackMarkerKind(crack, fx, run.player);
          const b = crack.bearing();
          const scr = (scene as { getCrackstoneScreen?: () => { onScreen: boolean; ndcX: number; ndcY: number; behind: boolean } }).getCrackstoneScreen?.() ?? null;
          const at = kind === 'chase' || kind === 'attack' ? threatEdgePoint(scr, b) : null;
          let curseAt: { x: number; y: number; rot: number } | null = null;
          const cu = crack.rt.curse;
          if (cu) {
            const rel = relBearingDeg(run.player.yaw, run.player, cu);
            if (curseEdgeWanted(cu, run.player, rel)) {
              const d = Math.hypot(cu.x - run.player.x, cu.z - run.player.z);
              // under the camera: a downward chevron in the free gap beside the bottom stack
              curseAt = d < 1.5 ? { x: 0.25, y: 0.93, rot: Math.PI } : threatEdgePoint(null, { angle: (-rel * Math.PI) / 180, distanceM: d });
            }
          }
          crackEdge = { chase: kind === 'chase' ? at : null, attack: kind === 'attack' ? at : null, curse: curseAt };
        }
        const shownMode = threat.update(run.hyde.mode, realT);
        const r = analytics.currentRisk();
        const risk = riskHold.update(r && run.status === 'playing' ? { p: r.p, band: r.band, source: r.source, label: r.label, detectedNow: r.detectedNow } : null, realT);
        const st = getSettings();
        let lastWhyItem: (typeof stack.history)[number] | undefined;
        for (let k = stack.history.length - 1; k >= 0; k--) {
          if (stack.history[k]!.kind === 'why') {
            lastWhyItem = stack.history[k];
            break;
          }
        }
        const hb = bearing();
        const fs = final.snapshot({
          realT, hydeMode: shownMode, hydeEffect: effectChip(run), emerged, hydeVisible, inv, crack, crackView, forecasts: liveA?.forecasts ?? null,
          deltas: tracker.active, risk: run.status === 'playing' && emerged ? risk : null,
          hydeHeardNear: !!heard && realT < heard.until && !!hb && hb.distanceM <= 8,
          reducedMotion: st.reducedMotion, lastWhy: lastWhyItem && realT - lastWhyItem.t < 20 ? lastWhyItem.text : null, hasLive,
          hasClueCard: !!clueCard, edgePoint: threatEdgePoint,
        });
        const model = buildHud(run, {
          now: realT, noise: noise.value, shownMode, power, move,
          captions: captions.prune(realT), toast: toast?.t ?? null, catchFlashSeq,
          hintCooldownS: ladder.cooldownLeftS(realT), hintLevel: hintShow && realT < hintShow.until ? hintShow.level : ladder.level,
          noiseRadiusM: run.noiseRadiusM?.() ?? 0, bearing: bearing(), hydeScreen: scene.getHydeScreen?.() ?? null,
          risk: run.status === 'playing' && emerged ? risk : null,
          investigation: inv, hydeEmerged: emerged,
          clueCard: clueCard && !fs.suppressClueCard ? { ...clueCard.v, leaving: clueCard.until - realT <= 0.3 } : null,
          examineToast: examine?.v ?? null,
          stack: { log: stackView(shown.log), card: stackView(shown.card) },
          odds: fs.odds,
          threats: fs.threats, lens: fs.lens, tally: fs.tally, cabinet: fs.cabinet, weems: fs.weems, death: fs.death,
          slurpEdge: fs.slurpEdge, slurpHunting: fs.slurpHunting, catchTint: fs.catchTint,
          standStill: input.isHeld('KeyE') && run.player.speed > 0.5,
          areaName: feedCache?.feed.areaName ?? null,
          crack: crackView,
          banner: tele.banner,
          cursedLeftS: tele.cursedLeftS,
          crackEdge,
        });
        lastEdge = model.threatEdge;
        if (model.power.ready && !prevPowerReady) audio.play('ready');
        if (model.move.ready && !prevMoveReady) audio.play('ready');
        prevPowerReady = model.power.ready;
        prevMoveReady = model.move.ready;
        return model;
      };

      const live = () => run.status === 'tutorial' || run.status === 'playing';

      const nextInput = (dt: number): MysteryFrameInput => {
        const fromKeys = input.consume(dt);
        const lensN = input.takeLens();
        if (lensN > 0 && run.status === 'playing') final.cycleLens(lensN);
        if (final.dying) return IDLE_INPUT; // death sequence: the sim's input is cut at t0
        if (bot && run.status === 'playing') {
          // Autopilot (tests): decisions at the bot's rate, held inputs in between, look deltas only on decision frames.
          if (botStep % botEvery === 0) {
            botHeld = bot.decide();
            botStep++;
            return botHeld;
          }
          botStep++;
          return { ...botHeld, lookYawDelta: 0, lookPitchDelta: 0, interact: false, power: false, move: false, hint: false };
        }
        if (!opts.current.inputEnabled) {
          final.takeHint();
          return IDLE_INPUT;
        }
        let frameInput = fromKeys;
        // V = Ask Weems (UX_FINAL §4): only an ACCEPTED press reaches the sim as hint: true (one hint_requested, -50);
        // the first-use note, cooldown, "Not while hunted" and "No more hints here" are no-ops without a charge.
        if (frameInput.hint) {
          frameInput = { ...frameInput, hint: false };
          if (run.status === 'playing') final.askWeems(realT);
        }
        if (final.takeHint()) frameInput = { ...frameInput, hint: true };
        return frameInput;
      };

      /** One frame. `draw = false` (test fast-forward) skips the render. */
      const frame = (dt: number, draw = true): StampedEvent[] => {
        if (opts.current.paused) {
          input.consume(dt); // drop edges pressed while paused
          audio.calm();
          audio.setShimmer(0, 0);
          if (draw) scene.render(run, [], 0);
          return [];
        }
        realT += dt;
        const frameInput = nextInput(dt);
        const events = live() ? run.update(dt, frameInput) : [];
        const out = analytics.frame(run as unknown as MysteryRun, events);
        noise.update(events, dt);
        for (let i = 0; i < events.length; i++) {
          if (INV_EVENTS.has(events[i]!.type)) {
            inv = investigationOf(run);
            break;
          }
        }
        handle(events, out.advice);
        final.onEvents(events, realT, hasLive ? liveA : null, (out as { weems?: { text: string; target?: { x: number; z: number; label: string } | null } | null }).weems ?? null);
        watchStatus();
        if (crack) {
          tele = telegraph.update(crack, events, run.effects(), run.t, realT);
          for (const line of tele.announce) announce(line, 'alert');
          if (tele.log && !hasLive) sayLog('crack_scan_blocks', tele.log);
          // a banner owns the slot: a toast waits with its full duration
          if (tele.banner && toast) toast.until += dt;
          // the live feed sends its own area intro (advice:crackstone_area); this is the fallback
          if (crackIntroAt !== null && realT >= crackIntroAt && run.status === 'playing' && !hasLive) {
            crackIntroAt = null;
            crackAnnouncedAt = run.t;
            const l = thingLines.crackArea(crack.area.name);
            say({ id: 'crack_intro', kind: 'advice', head: "THING'S ADVICE", text: l.text, why: 'He hunts by sight, not sound.', priority: 2 });
            announce(l.text);
          }
        }
        if (realT >= nextSlowAt) {
          nextSlowAt = realT + SLOW_EVERY_S;
          slowTick();
        }
        if (realT >= nextLiveAt) {
          nextLiveAt = realT + LIVE_EVERY_S;
          liveTick();
        }
        if (realT >= nextStatusAt) {
          nextStatusAt = realT + STATUS_EVERY_S;
          const status = liveStatus();
          writeLive(browserStorage(), status);
          liveRef.current?.status(status);
        }
        // idle hint ladder: paused in SEARCH / CHASE (overlays stop this function), only while something is to be found
        ladderIn.status = run.status;
        ladderIn.emerged = emerged;
        ladderIn.hydeMode = crackHunting() ? 'CHASE' : run.hyde.mode;
        ladderIn.objective = run.objective();
        ladderIn.interacting = run.player.interacting;
        const paused = ladderPaused(ladderIn);
        const reached = ladder.tick(dt, paused);
        if (reached) showHint(reached, false);
        if (draw) scene.render(run, events, dt);
        if (run.status === 'playing' && (emerged || (crack && crack.active()))) {
          // ONE drone + heartbeat: threat = max of both; level = max; the enemy with the higher level drives the timbre
          const h = run.hyde;
          const hT = emerged ? h.suspicion : 0;
          const hL = emerged ? (h.mode === 'CHASE' || h.grabbing ? 2 : h.mode === 'INVESTIGATE_SOUND' || h.mode === 'SEARCH' ? 1 : 0) : 0;
          let cT = 0;
          let cL = 0;
          if (crack && crack.active()) {
            const m = crack.rt.mode;
            cT = Math.min(1, crack.rt.suspicion / crack.tuning.chaseAt);
            cL = m === 'CHASE' || m === 'ATTACK' ? 2 : m === 'INVESTIGATE' || m === 'SEARCH' || tele.banner?.kind === 'scan' && tele.banner.exposure === 'exposed' ? 1 : 0;
          }
          const source: ThreatSource = cL > hL || (cL === hL && cT > hT) ? 'crackstone' : 'hyde';
          audio.setThreat(Math.max(hT, cT), Math.max(hL, cL) as 0 | 1 | 2, source);
        } else audio.calm();
        if (ending && !reported && realT - ending.at >= END_DELAY_S[ending.outcome]) {
          reported = true;
          audio.calm();
          audio.setShimmer(0, 0);
          const status = liveStatus();
          writeLive(browserStorage(), status);
          liveRef.current?.status(status);
          liveRef.current?.runEnded(run, analytics); // flush the finish / dnf, then finalize in the background
          // a DNF with a death sequence waits for its card ("See results" / 12 s); the outcome is already recorded
          if (ending.outcome === 'finished' || !final.dying || deathDone) endRun();
        }
        return events;
      };

      const insights = (): LiveStatusWithInsights['insights'] => {
        const hb = (analytics as unknown as { heartbeat?: () => LiveStatusWithInsights['insights'] }).heartbeat;
        if (typeof hb !== 'function') return null;
        try {
          return hb.call(analytics);
        } catch {
          return null;
        }
      };
      const liveStatus = (): LiveStatusWithInsights => {
        const phase: LivePhase = run.status === 'tutorial' ? 'tutorial' : run.status === 'accusing' ? 'accusing' : run.status === 'dnf' ? 'dnf'
          : run.status === 'finished' ? 'results' : run.egg.state === 'carried' ? 'carrying' : 'investigating';
        const cr = analytics.currentRisk();
        const lastCard = stack.history.at(-1);
        return {
          stationId: opts.current.stationId, phase, nickname: opts.current.nickname, duo: run.duo, caseId: run.caseDef.id, clues: run.cluesFound.length,
          egg: { state: run.egg.state, tier: run.egg.state === 'resting' ? null : run.egg.tier, security: Math.round(run.egg.security) },
          hp: Math.round(run.player.hp), catches: run.player.catches, hydeMode: run.status === 'playing' && emerged ? run.hyde.mode : null,
          // Joseph Crackstone (UX_ENEMIES §8): his mode only (never his position) + chases by enemy
          crackstonePresent: !!crack, crackstoneMode: crack && run.status === 'playing' ? crack.rt.mode : null, chasesHyde: hydeChases, chasesCrack: crackChases,
          risk: cr ? { p: Math.round(cr.p * 100) / 100, label: cr.label } : null,
          advice: lastAdvice ? { text: lastAdvice.text, followed: analytics.adviceRecords.at(-1)?.followed ?? null }
            : lastCard?.kind === 'advice' ? { text: lastCard.text, followed: null } : null,
          activeTimeS: Math.round(run.t * 10) / 10, updatedAt: Date.now(),
          // Laptop 1 demo card: chases, tower %, egg odds, newest Thing item (public numbers only)
          insights: run.status === 'tutorial' ? null : insights(),
        };
      };

      // Tutorial-free runs (tutorial=0 / reloads) start in play: same opening log.
      if (run.status === 'playing') {
        sayLog('go', 'Go. Tab shows your evidence.', false);
        if (crack) crackIntroAt = realT + CRACK_INTRO_DELAY_S;
      }
      slowTick();

      api.current = {
        handle,
        boardLocked: () => {
          showToast({ tone: 'info', icon: 'lock', headline: 'Board locked while you’re chased', sub: null }, BOARD_LOCK_TOAST_S);
          setHud(hudSnapshot());
        },
        autopilot: (b) => {
          bot = b;
          botStep = 0;
          botEvery = b ? Math.max(1, Math.round(60 / b.o.decisionHz)) : 1;
        },
        nav: navFeed,
        mapState,
        live: () => liveA,
        final,
        now: () => realT,
      };

      let raf = 0;
      let last = performance.now();
      const loop = (now: number) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        try {
          frame(dt);
        } catch (err) {
          console.error(err);
          setError(err instanceof Error ? err.message : String(err));
          setPhase('error');
          return;
        }
        if (now - lastHudAt > (getSettings().lowGraphics ? HUD_INTERVAL_LOW_MS : HUD_INTERVAL_MS)) {
          lastHudAt = now;
          const model = hudSnapshot();
          const k = hudRenderKey(model);
          if (k !== lastHudKey || realT - lastHudSetAt >= HUD_FORCE_S) {
            lastHudKey = k;
            lastHudSetAt = realT;
            setHud(model);
          }
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      setHud(hudSnapshot());

      advanceRef.current = (ms: number) => {
        const steps = Math.max(1, Math.round(ms / (1000 / 60)));
        const all: StampedEvent[] = [];
        for (let i = 0; i < steps; i++) {
          all.push(...frame(1 / 60, false));
          // keep the stack's slot rules honest under fast-forward (cards expire on the same clock)
          if (i % 4 === 3) stack.update(realT, stackBlocked());
        }
        scene.render(run, all, 1 / 60);
        setHud(hudSnapshot());
      };

      debugRef.current = () => {
        const r = (v: number) => Math.round(v * 100) / 100;
        const pl = run.player;
        const h = run.hyde;
        const feed = navFeed();
        const shownCard = stack.card?.item ?? null;
        return {
          coords: 'metres, XZ ground plane; yaw 0 faces -Z, positive yaw turns left',
          duo: run.duo,
          caseId: run.caseDef.id,
          seed: opts.current.hideSeed ? null : run.seed,
          status: run.status,
          t: r(run.t),
          objective: run.objective(),
          player: { x: r(pl.x), z: r(pl.z), yaw: r(pl.yaw), pitch: r(pl.pitch), stance: pl.stance, speed: r(pl.speed), hp: Math.round(pl.hp), catches: pl.catches, hidden: pl.hidden, roomId: pl.roomId, interacting: pl.interacting },
          hyde: { mode: h.mode, shownMode: threat.shown, x: r(h.x), z: r(h.z), suspicion: r(h.suspicion), canSeePlayer: h.canSeePlayer, distance: r(Math.hypot(h.x - pl.x, h.z - pl.z)) },
          // test hook (like `hyde` above): Crackstone's truth for scripted checks; the HUD itself only uses the R4 slice
          crackstone: crack ? {
            mode: crack.rt.mode, shownKey: crackHold.shown, x: r(crack.rt.x), z: r(crack.rt.z), suspicion: r(crack.rt.suspicion), canSeePlayer: crack.rt.canSeePlayer,
            distance: r(Math.hypot(crack.rt.x - pl.x, crack.rt.z - pl.z)), active: crack.active(), visible: crack.visible(),
            scan: crack.rt.scan, curse: crack.rt.curse, scanExposure: crack.scanExposure(), curseExposure: crack.curseExposure(),
          } : null,
          egg: { ...run.egg, x: r(run.egg.x), z: r(run.egg.z) },
          cluesFound: run.cluesFound,
          power: run.powerStatus(),
          move: run.moveStatus(),
          interactable: run.interactable(),
          boardAllowed: run.boardAllowed?.() ?? run.hyde.mode !== 'CHASE',
          noise: r(noise.value),
          noiseRadiusM: run.noiseRadiusM?.() ?? null,
          thing: shownCard?.text ?? null,
          captions: captions.items.map((c) => c.text),
          toast: toast?.t.headline ?? null,
          input: { ...input.counts, crouching: input.crouching, ctrlCrouch: ctrlCrouchEnabled() },
          autopilot: bot !== null,
          risk: (() => {
            const cr = analytics.currentRisk();
            return cr && { p: cr.p, band: cr.band, label: cr.label, source: cr.source };
          })(),
          advice: lastAdvice && { text: lastAdvice.text, why: lastAdvice.reason, action: lastAdvice.action },
          adviceGiven: analytics.adviceRecords.length,
          pendingUpload: (() => {
            const b = analytics.pendingBatch();
            return b ? { events: b.events.length, forecasts: b.forecasts.length, recommendations: b.recommendations.length } : null;
          })(),
          hintCooldownS: ladder.cooldownLeftS(realT),
          ending: ending?.outcome ?? null,
          result: run.result(),
          logLength: run.log.length,
          scene: scene.getDebugState?.(run) ?? null,
          // ---- public HUD state (overhaul): what the visitor can see — never the hidden layout
          hud: {
            objectiveText: objectiveText(run),
            compassHeading: Math.round(headingDeg(pl.yaw)),
            compassMarkers: feed?.markers.map((m) => ({ kind: m.kind, lantern: m.lantern, name: m.name ?? null, pct: m.pct ?? null })) ?? [],
            areaName: feed?.areaName ?? null,
            // final HUD (UX_FINAL): threat chips, odds rows, lens, tally, cabinet, Weems, death phase - public state only
            final: final.debug(),
            thing: {
              card: shownCard && { kind: shownCard.kind, head: shownCard.head, text: shownCard.text, why: shownCard.why ?? null },
              log: stack.log?.item.text ?? null,
              recent: stack.history.slice(-8),
            },
            clueCard: clueCard && { title: clueCard.v.title, short: clueCard.v.short, meaning: clueCard.v.meaning },
            examineToast: examine && { kind: examine.v.kind, head: examine.v.head, text: examine.v.text, odds: examine.v.odds },
            hint: { level: ladder.level, idleS: r(ladder.idleS), showing: hintShow && realT < hintShow.until ? hintShow.level : 0 },
            investigation: {
              checkedClueSites: inv.checkedClueSites.length, knownClueSites: Object.keys(inv.knownClueSites).length, checkedEggSites: inv.checkedEggSites.length,
              eggSeen: inv.eggSeenAt ? world?.eggSites.find((e) => e.id === inv.eggSeenAt)?.label ?? inv.eggSeenAt : null,
              traces: inv.traces.length, examined: inv.examined.length, passageOpen: inv.passageOpen,
            },
            hydeEmerged: emerged,
            emergesInS: inv.hydeEmergesInS,
            hydeVisible,
            interactable: run.interactable()?.kind ?? null,
            shimmer: r(shimmer),
            liveAnalytics: hasLive,
            crack: crack ? {
              key: crackHold.shown,
              marker: feed?.map.crack?.marker?.kind ?? null,
              banner: tele.banner && { kind: tele.banner.kind, head: tele.banner.head, text: tele.banner.text, exposure: tele.banner.exposure },
              cursedLeftS: tele.cursedLeftS,
              edge: lastEdge && { enemy: lastEdge.enemy, icon: lastEdge.icon, x: r(lastEdge.at.x), y: r(lastEdge.at.y) },
              screen: (scene as { getCrackstoneScreen?: () => unknown }).getCrackstoneScreen?.() ?? null,
              areaName: crack.area.name,
              announced: crackAnnouncedAt !== null,
              chases: crackChases, escapes: crackEscapes,
            } : null,
          },
        };
      };

      return () => {
        cancelAnimationFrame(raf);
        scene.dispose();
        audio.calm();
        audio.setShimmer(0, 0);
        runRef.current = null;
        inputRef.current = null;
        sceneRef.current = null;
        api.current = null;
        analyticsRef.current = null;
        debugRef.current = null;
        advanceRef.current = null;
        setHud(null);
      };
    }
  }, [container]);

  return {
    phase,
    missing,
    error,
    hud,
    run: () => runRef.current,
    input: () => inputRef.current,
    endTutorial: () => {
      const run = runRef.current;
      if (run?.status === 'tutorial') run.endTutorial();
    },
    accuse: async (accusation) => {
      const run = runRef.current;
      if (!run || run.status !== 'accusing' || accusingRef.current) return false;
      // One shot: a second click while the answer key loads does nothing.
      accusingRef.current = true;
      const solution = await loadCaseSolution(run.caseDef.id);
      if (runRef.current !== run || run.status !== 'accusing') return false;
      const events = run.accuse(accusation, solution);
      const out = analyticsRef.current?.frame(run as unknown as MysteryRun, events);
      api.current?.handle(events, out?.advice ?? null);
      return true;
    },
    tryOpenBoard: () => {
      const run = runRef.current;
      if (!run) return false;
      const allowed = run.boardAllowed?.() ?? run.hyde.mode !== 'CHASE';
      if (!allowed) api.current?.boardLocked();
      return allowed;
    },
    setAutopilot: async (profile) => {
      const run = runRef.current;
      if (!run || !api.current) return false;
      if (!profile) {
        api.current.autopilot(null);
        return true;
      }
      const { Bot } = await import('../../mystery/bot.ts');
      // The live run IS a MysteryRun instance (loaded via integration.ts); the Bot reads only public state.
      const bot = new Bot(run as unknown as ConstructorParameters<typeof Bot>[0], { profile, accuse: 'none', maxTimeS: 900 }, run.seed);
      api.current?.autopilot(bot as unknown as BotLike);
      return true;
    },
    analytics: () => analyticsRef.current,
    nav: () => api.current?.nav() ?? null,
    mapState: () => api.current?.mapState() ?? null,
    liveAnalytics: () => api.current?.live() ?? null,
    askWeems: () => {
      const a = api.current;
      if (a) a.final.askWeems(a.now());
    },
    skipDeath: (input) => {
      const a = api.current;
      return a ? a.final.skipDeath(a.now(), input) : false;
    },
    deathContinue: () => api.current?.final.deathContinue(),
    dying: () => !!api.current?.final.dying,
    weemsHints: () => api.current?.final.hintsGiven() ?? [],
    accuseWeems: typeof (runRef.current as { requestHint?: unknown } | null)?.requestHint === 'function'
      ? () => {
        const run = runRef.current as (MysteryRunLike & { requestHint?: () => StampedEvent[] }) | null;
        if (!run || run.status !== 'accusing' || typeof run.requestHint !== 'function') return;
        const events = run.requestHint();
        const out = analyticsRef.current?.frame(run as unknown as MysteryRun, events);
        api.current?.handle(events, out?.advice ?? null);
        api.current?.final.onEvents(events, api.current.now(), null, (out as { weems?: { text: string; target?: { x: number; z: number; label: string } | null } | null } | undefined)?.weems ?? null);
      }
      : undefined,
    debug: () => debugRef.current?.() ?? (phase === 'missing' ? { missing, integration: integrationStatus() } : null),
    advance: (ms) => advanceRef.current?.(ms),
  };
}

