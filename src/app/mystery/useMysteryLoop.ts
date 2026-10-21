// Owns one MysteryRun + MysteryScene + input controller per attempt and drives them from a single
// requestAnimationFrame loop: run.update(dt, input) then scene.render(run, events, dt). Pause / board / accusation stop
// the sim clock (update is not called). Turns run state + events into a throttled HUD model, audio cues, directional
// sound captions, toasts and Thing subtitles. Exposes debug/advance hooks for tests, plus a TEST-ONLY autopilot that
// feeds the game-developer's seeded Bot (src/mystery/bot.ts) through the same update() path a player uses.
import { useContext, useEffect, useRef, useState } from 'react';
import { createMysteryAnalytics, type Advice, type MysteryAnalytics } from '../../mystery/analytics/index.ts';
import type { MysteryRun } from '../../mystery/run.ts';
import type { Duo, StampedEvent, SuspectId } from '../../mystery/types.ts';
import { announce } from '../announce.tsx';
import { audio } from '../audio.ts';
import { getSettings, useSettings } from '../settings.ts';
import {
  buildHud, CaptionLog, captionFor, clueTitle, CLUE_ICON, directionOf, NoiseMeter, RiskHold, ThingDirector, ThreatHold,
  type AbilityMeta, type MysteryHudModel, type ThingLineState, type Toast,
} from './hudModel.ts';
import { IDLE_INPUT, MysteryInputController, type MysteryFrameInput } from './input.ts';
import { integrationStatus, loadRunCtor, loadSceneCtor, nightshadeDef, partnerDef } from './integration.ts';
import { LiveRunContext } from './liveContext.ts';
import { ctrlCrouchEnabled } from './kiosk.ts';
import { browserStorage, writeLive, type LivePhase } from './records.ts';
import type { MysteryRunLike, MysterySceneLike } from './runTypes.ts';
import { thing as script } from './thingLines.ts';

const HUD_INTERVAL_MS = 66;
const END_DELAY_S = { finished: 1.4, dnf: 2.4 } as const;
const HINT_COOLDOWN_S = 10;
const BOARD_LOCK_TOAST_S = 1.2;

export type LoopPhase = 'loading' | 'missing' | 'webgl_failed' | 'error' | 'ready';
export type AutopilotProfile = 'stealthy' | 'careless';

