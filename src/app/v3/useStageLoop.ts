// Owns one StageOneRun + ActionScene + InputController per attempt and drives them from a single
// requestAnimationFrame loop. Turns run state + events into a throttled HUD snapshot (every frame during a rescue),
// audio cues, toasts, one-shot hints and Wednesday's advice. Exposes debug/advance hooks for tests.
import { useEffect, useRef, useState } from 'react';
import type { CharacterId, PokemonId } from '../../game/index.ts';
import { statMultipliers } from '../../action/characterStats.ts';
import { ROWING } from '../../action/config.ts';
import { InputController } from '../../action/input.ts';
import { StageOneRun } from '../../action/run.ts';
import type { ActionEvent, HydePhase, InputSnapshot, RescueOutcome } from '../../action/types.ts';
import { ActionScene } from '../../three/action/ActionScene.ts';
import { isWebGLAvailable } from '../../three/index.ts';
import { announce } from '../announce.tsx';
import { audio } from '../audio.ts';
import { getSettings } from '../settings.ts';
import { DangerTracker, type DangerLevel } from './danger.ts';
import type { StageResult } from './flow.ts';
import type { StageRunLike } from './runTypes.ts';
import { WednesdayAdvisor, type WednesdayId } from './wednesday.ts';

const HUD_INTERVAL_MS = 66;
const MAX_KICKS = 8;
const TOAST_S = 1.8;
const HINT_S = 3;
const END_DELAY_S = { finished: 1.6, dnf: 2.2 } as const;
/** Stamina trend window and thresholds (u/s of stamina). Rowing ≈ 2.5 taps/s is sustainable (ROWING regen vs stroke cost). */
const STAMINA_WINDOW_S = 1.5;
const DRAIN_RATE = -0.6; // draining: losing stamina faster than it recovers
const DRAIN_FAST_RATE = -2.2; // over-pacing (≈ 4 taps/s): fast tapping now costs more than it gains
const OVERPACE_CADENCE = 3.6; // taps/s that counts as "fast tapping" for the one-shot hint
export const OVERPACE_HINT = 'Steady strokes — mashing drains stamina.';
const IDLE: InputSnapshot = { forward: false, left: false, right: false, brake: false, interact: false, ability: false, strokes: 0, holdRow: false };

export type StaminaTrend = 'recovering' | 'steady' | 'draining' | 'draining_fast';
export type ToastTone = 'success' | 'lantern' | 'danger' | 'info';
export interface HudToast { id: number; tone: ToastTone; icon: 'shieldCheck' | 'shield' | 'claw' | 'alert'; headline: string; sub: string | null }
export interface HudMessage { kind: 'hint' | 'wednesday'; text: string; key: string }

export interface HudRescue {
  abilityAvailable: boolean;
  windowS: number;
  remainingS: number;
  cleanWindowS: number; // 0 when a clean escape is no longer possible this run
  kicks: number;
  lastChance: boolean;
  qPressed: boolean;
}

export interface HudAbility {
  ready: boolean;
  rescueReady: boolean; // ≥ 75 % of the cooldown elapsed (rescue counts as ready)
  cooldownLeftS: number;
  cooldownS: number;
  chargesLeft: number | null;
  charges: number | null;
  activeLeftS: number;
  durationS: number;
  deniedSeq: number; // increments on every denial (drives the shake)
  deniedReason: 'cooldown' | 'no_charges' | 'not_applicable' | null;
  readySeq: number; // increments when the ability becomes ready again
}

/** Tutorial counters (cumulative; the tutorial overlay compares against a baseline per step). */
export interface PracticeSignals {
  strokes: number;
  holdRowS: number;
  leftS: number;
  rightS: number;
  headingDeltaDeg: number;
  glideS: number;
  brakeSlowS: number; // seconds braking at < 3 u/s
  abilityUsed: number;
  qPresses: number;
  spacePresses: number;
}

