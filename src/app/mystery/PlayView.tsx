// The island: canvas + rAF loop (useMysteryLoop) + HUD + Thing tutorial + Tab evidence board + pause + deposit moment
// + accusation. Lazy-loaded. UX_MYSTERY rulings:
//  1. C crouches; Ctrl only while the kiosk keyboard lock is active (input.ts / kiosk.ts) — never prevented otherwise.
//  2. Losing pointer lock ALWAYS pauses (pointerlockchange). Esc while locked just releases the lock (→ pause); Esc
//     without a lock toggles pause (keyboard-only play). Resume is a click that re-requests the lock; on rejection the
//     pause stays up with "Click again to resume".
//  3. Tab opens the read-only board (sim + clock paused) except during CHASE ("Board locked while you're chased"); in
//     accusation mode the board is a focus trap that nothing closes.
//  4. Death sequence (UX_FINAL §3): from the `dnf` the sim input is cut, Esc no longer pauses — Enter / Esc / click skip
//     the cutscene (only keydowns that START after t0), the GAME-OVER card's "See results" (Enter) or its 12 s countdown
//     continues to the results. Losing pointer lock never pauses during it.
// Browser defaults (Tab focus, Space/arrow scroll, F fullscreen hotkey…) are suppressed for game keys; M reaches mute.
import { useEffect, useRef, useState, type Dispatch, type MutableRefObject } from 'react';
import type { Accusation, CaseDef, Duo, RoomId, SuspectId } from '../../mystery/types.ts';
import { Button } from '../../ui/components/Button.tsx';
import type { DuoCardView } from '../../ui/mystery/duoView.ts';
import type { PublicMapState } from '../../ui/mystery/map/mapData.ts';
import { EvidenceBoard } from '../../ui/mystery/EvidenceBoard.tsx';
import { MysteryHud } from '../../ui/mystery/MysteryHud.tsx';
import { MysteryPause } from '../../ui/mystery/MysteryPause.tsx';
import { MysteryTutorial, type TutorialSignals, type TutorialStepId } from '../../ui/mystery/MysteryTutorial.tsx';
import { DeathOverlay } from '../../ui/mystery/hud/DeathOverlay.tsx';
import { AnalyticsLegend } from '../../ui/mystery/hud/AnalyticsLegend.tsx';
import { ThingSigil } from '../../ui/components/ThingSigil.tsx';
import { markScreenMounted } from '../keyboard.ts';
import { useSettings } from '../settings.ts';
import type { MysteryAction, MysteryOverlay, MysteryScreen } from './flow.ts';
import { GAME_CODES } from './input.ts';
import { ctrlCrouchEnabled } from './kiosk.ts';
import { appendRecord, browserStorage } from './records.ts';
import { useMysteryLoop, type AutopilotProfile } from './useMysteryLoop.ts';

export interface PlayDebugHandle {
  debug: () => object | null;
  advance: (ms: number) => void;
  extra: () => object;
}

declare global {
  interface Window {
    /** TEST-ONLY: drive the live run with the game-developer's seeded Bot (src/mystery/bot.ts). */
    mysteryAutopilot?: (profile: AutopilotProfile | null) => Promise<boolean>;
    /** TEST-ONLY (`&testhooks=1`, local demo): the live run object, for staged HUD screenshots (output/enemies/hud). */
    mysteryTestRun?: () => unknown;
  }
}

export interface PlayViewProps {
  duo: Duo;
  seed: string;
  /** The session's assigned case (public definition). */
  caseDef: CaseDef;
  /** LIVE station: never expose the seed in debug output. */
  hideSeed?: boolean;
  /** LOCAL DEMO murderer (never set on a LIVE station). */
  culprit?: SuspectId | null;
  card: DuoCardView;
  screen: MysteryScreen;
  overlay: MysteryOverlay;
  tutorial: boolean;
  sessionId: string;
  stationId: string;
  nickname: string;
  offered: Duo[];
  dispatch: Dispatch<MysteryAction>;
  onQuit: () => void;
  debugRef: MutableRefObject<PlayDebugHandle | null>;
}

