// Stage 1 on the water: canvas + loop + HUD + tutorial (practice run) + countdown + pause. Lazy-loaded so three.js
// and the action renderer stay out of the menu bundle.
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { CharacterId, PokemonId } from '../../game/index.ts';
import { ActionHud } from '../../ui/action/ActionHud.tsx';
import { TutorialOverlay } from '../../ui/action/TutorialOverlay.tsx';
import { Button } from '../../ui/components/Button.tsx';
import { pokemonView } from '../../ui/v3/crewData.ts';
import { useModalPresence, markScreenMounted } from '../keyboard.ts';
import type { StageResult } from './flow.ts';
import { useStageLoop } from './useStageLoop.ts';
import '../../ui/styles/action.css';

const COUNTDOWN_S = 3;

export interface StageDebugHandle {
  debug: () => object | null;
  advance: (ms: number) => void;
  extra: () => object;
}

export interface StageViewProps {
  characterId: CharacterId;
  pokemonId: PokemonId;
  practice: boolean;
  attempt: number;
  holdToRow: boolean;
  onHoldToRow: (on: boolean) => void;
  onTutorialDone: () => void;
  onEnded: (r: StageResult) => void;
  onRestart: () => void;
  onMainMenu: () => void;
  debugRef: MutableRefObject<StageDebugHandle | null>;
}

export default function StageView(p: StageViewProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(p.practice ? null : COUNTDOWN_S);
  const [pauseDenied, setPauseDenied] = useState(false);
  const pv = pokemonView(p.pokemonId);
  const countingRef = useRef(countdown !== null);
  countingRef.current = countdown !== null;

  // Every attempt / mode switch starts with a fresh countdown.
  useEffect(() => {
    markScreenMounted();
    setPaused(false);
    setCountdown(p.practice ? null : COUNTDOWN_S);
  }, [p.attempt, p.practice]);

  useEffect(() => {
    if (countdown === null || paused) return;
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c <= 0 ? null : c - 1)), countdown === 0 ? 650 : 800);
    return () => clearTimeout(t);
  }, [countdown, paused]);

  const handleRef = useRef<ReturnType<typeof useStageLoop> | null>(null);
  const onPauseKey = useCallback(() => {
    if (countingRef.current) return;
    const run = handleRef.current?.run();
    setPaused((was) => {
      if (was) return false;
      if (run && !run.canPause()) {
        setPauseDenied(true);
        setTimeout(() => setPauseDenied(false), 1200);
        return false;
      }
      if (run && (run.status === 'finished' || run.status === 'dnf')) return false;
      return true;
    });
  }, []);

  const handle = useStageLoop(container, {
    characterId: p.characterId,
    pokemonId: p.pokemonId,
    practice: p.practice,
    runKey: p.attempt,
    paused: paused || countdown !== null,
    holdToRow: p.holdToRow,
    onEnded: p.onEnded,
    onPauseKey,
    onHoldToRow: p.onHoldToRow,
  });
  handleRef.current = handle;

  p.debugRef.current = {
    debug: handle.debug,
    advance: handle.advance,
    extra: () => ({ paused, countdown, pauseDenied, tutorial: p.practice }),
  };
  useEffect(() => () => {
    p.debugRef.current = null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hud = handle.hud;
  return (
    <main className="action-root" data-testid={p.practice ? 'screen-tutorial' : 'screen-stage'} data-paused={paused || undefined}>
      <div className="action-canvas" ref={setContainer} aria-label="Rowing across the haunted lake toward Raven Island" role="img" />
      {handle.webglFailed && (
        <section className="action-panel" role="alert">
          <h2 className="action-panel__title">3D is switched off on this computer</h2>
          <p className="action-panel__lead">Enable hardware acceleration in Chrome/Edge settings, then reload. The real-time race needs WebGL.</p>
          <Button variant="primary" onClick={p.onMainMenu}>Main menu</Button>
        </section>
      )}
      {hud && (
        <ActionHud
          hud={hud}
          pokemonId={p.pokemonId}
          pokemonName={pv.base.name}
          abilityName={pv.ability.abilityName}
          tutorial={p.practice}
          pauseDenied={pauseDenied}
        />
      )}
      {p.practice && !handle.webglFailed && (
        <TutorialOverlay
          hud={hud}
          pokemonName={pv.base.name}
          abilityName={pv.ability.abilityName}
          holdToRow={p.holdToRow}
          paused={paused}
          onHoldToRow={p.onHoldToRow}
          onDone={p.onTutorialDone}
        />
      )}
      {countdown !== null && !handle.webglFailed && (
        <div className="countdown" role="status" aria-live="assertive" data-testid="countdown">
          <p className="countdown__stage caps">Stage 1 · The Crossing</p>
          <p key={countdown} className="countdown__num">{countdown > 0 ? countdown : 'Row!'}</p>
        </div>
      )}
      {paused && (
        <PauseDialog
          practice={p.practice}
          onResume={() => setPaused(false)}
          onRestart={p.practice ? p.onTutorialDone : p.onRestart}
          onMainMenu={p.onMainMenu}
        />
      )}
    </main>
  );
}

function PauseDialog({ practice, onResume, onRestart, onMainMenu }: { practice: boolean; onResume: () => void; onRestart: () => void; onMainMenu: () => void }) {
  useModalPresence(true);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <section className="action-panel action-panel--small" role="dialog" aria-modal="true" aria-labelledby="pause-title" data-testid="dialog-pause">
      <h2 id="pause-title" className="action-panel__title">Paused</h2>
      <p className="action-panel__lead">The race clock is stopped.</p>
      <div className="action-actions action-actions--stack">
        <Button ref={first} variant="primary" kbd="Esc" onClick={onResume} data-testid="btn-resume">Resume</Button>
        <Button variant="secondary" onClick={onRestart} data-testid="btn-restart">{practice ? 'Skip tutorial' : 'Restart Stage 1'}</Button>
        <Button variant="ghost" onClick={onMainMenu} data-testid="btn-pause-menu">Main menu</Button>
      </div>
    </section>
  );
}