export interface HudV3 {
  t: number;
  status: StageRunLike['status'];
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  /** Stamina over the last 1.5 s: recovering, steady, draining (faster than it recovers) or draining fast (over-pacing). */
  staminaTrend: StaminaTrend;
  speed: number;
  maxSpeed: number;
  cadence: number;
  progress: number;
  distanceLeft: number;
  holdToRow: boolean;
  catches: number;
  hyde: { phase: HydePhase; gap: number; threat: number; active: boolean; level: DangerLevel; surge: boolean };
  ability: HudAbility;
  rescue: HudRescue | null;
  toast: HudToast | null;
  message: HudMessage | null;
  cinematic: { remainingS: number } | null;
  bumpSeq: number;
  ending: 'finished' | 'dnf' | null;
  practice: PracticeSignals;
}

export interface StageLoopOptions {
  characterId: CharacterId;
  pokemonId: PokemonId;
  practice: boolean; // tutorial: a throwaway run whose clock and ability uses don't count
  runKey: number;
  paused: boolean;
  holdToRow: boolean;
  onEnded: (result: StageResult) => void;
  onPauseKey: () => void;
  onHoldToRow: (on: boolean) => void;
}

export interface StageLoopHandle {
  hud: HudV3 | null;
  webglFailed: boolean;
  /** Current run (for canPause etc.). */
  run: () => StageRunLike | null;
  debug: () => object | null;
  advance: (ms: number) => void;
}