/** A browser Esc that released the lock may also arrive as a keydown: ignore it for this long after a lock loss. */
const LOCK_ESC_GRACE_MS = 350;
const DEPOSIT_MOMENT_MS = 1500;
/** The 4-chip analytics legend shows once for 4 s at the end of onboarding (UX_FINAL §1b). */
const LEGEND_MS = 4000;
const TIER_TEXT = { common: 'Common', rare: 'Rare', legendary: 'Legendary' } as const;
const ROOM_FALLBACK: Record<RoomId, string> = {
  pier: 'Pier', path: 'Path', research_room: 'Research Room', crypt: 'Crypt Entrance', egg_chamber: 'Egg Chamber',
  shortcut: 'Shortcut', courtyard: 'Courtyard', tower: 'Iago Tower',
};

export default function PlayView(p: PlayViewProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [locked, setLocked] = useState(false);
  const [tutStep, setTutStep] = useState<TutorialStepId | null>(null);
  const [depositShown, setDepositShown] = useState(false);
  const [legendShown, setLegendShown] = useState(false);
  const legendDone = useRef(false);
  const settings = useSettings();
  const playing = p.screen === 'tutorial' || p.screen === 'play';
  const inputEnabled = playing && p.overlay === 'none';
  const paused = p.overlay !== 'none';

  const loop = useMysteryLoop(container, {
    duo: p.duo,
    seed: p.seed,
    caseDef: p.caseDef,
    culprit: p.culprit ?? null,
    hideSeed: p.hideSeed,
    tutorial: p.tutorial,
    paused,
    inputEnabled,
    characterName: p.card.characterShort,
    pokemonName: p.card.pokemonName,
    characterArt: p.card.characterArt,
    pokemonArt: p.card.pokemonArt,
    sessionId: p.sessionId,
    stationId: p.stationId,
    nickname: p.nickname,
    offered: p.offered,
    onDeposited: () => p.dispatch({ type: 'deposited' }),
    onEnded: (run, analytics) => {
      const result = run.result();
      if (!result) {
        console.error('MysteryRun ended without a result()');
        return;
      }
      // LOCAL DEMO dashboard record (finished or DNF; a run left via "Leave the case" never gets here).
      appendRecord(browserStorage(), { record: analytics.sessionRecord(), nickname: p.nickname || 'Guest', stationId: p.stationId, endedAt: new Date().toISOString(), rulesVersion: result.rulesVersion });
      p.dispatch({ type: 'ended', result, analytics: analytics.report() });
    },
  });

  // Latest values for the window listeners (registered once).
  const live = useRef({ inputEnabled, overlay: p.overlay, screen: p.screen, lostLockAt: -Infinity, releasing: false, dying: false });
  live.current.inputEnabled = inputEnabled;
  live.current.overlay = p.overlay;
  live.current.screen = p.screen;
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const containerRef = useRef<HTMLDivElement | null>(null);
  containerRef.current = container;

  useEffect(() => markScreenMounted(), []);

  // Tutorial → play: start the Hyde.
  useEffect(() => {
    if (p.screen === 'play') loop.endTutorial();
  }, [p.screen, loop.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Onboarding ends (tutorial → play, or a tutorial-free start): the analytics legend for 4 s, once per run.
  const playStarted = loop.phase === 'ready' && p.screen === 'play' && loop.hud?.status === 'playing';
  useEffect(() => {
    if (!playStarted || legendDone.current) return;
    legendDone.current = true;
    setLegendShown(true);
    const t = setTimeout(() => setLegendShown(false), LEGEND_MS);
    return () => clearTimeout(t);
  }, [playStarted]);

  // Death sequence: release the pointer (the card needs it) without pausing; drop held keys.
  const dying = !!loop.hud?.death;
  live.current.dying = dying;
  useEffect(() => {
    if (!dying) return;
    loopRef.current.input()?.clear();
    if (document.pointerLockElement) {
      live.current.releasing = true;
      document.exitPointerLock();
    }
  }, [dying]);

  // Deposit moment (1.5 s) before the accusation board opens.
  useEffect(() => {
    if (p.screen !== 'accusing') return;
    setDepositShown(true);
    const t = setTimeout(() => setDepositShown(false), DEPOSIT_MOMENT_MS);
    return () => clearTimeout(t);
  }, [p.screen]);

  // Leaving the game layer (board, pause, accusation) releases the pointer and drops held keys.
  useEffect(() => {
    if (inputEnabled) return;
    loopRef.current.input()?.clear();
    if (document.pointerLockElement) {
      live.current.releasing = true;
      document.exitPointerLock();
    }
  }, [inputEnabled]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = live.current;
      const onIsland = s.screen === 'tutorial' || s.screen === 'play' || s.screen === 'accusing';
      if (!onIsland || s.screen === 'accusing') return; // accusation: the board's focus trap owns the keyboard
      if (s.dying || loopRef.current.dying()) {
        // ruling 4: Enter / Esc skip the cutscene (only keydowns that start after t0); on the card Enter = See results
        if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'NumpadEnter') {
          e.preventDefault();
          e.stopPropagation();
          const phase = loopRef.current.hud?.death?.phase;
          if (phase === 'card') {
            if (e.code !== 'Escape' && !e.repeat) loopRef.current.deathContinue();
          } else loopRef.current.skipDeath({ startedAt: e.timeStamp, repeat: e.repeat });
          return;
        }
        if (GAME_CODES.has(e.code)) e.preventDefault();
        return;
      }
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (performance.now() - s.lostLockAt < LOCK_ESC_GRACE_MS) return;
        if (document.pointerLockElement) {
          document.exitPointerLock(); // → pointerlockchange → pause (ruling 2)
          return;
        }
        p.dispatch({ type: 'togglePause' }); // board → close; none ↔ pause (keyboard-only play)
        return;
      }
      if (s.overlay === 'pause') return; // normal focus navigation in the dialog
      if (e.code === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        if (s.overlay === 'board') p.dispatch({ type: 'closeOverlay' });
        else if (loopRef.current.tryOpenBoard()) p.dispatch({ type: 'toggleBoard' });
        return;
      }
      if (s.overlay === 'board') {
        if (GAME_CODES.has(e.code)) e.preventDefault();
        return;
      }
      if (!s.inputEnabled || e.code === 'KeyM') return; // KeyM: global mute (App shell)
      const input = loopRef.current.input();
      if (input ? input.keyDown(e.code, e.repeat) : GAME_CODES.has(e.code)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      loopRef.current.input()?.keyUp(e.code);
      if (live.current.inputEnabled && GAME_CODES.has(e.code)) e.preventDefault();
    };
    const onBlur = () => loopRef.current.input()?.clear();
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement && live.current.inputEnabled) loopRef.current.input()?.mouseMove(e.movementX, e.movementY);
    };
    const onLockChange = () => {
      const isLocked = document.pointerLockElement !== null;
      setLocked(isLocked);
      const s = live.current;
      if (isLocked) {
        if (s.overlay === 'pause') p.dispatch({ type: 'closeOverlay' }); // resume = successful re-lock
        return;
      }
      if (s.releasing) {
        s.releasing = false;
        return;
      }
      s.lostLockAt = performance.now();
      if (s.dying) return; // ruling 4: never pause during the death sequence
      if (s.overlay === 'none' && (s.screen === 'tutorial' || s.screen === 'play')) p.dispatch({ type: 'pause' });
    };
    const onContext = (e: MouseEvent) => {
      if (live.current.inputEnabled) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    window.addEventListener('blur', onBlur);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('contextmenu', onContext);
    document.addEventListener('pointerlockchange', onLockChange);
    window.mysteryAutopilot = (profile) => loopRef.current.setAutopilot(profile);
    const testHooks = !p.hideSeed && new URLSearchParams(window.location.search).get('testhooks') === '1';
    if (testHooks) window.mysteryTestRun = () => loopRef.current.run();
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('contextmenu', onContext);
      document.removeEventListener('pointerlockchange', onLockChange);
      delete window.mysteryAutopilot;
      delete window.mysteryTestRun;
      if (document.pointerLockElement) document.exitPointerLock();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Request pointer lock on the island; resolves true once locked. */
  const requestLock = async (): Promise<boolean> => {
    const el = containerRef.current;
    if (!el) return false;
    if (document.pointerLockElement === el) return true;
    try {
      const r = el.requestPointerLock() as unknown;
      if (r instanceof Promise) await r;
      else {
        await new Promise<void>((resolve, reject) => {
          const ok = () => {
            cleanup();
            resolve();
          };
          const bad = () => {
            cleanup();
            reject(new Error('pointerlockerror'));
          };
          const cleanup = () => {
            document.removeEventListener('pointerlockchange', ok);
            document.removeEventListener('pointerlockerror', bad);
          };
          document.addEventListener('pointerlockchange', ok);
          document.addEventListener('pointerlockerror', bad);
        });
      }
      return document.pointerLockElement === el;
    } catch {
      return false;
    }
  };

  const run = loop.run();
  const caseDef = run?.caseDef ?? p.caseDef;
  const roomName = (id: RoomId) => run?.map.rooms.find((x) => x.id === id)?.name ?? p.caseDef.roomNames[id] ?? ROOM_FALLBACK[id];

  // Tutorial signals from real state.
  const startPos = useRef<{ x: number; z: number } | null>(null);
  const boardMapRef = useRef<{ open: boolean; state: PublicMapState | null }>({ open: false, state: null });
  const practiceMax = useRef(0);
  if (run && !startPos.current) startPos.current = { x: run.player.x, z: run.player.z };
  const prompt = loop.hud?.prompt;
  if (prompt?.kind === 'practice') practiceMax.current = Math.max(practiceMax.current, prompt.progress);
  const counts = loop.input()?.counts;
  const signals: TutorialSignals = {
    movedM: run && startPos.current ? Math.hypot(run.player.x - startPos.current.x, run.player.z - startPos.current.z) : 0,
    crouchS: counts?.crouchS ?? 0,
    practiceProgress: practiceMax.current,
    power: counts?.power ?? 0,
    move: counts?.move ?? 0,
  };
  const endTutorial = () => p.dispatch({ type: 'tutorialDone' });

  p.debugRef.current = {
    debug: loop.debug,
    advance: loop.advance,
    extra: () => ({ phase: loop.phase, missing: loop.missing, error: loop.error, pointerLocked: locked, paused, inputEnabled, tutorialStep: tutStep, depositMoment: depositShown, legendShown, dying }),
  };
  useEffect(() => () => {
    p.debugRef.current = null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const egg = run?.egg;
  // The Tab map is a snapshot: the sim + clock are paused while the overlay is open (taken once per opening).
  const boardOpen = loop.phase === 'ready' && ((p.overlay === 'board' && playing) || p.screen === 'accusing');
  if (boardOpen && !boardMapRef.current.open) boardMapRef.current = { open: true, state: loop.mapState() };
  else if (!boardOpen && boardMapRef.current.open) boardMapRef.current = { open: false, state: null };
  const boardMap = boardMapRef.current.state;
  return (
    <main className="mys-play" data-testid={p.screen === 'tutorial' ? 'screen-tutorial' : p.screen === 'accusing' ? 'screen-accusing' : 'screen-play'} data-paused={paused || undefined}>
      <div
        className="mys-canvas"
        ref={setContainer}
        onClick={() => {
          if (live.current.inputEnabled && !live.current.dying) void requestLock();
        }}
        role="img"
        aria-label={`Raven Island ruins. ${p.card.characterShort} and ${p.card.pokemonName}.`}
      />

      {loop.phase === 'loading' && <div className="boot" role="status">Lighting the lanterns…</div>}
      {loop.phase === 'missing' && <Placeholder missing={loop.missing} card={p.card} onBack={p.onQuit} />}
      {(loop.phase === 'webgl_failed' || loop.phase === 'error') && (
        <section className="action-panel mys-message" role="alert">
          <h2 className="action-panel__title">{loop.phase === 'webgl_failed' ? '3D is switched off on this computer' : 'The island failed to load'}</h2>
          <p className="action-panel__lead">{loop.phase === 'webgl_failed' ? 'Enable hardware acceleration in Chrome/Edge settings, then reload. The island needs WebGL.' : loop.error}</p>
          <Button variant="primary" onClick={p.onQuit}>Back to home</Button>
        </section>
      )}

      {loop.phase === 'ready' && loop.hud && p.screen !== 'accusing' && (
        <div className="mhud-wrap">
          <MysteryHud
            hud={loop.hud}
            tutorial={p.screen === 'tutorial'}
            pointerLocked={locked}
            showPredictions={settings.showRisk}
            nav={loop.nav}
            noiseFocus={tutStep === 'silent'}
            onAskWeems={() => loop.askWeems()}
          />
          {legendShown && !loop.hud.death && <AnalyticsLegend variant="onboarding" />}
        </div>
      )}

      {loop.phase === 'ready' && loop.hud?.death && (
        <DeathOverlay
          d={loop.hud.death}
          onSkip={() => loop.skipDeath({ startedAt: performance.now(), click: true })}
          onContinue={() => loop.deathContinue()}
        />
      )}

      {loop.phase === 'ready' && p.screen === 'tutorial' && (
        <MysteryTutorial
          signals={signals}
          vars={{ character: p.card.characterShort, pokemon: p.card.pokemonName, power: p.card.power.name, move: p.card.move.name, clues: caseDef.clues.length }}
          card={p.card}
          paused={paused}
          ctrlCrouch={ctrlCrouchEnabled()}
          onStep={setTutStep}
          onDone={endTutorial}
        />
      )}

      {loop.phase === 'ready' && p.screen === 'accusing' && depositShown && egg && run && (
        <div className="deposit-moment" role="status" data-testid="deposit-moment">
          <ThingSigil size={64} pose="thumbsUp" />
          <p className="deposit-moment__title display">Egg secured — {TIER_TEXT[egg.tier]} · {egg.points} pts</p>
          <p className="text-2">Clock stopped at {run.t.toFixed(1)} s</p>
        </div>
      )}

      {loop.phase === 'ready' && ((p.overlay === 'board' && playing) || (p.screen === 'accusing' && !depositShown)) && (
        <div className="mys-overlay mys-overlay--board">
          <EvidenceBoard
            caseDef={caseDef}
            cluesFound={run?.cluesFound ?? []}
            roomName={roomName}
            mode={p.screen === 'accusing' ? 'accuse' : 'review'}
            mapState={boardMap}
            showPredictions={settings.showRisk}
            weemsHints={loop.weemsHints()}
            onAskWeems={p.screen === 'accusing' ? loop.accuseWeems : undefined}
            onClose={() => p.dispatch({ type: 'closeOverlay' })}
            onAccuse={(a: Accusation) => void loop.accuse(a)}
          />
        </div>
      )}

      {p.overlay === 'pause' && (
        <div className="mys-overlay">
          <MysteryPause
            tutorial={p.screen === 'tutorial'}
            powerName={p.card.power.name}
            moveName={p.card.move.name}
            onResume={async () => {
              const ok = await requestLock();
              if (ok) p.dispatch({ type: 'closeOverlay' });
              return ok;
            }}
            onSkipTutorial={() => {
              p.dispatch({ type: 'closeOverlay' });
              endTutorial();
            }}
            onLeave={p.onQuit}
          />
        </div>
      )}
    </main>
  );
}

/** Honest stand-in if the sim / renderer module fails to load (nothing is simulated here). */
function Placeholder({ missing, card, onBack }: { missing: string[]; card: DuoCardView; onBack: () => void }) {
  return (
    <section className="mys-placeholder" role="status" data-testid="play-placeholder">
      <ThingSigil size={96} />
      <p className="caps">Island not available</p>
      <h2 className="display mys-placeholder__title">{card.duoName}</h2>
      <p className="text-2">The playable island could not be loaded. Nothing is simulated here.</p>
      <ul className="mys-placeholder__list">{missing.map((m) => <li key={m}><code>{m}</code></li>)}</ul>
      <Button variant="primary" onClick={onBack} data-testid="btn-placeholder-home">Back to home</Button>
    </section>
  );
}