export interface MysteryLoopOptions {
  duo: Duo;
  seed: string;
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
  /** null = leave the case unsolved. */
  accuse: (s: SuspectId | null) => boolean;
  /** Board may open now (blocked during CHASE); shows the 1.2 s "Board locked" toast when not. */
  tryOpenBoard: () => boolean;
  setAutopilot: (p: AutopilotProfile | null) => Promise<boolean>;
  analytics: () => MysteryAnalytics | null;
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
  const api = useRef<{
    handle: (events: StampedEvent[], advice: Advice | null) => void;
    boardLocked: () => void;
    autopilot: (bot: BotLike | null) => void;
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
        const run = new Run({ duo: opts.current.duo, seed: opts.current.seed, tutorial: opts.current.tutorial });
        const s = getSettings();
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
      const s = getSettings();
      const input = new MysteryInputController({ sensitivity: s.lookSensitivity, invertY: s.invertY, crouchToggle: s.crouchToggle }, ctrlCrouchEnabled);
      inputRef.current = input;

      const n = nightshadeDef(run.duo.characterId);
      const p = partnerDef(run.duo.pokemonId);
      const power: AbilityMeta = { def: n.power, name: n.power.name, art: opts.current.characterArt, cooldownS: n.power.cooldownS, denied: null };
      const move: AbilityMeta = { def: p.move, name: p.move.name, art: opts.current.pokemonArt, cooldownS: p.move.cooldownS, denied: null };
      const abilityName = (key: 'F' | 'Q') => (key === 'F' ? power.name : move.name);
      // Phase 4: the game-wide analytics session (identical for every duo). LOCAL DEMO: batches stay in the collector
      // (no network, no "unsynced" noise). LIVE station: liveRun.ts uploads pendingBatch() → mystery-append-events.
      const analytics = createMysteryAnalytics(run as unknown as MysteryRun, {
        sessionId: opts.current.sessionId, stationId: opts.current.stationId, offered: opts.current.offered,
      });
      analyticsRef.current = analytics;
      liveRef.current?.runStarted(run, analytics);
      const riskHold = new RiskHold();
      let lastAdvice: Advice | null = null;
      let nextLiveAt = 0;

      const noise = new NoiseMeter();
      const captions = new CaptionLog();
      const thing = new ThingDirector();
      const threat = new ThreatHold();
      let realT = 0;
      let lastStatus = run.status;
      let ending: { outcome: 'finished' | 'dnf'; at: number } | null = null;
      let reported = false;
      let prevPowerReady = true;
      let prevMoveReady = true;
      let lastHudAt = 0;
      let eggLowSaid = false;
      let pendingCount: number | null = null;
      let threatK = 0;
      let hintK = 0;
      let hintObjective: string | null = null;
      let lastHintAt = -Infinity;
      let deniedSeq = 0;
      let toastSeq = 0;
      let toast: { t: Toast; until: number } | null = null;
      let evidenceToast: { t: Toast; until: number } | null = null;
      let catchFlashSeq = 0;
      let bot: BotLike | null = null;
      let botEvery = 1;
      let botStep = 0;
      let botHeld: MysteryFrameInput = IDLE_INPUT;
      let lastPose: ThingLineState['pose'] | null = null;

      const showToast = (t: Omit<Toast, 'id'>, s: number) => {
        toast = { t: { ...t, id: ++toastSeq }, until: realT + s };
      };
      const bearing = () => run.hydeBearing?.() ?? null;

      thing.say(script.duoIntro({ character: opts.current.characterName, pokemon: opts.current.pokemonName }), 0, { priority: 2 });

      const sayAdvice = (a: Advice, priority: number) => {
        lastAdvice = a;
        thing.say({ id: 'advice_' + a.t, text: a.text, pose: a.target ? 'point' : 'tap' }, realT, { priority, key: 'advice_' + a.t + '_' + a.action, why: a.reason });
      };

      const handle = (events: StampedEvent[], advice: Advice | null) => {
        // Context advice (Hyde alert / egg drop, analytics-paced): shown unless something more urgent is speaking.
        if (advice && !events.some((e) => e.type === 'hint_requested')) sayAdvice(advice, 2);
        for (const e of events) {
          const b = bearing();
          const cap = captionFor(e, abilityName, b ? directionOf(b.angle) : null, b?.distanceM ?? Math.hypot(run.hyde.x - run.player.x, run.hyde.z - run.player.z));
          if (cap) captions.push(cap, realT); // captions are always on (UX §7), muted or not
          switch (e.type) {
            case 'hyde_mode':
              if (e.to === 'CHASE') {
                audio.play('growl');
                announce('The Hyde is chasing you!', 'alert');
                thing.say(script.threat('CHASE', threatK++), realT, { priority: 3 });
              } else if (e.to === 'INVESTIGATE_SOUND') {
                audio.play('sting');
                announce('The Hyde heard a noise.');
                thing.say(script.threat('INVESTIGATE_SOUND', threatK++), realT, { priority: 2 });
              } else if (e.to === 'SEARCH') {
                announce('The Hyde is searching.');
                thing.say(script.threat('SEARCH', threatK++), realT, { priority: 2 });
              } else if (e.to === 'COOLDOWN' && e.from === 'CHASE') {
                thing.say(script.threat('COOLDOWN', threatK++), realT, { priority: 1 });
              }
              break;
            case 'catch':
              audio.play(e.blocked ? 'clean' : 'rescue');
              catchFlashSeq++;
              if (e.blocked) {
                showToast({ tone: 'success', icon: 'shieldCheck', headline: `BLOCKED — no damage. Catch still counts: ${e.catchNumber} of 2`, sub: null }, 2);
                thing.say(script.catchBlocked(), realT, { priority: 3 });
              } else if (e.catchNumber === 1) {
                showToast({ tone: 'danger', icon: 'claw', headline: `CAUGHT — 1 of 2 · −${Math.round(e.hpLost)} HP`, sub: 'Released at a safe spot. Next catch ends the run.' }, 2);
                thing.say(script.catchFirst(), realT, { priority: 3 });
              }
              announce(e.blocked ? `Grab blocked. The catch still counts: ${e.catchNumber} of 2.` : `Caught! ${e.catchNumber} of 2.`, 'alert');
              break;
            case 'clue_search_start':
              thing.say(script.searchStart(), realT, { priority: 1, once: true });
              break;
            case 'clue_found': {
              audio.play('chime');
              const title = clueTitle(run, e.clueId);
              evidenceToast = { t: { id: ++toastSeq, tone: 'lantern', icon: CLUE_ICON[e.clueId], headline: title, sub: 'Tab to read' }, until: realT + 3.5 };
              thing.say(script.clueFound(e.clueId), realT, { priority: 3 });
              pendingCount = e.cluesFound;
              announce(`Clue found: ${title}. ${e.cluesFound} of 3.`);
              break;
            }
            case 'egg_pickup':
              audio.play('clean');
              thing.say(script.eggPickup(), realT, { priority: 2, once: true });
              break;
            case 'egg_drop':
              audio.play('thud');
              if (e.reason === 'manual') thing.say(script.eggSetDown(), realT, { priority: 2 });
              else {
                thing.say(script.eggForcedDrop(), realT, { priority: 3 });
                announce('You dropped the egg.', 'alert');
              }
              break;
            case 'egg_damage':
              if (e.security < 40 && !eggLowSaid) {
                eggLowSaid = true;
                thing.say(script.eggLow(), realT, { priority: 2 });
              }
              break;
            case 'egg_delivered':
              audio.play('fanfare');
              break;
            case 'ability_used':
              audio.play('whoosh');
              break;
            case 'ability_denied': {
              audio.play('denied');
              const meta = e.key === 'F' ? power : move;
              const st = e.key === 'F' ? run.powerStatus() : run.moveStatus();
              meta.denied = { seq: ++deniedSeq, at: realT, text: e.reason === 'no_target' ? 'No Hyde in range' : `Not ready · ${Math.ceil(st.cooldownLeftS)} s` };
              break;
            }
            case 'hint_requested': {
              // V: the prescriptive service's feasible advice (text + Why); only when it has nothing to add, the
              // designer's generic hint lines (never invented text).
              if (advice) sayAdvice(advice, 4);
              else {
                const ob = run.objective();
                if (hintObjective !== ob) hintK = 0;
                hintObjective = ob;
                thing.say(script.hint(ob, hintK++), realT, { priority: 4, key: 'hint_' + realT });
              }
              break;
            }
            case 'dnf':
              if (!ending) ending = { outcome: 'dnf', at: realT };
              catchFlashSeq++;
              audio.play('toll');
              showToast({ tone: 'danger', icon: 'claw', headline: 'Dragged into the fog.', sub: null }, 3);
              thing.say(script.dnf(e.reason), realT, { priority: 5 });
              break;
            case 'finish':
              if (!ending) ending = { outcome: 'finished', at: realT };
              break;
            default:
              break;
          }
        }
      };

      const watchStatus = () => {
        if (run.status === lastStatus) return;
        const prev = lastStatus;
        lastStatus = run.status;
        if (prev === 'tutorial' && run.status === 'playing') thing.say(script.objective(run.objective()), realT, { priority: 2, once: true, key: 'case_open' });
        if (run.status === 'accusing') {
          const n = run.cluesFound.length;
          thing.say(n < 3 ? script.towerFewClues(n) : script.towerDeposit(), realT, { priority: 4 });
          liveRef.current?.flushNow('deposit');
          opts.current.onDeposited();
        }
        if ((run.status === 'finished' || run.status === 'dnf') && !ending) ending = { outcome: run.status, at: realT };
      };

      const hudSnapshot = (): MysteryHudModel => {
        if (pendingCount !== null && thing.current === null) {
          thing.say(script.clueCount(pendingCount), realT, { priority: 2 });
          pendingCount = null;
        }
        const tl = thing.update(realT);
        // The in-world Thing mirrors the caption's gesture (null = its own idle).
        const pose = run.status === 'tutorial' ? null : tl?.pose ?? null;
        if (pose !== lastPose) {
          scene.setThingPose?.(pose);
          lastPose = pose;
        }
        if (toast && realT > toast.until) toast = null;
        if (evidenceToast && realT > evidenceToast.until) evidenceToast = null;
        const shownMode = threat.update(run.hyde.mode, realT);
        const r = analytics.currentRisk();
        const risk = riskHold.update(r && run.status === 'playing' ? { p: r.p, band: r.band, source: r.source, label: r.label, detectedNow: r.detectedNow } : null, realT);
        const model = buildHud(run, {
          now: realT, noise: noise.value, shownMode, power, move,
          // Thing never talks over the tutorial panel (UX §4 advisory rule).
          thing: run.status === 'tutorial' ? null : tl,
          captions: captions.prune(realT), toast: toast?.t ?? null, evidenceToast: evidenceToast?.t ?? null, catchFlashSeq,
          hintCooldownS: Math.max(0, Math.ceil(HINT_COOLDOWN_S - (realT - lastHintAt))),
          noiseRadiusM: run.noiseRadiusM?.() ?? 0, bearing: bearing(), hydeScreen: scene.getHydeScreen?.() ?? null,
          risk: run.status === 'playing' ? risk : null,
        });
        if (model.power.ready && !prevPowerReady) audio.play('ready');
        if (model.move.ready && !prevMoveReady) audio.play('ready');
        prevPowerReady = model.power.ready;
        prevMoveReady = model.move.ready;
        if (model.prompt?.kind === 'tower') thing.say(script.towerApproach(), realT, { priority: 1, once: true });
        if (model.prompt?.kind === 'egg' && run.egg.state === 'resting') thing.say(script.eggSeen(), realT, { priority: 1, once: true });
        return model;
      };

      const live = () => run.status === 'tutorial' || run.status === 'playing';

      const nextInput = (dt: number): MysteryFrameInput => {
        const fromKeys = input.consume(dt);
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
        if (!opts.current.inputEnabled) return IDLE_INPUT;
        let frameInput = fromKeys;
        if (frameInput.hint) {
          // V: one hint per 10 s (UX §4); a press during the cooldown does nothing.
          if (realT - lastHintAt < HINT_COOLDOWN_S || run.status !== 'playing') frameInput = { ...frameInput, hint: false };
          else lastHintAt = realT;
        }
        return frameInput;
      };

      /** One frame. `draw = false` (test fast-forward) skips the render. */
      const frame = (dt: number, draw = true): StampedEvent[] => {
        if (opts.current.paused) {
          input.consume(dt); // drop edges pressed while paused
          audio.calm();
          if (draw) scene.render(run, [], 0);
          return [];
        }
        realT += dt;
        const frameInput = nextInput(dt);
        const events = live() ? run.update(dt, frameInput) : [];
        const out = analytics.frame(run as unknown as MysteryRun, events);
        noise.update(events, dt);
        handle(events, out.advice);
        watchStatus();
        if (realT >= nextLiveAt) {
          nextLiveAt = realT + 1;
          const status = liveStatus();
          writeLive(browserStorage(), status);
          liveRef.current?.status(status);
        }
        if (draw) scene.render(run, events, dt);
        if (run.status === 'playing') {
          const h = run.hyde;
          audio.setThreat(h.suspicion, h.mode === 'CHASE' || h.grabbing ? 2 : h.mode === 'INVESTIGATE_SOUND' || h.mode === 'SEARCH' ? 1 : 0);
        } else audio.calm();
        if (ending && !reported && realT - ending.at >= END_DELAY_S[ending.outcome]) {
          reported = true;
          audio.calm();
          const status = liveStatus();
          writeLive(browserStorage(), status);
          liveRef.current?.status(status);
          liveRef.current?.runEnded(run, analytics); // flush the finish / dnf, then finalize in the background
          opts.current.onEnded(run, analytics);
        }
        return events;
      };

      const liveStatus = () => {
        const phase: LivePhase = run.status === 'tutorial' ? 'tutorial' : run.status === 'accusing' ? 'accusing' : run.status === 'dnf' ? 'dnf'
          : run.status === 'finished' ? 'results' : run.egg.state === 'carried' ? 'carrying' : 'investigating';
        const cr = analytics.currentRisk();
        return {
          stationId: opts.current.stationId, phase, nickname: opts.current.nickname, duo: run.duo, clues: run.cluesFound.length,
          egg: { state: run.egg.state, tier: run.egg.state === 'resting' ? null : run.egg.tier, security: Math.round(run.egg.security) },
          hp: Math.round(run.player.hp), catches: run.player.catches, hydeMode: run.status === 'playing' ? run.hyde.mode : null,
          risk: cr ? { p: Math.round(cr.p * 100) / 100, label: cr.label } : null,
          advice: lastAdvice ? { text: lastAdvice.text, followed: analytics.adviceRecords.at(-1)?.followed ?? null } : null,
          activeTimeS: Math.round(run.t * 10) / 10, updatedAt: Date.now(),
        };
      };

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
        if (now - lastHudAt > HUD_INTERVAL_MS) {
          lastHudAt = now;
          setHud(hudSnapshot());
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      setHud(hudSnapshot());

      advanceRef.current = (ms: number) => {
        const steps = Math.max(1, Math.round(ms / (1000 / 60)));
        const all: StampedEvent[] = [];
        for (let i = 0; i < steps; i++) all.push(...frame(1 / 60, false));
        scene.render(run, all, 1 / 60);
        setHud(hudSnapshot());
      };

      debugRef.current = () => {
        const r = (v: number) => Math.round(v * 100) / 100;
        const pl = run.player;
        const h = run.hyde;
        return {
          coords: 'metres, XZ ground plane; yaw 0 faces -Z, positive yaw turns left',
          duo: run.duo,
          seed: run.seed,
          status: run.status,
          t: r(run.t),
          objective: run.objective(),
          player: { x: r(pl.x), z: r(pl.z), yaw: r(pl.yaw), pitch: r(pl.pitch), stance: pl.stance, speed: r(pl.speed), hp: Math.round(pl.hp), catches: pl.catches, hidden: pl.hidden, roomId: pl.roomId, interacting: pl.interacting },
          hyde: { mode: h.mode, shownMode: threat.shown, x: r(h.x), z: r(h.z), suspicion: r(h.suspicion), canSeePlayer: h.canSeePlayer, distance: r(Math.hypot(h.x - pl.x, h.z - pl.z)) },
          egg: { ...run.egg, x: r(run.egg.x), z: r(run.egg.z) },
          cluesFound: run.cluesFound,
          power: run.powerStatus(),
          move: run.moveStatus(),
          interactable: run.interactable(),
          boardAllowed: run.boardAllowed?.() ?? run.hyde.mode !== 'CHASE',
          noise: r(noise.value),
          noiseRadiusM: run.noiseRadiusM?.() ?? null,
          thing: thing.current?.text ?? null,
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
          hintCooldownS: Math.max(0, Math.ceil(HINT_COOLDOWN_S - (realT - lastHintAt))),
          ending: ending?.outcome ?? null,
          result: run.result(),
          logLength: run.log.length,
          scene: scene.getDebugState?.(run) ?? null,
        };
      };

      return () => {
        cancelAnimationFrame(raf);
        scene.dispose();
        audio.calm();
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
    accuse: (suspect) => {
      const run = runRef.current;
      if (!run || run.status !== 'accusing') return false;
      const events = run.accuse(suspect);
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
    debug: () => debugRef.current?.() ?? (phase === 'missing' ? { missing, integration: integrationStatus() } : null),
    advance: (ms) => advanceRef.current?.(ms),
  };
}