function resultOf(run: StageRunLike, outcome: 'finished' | 'dnf'): StageResult {
  const s = run.stats;
  return {
    outcome, timeS: s.activeTimeS, hp: run.boat.hp, maxHp: run.boat.maxHp, catches: run.catches, collisions: s.collisions,
    abilitiesUsed: s.abilitiesUsed, closeCalls: s.hydeCloseCalls, rescues: s.rescues, cleanEscapes: s.cleanEscapes,
    strokes: s.strokes, missedStrokes: s.missedStrokes, maxSpeed: s.maxSpeed, distance: s.distance, progress: run.progress,
  };
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function useStageLoop(container: HTMLElement | null, o: StageLoopOptions): StageLoopHandle {
  const [hud, setHud] = useState<HudV3 | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const opts = useRef(o);
  opts.current = o;
  const runRef = useRef<StageRunLike | null>(null);
  const debugRef = useRef<(() => object) | null>(null);
  const advanceRef = useRef<((ms: number) => void) | null>(null);

  useEffect(() => {
    if (!container) return;
    if (!isWebGLAvailable()) {
      setWebglFailed(true);
      return;
    }
    const { characterId, pokemonId, practice } = opts.current;
    const run = new StageOneRun({ characterId, pokemonId });
    const view: StageRunLike = run;
    runRef.current = view;
    const settings = getSettings();
    const scene = new ActionScene(container, run.course, { characterId, pokemonId }, { reducedMotion: settings.reducedMotion, lowGraphics: settings.lowGraphics });
    const input = new InputController({
      onPause: () => opts.current.onPauseKey(),
      onToggleHoldRow: () => {
        opts.current.onHoldToRow(input.holdToRow);
        announce(input.holdToRow ? 'Hold-to-row on: hold SPACE to row.' : 'Hold-to-row off: tap SPACE to row.');
      },
    });
    input.holdToRow = opts.current.holdToRow;
    input.attach(window);

    const maxSpeed = ROWING.maxSpeed * statMultipliers(run.characterDef.stats).topSpeed;
    const danger = new DangerTracker();
    const advisor = new WednesdayAdvisor();
    const strokeTimes: number[] = [];
    const missedTimes: number[] = [];
    const collisionTimes: number[] = [];
    const practiceSig: PracticeSignals = { strokes: 0, holdRowS: 0, leftS: 0, rightS: 0, headingDeltaDeg: 0, glideS: 0, brakeSlowS: 0, abilityUsed: 0, qPresses: 0, spacePresses: 0 };
    const startHeading = run.boat.heading;
    const hintsShown = new Set<string>();
    let realT = 0; // seconds of real (unpaused) loop time
    let lastStrokeReal = 0;
    const staminaHist: [number, number][] = []; // [realT, stamina]
    let surgeUntil = -Infinity;
    let toast: HudToast | null = null;
    let toastUntil = -Infinity;
    let lastToastAt = -Infinity;
    let toastSeq = 0;
    let hint: { text: string; key: string; until: number } | null = null;
    let wednesday: { id: WednesdayId; text: string } | null = null;
    let rescue: { abilityAvailable: boolean; kicks: number; qPressed: boolean; cleanS: number } | null = null;
    let deniedSeq = 0;
    let deniedReason: HudAbility['deniedReason'] = null;
    let readySeq = 0;
    let prevReady = true;
    let bumpSeq = 0;
    let ending: { outcome: 'finished' | 'dnf'; at: number } | null = null;
    let reported = false;
    let prevFog = 0;
    let lastHudAt = 0;
    let enterEdge = false;

    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' && !e.repeat) enterEdge = true;
    };
    window.addEventListener('keydown', onKey);

    const showHint = (key: string, text: string) => {
      if (practice || hintsShown.has(key)) return;
      hintsShown.add(key);
      hint = { text, key, until: realT + HINT_S };
    };
    const cadenceNow = () => strokeTimes.filter((x) => realT - x < 2).length / 2;
    /** Stamina slope over the last STAMINA_WINDOW_S of real time (sampled with every HUD snapshot). */
    const staminaTrend = (): StaminaTrend => {
      const b = run.boat;
      staminaHist.push([realT, b.stamina]);
      while (staminaHist.length > 2 && realT - staminaHist[0]![0] > STAMINA_WINDOW_S) staminaHist.shift();
      const [t0, s0] = staminaHist[0]!;
      const span = realT - t0;
      if (span < 0.5) return 'steady';
      const rate = (b.stamina - s0) / span;
      if (rate <= DRAIN_FAST_RATE) return 'draining_fast';
      if (rate <= DRAIN_RATE) return 'draining';
      return rate > 0.5 && b.stamina < b.maxStamina - 0.5 ? 'recovering' : 'steady';
    };
    const showToast = (t: Omit<HudToast, 'id'>) => {
      toast = { ...t, id: ++toastSeq };
      toastUntil = realT + TOAST_S;
      lastToastAt = realT;
    };

    const handle = (events: ActionEvent[]) => {
      const resolvedCatch = events.some((e) => e.type === 'rescue_end' || e.type === 'ability_used');
      for (const e of events) {
        switch (e.type) {
          case 'stroke':
            strokeTimes.push(realT);
            if (strokeTimes.length > 30) strokeTimes.shift();
            lastStrokeReal = realT;
            practiceSig.strokes++;
            audio.play('splash');
            break;
          case 'missed_stroke':
            missedTimes.push(realT);
            if (missedTimes.length > 10) missedTimes.shift();
            showHint('missed', 'Too fast! Steady taps row harder.');
            break;
          case 'collision':
            collisionTimes.push(realT);
            if (collisionTimes.length > 10) collisionTimes.shift();
            bumpSeq++;
            audio.play(e.kind === 'branch' || e.kind === 'buoy' ? 'scrape' : e.damage > 0 ? 'thud' : 'bump');
            break;
          case 'low_stamina':
            // Low because of fast tapping → teach the rhythm (D-23); otherwise teach the glide.
            if (cadenceNow() >= OVERPACE_CADENCE) showHint('overpace', OVERPACE_HINT);
            else showHint('stamina', 'Hold W to glide and catch your breath.');
            break;
          case 'hyde_phase':
            if (e.phase === 'emerging') {
              audio.play('growl');
              showHint('emerge', 'The Hyde! Watch the meter. Don’t slow down.');
            } else if (e.phase === 'stunned' && !resolvedCatch && run.abilityDef.passive?.kind === 'shield_blocks_hyde_knockback_u' && run.effects().shield) {
              audio.play('clean');
              showToast({ tone: 'success', icon: 'shieldCheck', headline: 'BLOCKED! No catch.', sub: run.abilityDef.rescue.text });
            } else if (e.phase === 'surging') {
              surgeUntil = Math.max(surgeUntil, realT + 4);
            }
            break;
          case 'hyde_warning':
            if (e.level === 1) {
              surgeUntil = realT + 2.5;
              audio.play('horn');
              advisor.fire('surge', realT);
            } else {
              audio.play('growl');
              announce('The Hyde is close.', 'polite');
            }
            break;
          case 'hyde_catch':
            audio.play('rescue');
            break;
          case 'rescue_start': {
            rescue = {
              abilityAvailable: e.abilityAvailable, kicks: 0, qPressed: false,
              cleanS: run.stats.cleanEscapes === 0 && e.abilityAvailable ? run.cleanEscapeWindowS : 0,
            };
            hint = null;
            announce(e.abilityAvailable ? `The Hyde has caught you! Press Q — use ${run.abilityDef.abilityName}!` : 'The Hyde has caught you! Mash SPACE!', 'alert');
            break;
          }
          case 'rescue_end': {
            const kicks = rescue?.kicks ?? 0;
            const kicked = kicks > 0 ? `Kicked: −${Math.min(MAX_KICKS, kicks) * 6} % damage` : null;
            rescue = null;
            toastFor(e.outcome, e.damage, kicked);
            break;
          }
          case 'ability_used':
            practiceSig.abilityUsed++;
            audio.play('whoosh');
            break;
          case 'ability_denied':
            deniedSeq++;
            deniedReason = e.reason;
            audio.play('denied');
            break;
          case 'ability_end':
            break;
          case 'dnf':
            if (!ending) ending = { outcome: 'dnf', at: realT };
            showToast({ tone: 'danger', icon: 'claw', headline: 'Dragged into the fog.', sub: 'Second catch: the run is over.' });
            audio.play('toll');
            break;
          case 'finish':
            if (!ending) ending = { outcome: 'finished', at: realT };
            audio.play('fanfare');
            break;
          default:
            break;
        }
      }
    };

    const toastFor = (outcome: RescueOutcome, damage: number, kicked: string | null) => {
      // The run's own record of what the rescue did ('' when Q was not used) — never a guess from the Pokémon data.
      const text = run.lastRescue?.text || null;
      if (outcome === 'clean_escape') {
        audio.play('clean');
        showToast({ tone: 'success', icon: 'shieldCheck', headline: 'CLEAN ESCAPE! Catch not counted.', sub: text });
      } else if (outcome === 'rescued') {
        showToast({ tone: 'lantern', icon: 'shield', headline: `RESCUED! Catch counted — ${run.catches} of 2`, sub: [text, kicked].filter(Boolean).join(' · ') });
        if (run.catches === 1) advisor.fire('first_catch', realT);
      } else if (outcome === 'caught' && run.status !== 'dnf') {
        showToast({ tone: 'danger', icon: 'claw', headline: `CAUGHT! Catch ${run.catches} of 2`, sub: kicked ?? (damage > 0 ? `−${Math.round(damage)} HP` : null) });
        if (run.catches === 1) advisor.fire('first_catch', realT);
      }
    };

    const conditions = (): WednesdayId[] => {
      const out: WednesdayId[] = [];
      const b = run.boat;
      const hunting = run.hyde.phase !== 'dormant' && run.hyde.phase !== 'emerging';
      const st = run.abilityStatus();
      if (hunting && run.hyde.distance < 12) out.push(st.ready ? 'close_ready' : 'close_not_ready');
      if (b.stamina / b.maxStamina < 0.15 && realT - lastStrokeReal < 1) out.push('stamina');
      if (missedTimes.filter((x) => realT - x < 2).length >= 3) out.push('mashing');
      if (collisionTimes.filter((x) => realT - x < 6).length >= 2) out.push('collisions');
      if (b.speed > 7) {
        const fx = -Math.sin(b.heading);
        const fz = -Math.cos(b.heading);
        const ahead = run.course.obstacles.some((ob) => {
          const dx = ob.x - b.x;
          const dz = ob.z - b.z;
          const along = dx * fx + dz * fz;
          if (along < 4 || along > 26) return false;
          return Math.abs(dx * fz - dz * fx) < ob.radius + ob.halfLength + 1.5;
        });
        if (ahead) out.push('rocks');
      }
      const fog = run.fogAt();
      if (fog > 0.15 && prevFog <= 0.15) out.push('fog');
      prevFog = fog;
      const push = run.course.currents.reduce((acc, c) => {
        const d = Math.hypot(b.x - c.x, b.z - c.z);
        return d < c.radius ? acc + Math.hypot(c.pushX, c.pushZ) * (1 - d / c.radius) : acc;
      }, 0);
      if (push > 1.5) out.push('current');
      if (hunting && run.hyde.distance >= 55) out.push('smug');
      if (realT - lastStrokeReal > 5 && b.speed < 2 && realT > 5) out.push('idle');
      return out;
    };

    const snapshot = (): HudV3 => {
      const b = run.boat;
      const st = run.abilityStatus();
      const def = run.abilityDef;
      const hunting = run.hyde.phase !== 'dormant';
      const surge = run.hyde.phase === 'surging' || run.surgeTelegraphLeftS() > 0 || realT < surgeUntil;
      const level = danger.update(run.hyde.distance, surge, hunting && run.hyde.phase !== 'emerging', realT);
      const cooldownS = def.cooldownS;
      const rescueReady = !st.ready && (st.chargesLeft === null || st.chargesLeft > 0) && st.cooldownLeftS <= cooldownS * 0.25;
      if (st.ready && !prevReady) {
        readySeq++;
        audio.play('ready');
      }
      prevReady = st.ready;
      const cin = run.cinematic();
      if (hint && realT > hint.until) hint = null;
      if (toast && realT > toastUntil) toast = null;
      const suppressed = practice || run.status === 'rescue' || cin !== null || hint !== null || ending !== null;
      wednesday = advisor.update({ now: realT, suppressed, lastToastAt, active: suppressed ? [] : conditions() });
      if (!practice && st.ready && hunting && run.hyde.distance < 30) showHint('q_ready', `Press Q: ${def.abilityName}!`);
      const trend = staminaTrend();
      const cadence = cadenceNow();
      // Over-pacing cue (D-23: rhythm beats mashing): the first time fast tapping has visibly cost stamina.
      if (trend === 'draining_fast' && cadence >= OVERPACE_CADENCE && b.stamina / b.maxStamina < 0.6 && run.status === 'playing') {
        showHint('overpace', OVERPACE_HINT);
      }
      // Message slot is suppressed during the rescue and the cinematic (UX §1/§3); a hint raised during the cinematic
      // keeps its full 3 s for afterwards.
      if (cin && hint) hint.until = Math.max(hint.until, realT + cin.remainingS + HINT_S);
      const message: HudMessage | null = run.status === 'rescue' || cin !== null
        ? null
        : hint ? { kind: 'hint', text: hint.text, key: hint.key } : wednesday ? { kind: 'wednesday', text: wednesday.text, key: wednesday.id } : null;
      return {
        t: run.t, status: run.status, hp: b.hp, maxHp: b.maxHp, stamina: b.stamina, maxStamina: b.maxStamina, staminaTrend: trend, speed: b.speed, maxSpeed,
        cadence, progress: run.progress, distanceLeft: run.distanceToDock(),
        holdToRow: input.holdToRow, catches: run.catches,
        hyde: { phase: run.hyde.phase, gap: run.hyde.distance, threat: run.hyde.threat, active: hunting, level, surge },
        ability: {
          ready: st.ready, rescueReady, cooldownLeftS: st.cooldownLeftS, cooldownS, chargesLeft: st.chargesLeft, charges: def.charges,
          activeLeftS: st.activeLeftS, durationS: def.durationS, deniedSeq, deniedReason, readySeq,
        },
        rescue: rescue && {
          abilityAvailable: rescue.abilityAvailable, windowS: run.rescue.windowS, remainingS: run.rescueLeftS(),
          cleanWindowS: rescue.cleanS, kicks: Math.min(MAX_KICKS, rescue.kicks), lastChance: run.catches >= 1, qPressed: rescue.qPressed,
        },
        toast, message, cinematic: cin && { remainingS: cin.remainingS }, bumpSeq, ending: ending?.outcome ?? null,
        practice: { ...practiceSig },
      };
    };

    /** One simulation step. `draw = false` (test fast-forward) skips the render and returns the events for a later one. */
    const frame = (dt: number, snap: InputSnapshot, draw = true): ActionEvent[] => {
      const paused = opts.current.paused;
      if (paused) {
        audio.calm();
        if (draw) scene.render(run, [], 0);
        enterEdge = false;
        return [];
      }
      realT += dt;
      const live = ending === null;
      const input2 = live ? snap : IDLE;
      if (live && run.cinematic() && (snap.strokes > 0 || enterEdge)) run.skipCinematic();
      enterEdge = false;
      if (run.status === 'rescue' && rescue) {
        rescue.kicks += snap.strokes;
        if (snap.ability) rescue.qPressed = true;
      }
      // Tutorial signals.
      if (snap.ability) practiceSig.qPresses++;
      practiceSig.spacePresses += snap.strokes;
      if (snap.holdRow) practiceSig.holdRowS += dt;
      if (snap.left) practiceSig.leftS += dt;
      if (snap.right) practiceSig.rightS += dt;
      if (snap.forward) practiceSig.glideS += dt;
      if (snap.brake && run.boat.speed < 3) practiceSig.brakeSlowS += dt;
      practiceSig.headingDeltaDeg = Math.max(practiceSig.headingDeltaDeg, Math.abs(angleDiff(run.boat.heading, startHeading)) * (180 / Math.PI));

      const events = run.update(dt, input2);
      handle(events);
      if (draw) scene.render(run, events, dt);
      if (!practice && ending === null) {
        const lvl = danger.level;
        audio.setThreat(run.hyde.phase === 'dormant' ? 0 : run.hyde.threat, lvl);
      } else audio.calm();
      if (ending && !reported && realT - ending.at >= END_DELAY_S[ending.outcome]) {
        reported = true;
        audio.calm();
        if (!practice) opts.current.onEnded(resultOf(run, ending.outcome));
      }
      return events;
    };

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      frame(dt, input.consume());
      if (run.status === 'rescue' || now - lastHudAt > HUD_INTERVAL_MS) {
        lastHudAt = now;
        setHud(snapshot());
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    advanceRef.current = (ms: number) => {
      // Deterministic fixed steps; one render at the end with every event (keeps SwiftShader test runs fast).
      const steps = Math.max(1, Math.round(ms / (1000 / 60)));
      const all: ActionEvent[] = [];
      for (let i = 0; i < steps; i++) all.push(...frame(1 / 60, input.consume(), false));
      scene.render(run, all, 1 / 60);
      setHud(snapshot());
    };
    debugRef.current = () => {
      const st = run.abilityStatus();
      const r = (v: number) => Math.round(v * 100) / 100;
      return {
        practice,
        coords: 'x right, z toward the start; boat forward is -z at heading 0',
        crew: {
          characterId, pokemonId, trait: run.characterDef.trait, stats: run.characterDef.stats,
          multipliers: statMultipliers(run.characterDef.stats), maxSpeed: r(maxSpeed), maxHp: run.boat.maxHp, maxStamina: Math.round(run.boat.maxStamina),
        },
        course: { id: run.course.id, finish: run.course.finish, start: run.course.start, land: run.course.land?.length ?? 0 },
        status: run.status,
        t: r(run.t),
        catches: run.catches,
        boat: { x: r(run.boat.x), z: r(run.boat.z), heading: r(run.boat.heading), speed: r(run.boat.speed), hp: Math.round(run.boat.hp), stamina: Math.round(run.boat.stamina) },
        progress: r(run.progress),
        distanceToDock: r(run.distanceToDock()),
        holdToRow: input.holdToRow,
        hyde: { phase: run.hyde.phase, distance: r(run.hyde.distance), threat: r(run.hyde.threat), visibility: r(run.hyde.visibility), dangerLevel: danger.level },
        ability: { name: run.abilityDef.abilityName, specialty: run.abilityDef.specialty, ...st, cooldownLeftS: r(st.cooldownLeftS), activeLeftS: r(st.activeLeftS), lastActivatedAt: r(run.ability.lastActivatedAt) },
        effects: run.effects(),
        rescue: run.rescue.active ? { ...run.rescue } : null,
        cinematic: run.cinematic(),
        stats: run.stats,
        message: hint?.text ?? wednesday?.text ?? null,
        toast: toast?.headline ?? null,
        ending: ending?.outcome ?? null,
        scene: scene.getDebugState(run),
      };
    };

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      input.detach();
      scene.dispose();
      audio.calm();
      runRef.current = null;
      debugRef.current = null;
      advanceRef.current = null;
      setHud(null);
    };
  }, [container, o.characterId, o.pokemonId, o.practice, o.runKey]);

  return {
    hud,
    webglFailed,
    run: () => runRef.current,
    debug: () => debugRef.current?.() ?? null,
    advance: (ms) => advanceRef.current?.(ms),
  };
}
