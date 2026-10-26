// Player terminal: visitor flow screens over the shared 3D scene. All outcomes come from the backend.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CHARACTER_BY_ID, getPushOptions } from '../game/index.ts';
import type { Advice, LegResolution, RouteId } from '../game/index.ts';
import type { AppServices } from '../lib/backend.ts';
import { PRE_RACE_STEP } from './flow.ts';
import { useRaceScene, type RaceSceneLike } from './sceneHost.ts';
import { useSettings } from './settings.ts';
import { useTestHooks } from './testHooks.ts';
import { useBoardRank } from './useBoardRank.ts';
import { useRace, type RaceController } from './useRace.ts';
import { ConfirmDialog, Modal } from '../ui/components/Modal.tsx';
import { Button } from '../ui/components/Button.tsx';
import { HeaderTools } from '../ui/components/HeaderTools.tsx';
import { Icon } from '../ui/Icon.tsx';
import type { AdviceStatus } from '../ui/hud/AdvicePanel.tsx';
import { DecisionHud } from '../ui/hud/DecisionHud.tsx';
import { Cinematic } from '../ui/screens/Cinematic.tsx';
import { Confirm } from '../ui/screens/Confirm.tsx';
import { CaptainSelect, PokemonSelect } from '../ui/screens/CrewSelect.tsx';
import { EggReveal } from '../ui/screens/EggReveal.tsx';
import { FinalScreen } from '../ui/screens/FinalScreen.tsx';
import { LegResult } from '../ui/screens/LegResult.tsx';
import { Nickname } from '../ui/screens/Nickname.tsx';
import { Splash } from '../ui/screens/Splash.tsx';

const SLOW_SERVER_MS = 3000;
const DEFAULT_CREW = { characterId: 'wednesday', pokemonId: 'gengar' } as const;

interface TerminalAppProps {
  services: AppServices;
  stationName: string;
  stationKey: string;
}

export function TerminalApp({ services, stationName, stationKey }: TerminalAppProps) {
  const race = useRace(services, stationKey);
  const { flow, dispatch } = race;
  const settings = useSettings();
  const sceneRef = useRef<HTMLDivElement>(null);
  const sceneStatus = useRaceScene(sceneRef, { reducedMotion: settings.reducedMotion, lowGraphics: settings.lowGraphics });
  const scene = sceneStatus.kind === 'ready' ? sceneStatus.scene : null;
  const [confirmQuit, setConfirmQuit] = useState(false);
  const adviceRef = useRef<{ route: AdviceStatus | null; egg: Advice | null }>({ route: null, egg: null });
  const slow = useSlowFlag(flow.busy !== null && flow.busy !== 'restore');
  const view = flow.view;
  const rank = useBoardRank(services.dashboard, view?.state.sessionId ?? null, flow.screen === 'final' && view?.state.status === 'completed');

  useSceneSync(race, scene);

  const inRace = view?.state.status === 'in_progress' && ['decision', 'egg', 'result'].includes(flow.screen);
  const tools = (
    <HeaderTools mode={services.mode} connection={race.connection} onQuit={inRace ? () => setConfirmQuit(true) : undefined} />
  );

  const onRoutePreview = useCallback((route: RouteId | null) => scene?.setRoutePreview(route), [scene]);
  const onRouteAdvice = useCallback((s: AdviceStatus) => {
    adviceRef.current.route = s;
  }, []);
  const onEggAdvice = useCallback((a: Advice | null) => {
    adviceRef.current.egg = a;
  }, []);

  useTestHooks(
    () => textSnapshot(race, services.mode, adviceRef.current, scene ? scene.getDebugState() : { fallback2d: true, status: sceneStatus.kind }),
    (ms) => scene?.advanceTime(ms),
  );

  return (
    <>
      <div id="scene" ref={sceneRef} aria-hidden="true" />
      {!scene && <div className="scene-backdrop" aria-hidden="true" />}
      {renderScreen()}
      {sceneStatus.kind === 'unavailable' && flow.screen === 'splash' && (
        <div className="toast toast--warning toast--left" role="status" data-testid="webgl-fallback">
          <Icon name="alert" />
          {sceneStatus.reason} The race plays in 2D.
        </div>
      )}
      {slow && !flow.error && (
        <div className="toast toast--info toast--hud" role="status" data-testid="toast-slow">
          <Icon name="wifi" />
          Still reaching the server…
        </div>
      )}
      {flow.error && <ErrorDialog race={race} />}
      {confirmQuit && (
        <ConfirmDialog
          title="Quit this race?"
          description="Your run ends now and stays off the board (unranked)."
          confirmLabel="Quit race"
          cancelLabel="Keep racing"
          destructive
          onCancel={() => setConfirmQuit(false)}
          onConfirm={() => {
            setConfirmQuit(false);
            void race.quitRace();
          }}
          testId="dialog-quit"
        />
      )}
    </>
  );

  function renderScreen() {
    const { draft } = flow;
    switch (flow.screen) {
      case 'splash':
        return (
          <Splash
            stationName={stationName}
            mode={services.mode}
            tools={tools}
            notice={flow.notice}
            restoring={flow.busy === 'restore'}
            onStart={() => dispatch({ type: 'go', screen: 'nickname' })}
          />
        );
      case 'nickname':
        return (
          <Nickname
            initial={draft.nickname}
            tools={tools}
            onBack={() => dispatch({ type: 'go', screen: 'splash' })}
            onSubmit={(nickname) => {
              dispatch({ type: 'draft', patch: { nickname } });
              dispatch({ type: 'go', screen: 'captain' });
            }}
          />
        );
      case 'captain':
        return (
          <CaptainSelect
            selectedId={draft.characterId}
            tools={tools}
            onSelect={(characterId) => dispatch({ type: 'draft', patch: { characterId } })}
            onBack={() => dispatch({ type: 'go', screen: 'nickname' })}
            onContinue={() => dispatch({ type: 'go', screen: 'pokemon' })}
          />
        );
      case 'pokemon':
        return (
          <PokemonSelect
            characterId={draft.characterId ?? DEFAULT_CREW.characterId}
            selectedId={draft.pokemonId}
            tools={tools}
            onSelect={(pokemonId) => dispatch({ type: 'draft', patch: { pokemonId } })}
            onBack={() => dispatch({ type: 'go', screen: 'captain' })}
            onContinue={() => dispatch({ type: 'go', screen: 'confirm' })}
          />
        );
      case 'confirm':
        if (!draft.characterId || !draft.pokemonId) return null;
        return (
          <Confirm
            nickname={draft.nickname}
            characterId={draft.characterId}
            pokemonId={draft.pokemonId}
            mode={services.mode}
            tools={tools}
            busy={flow.busy === 'create'}
            onChangeCrew={() => dispatch({ type: 'go', screen: 'captain' })}
            onStart={() => void race.startRace()}
          />
        );
      case 'decision':
        if (!view?.leg) return null;
        return (
          <DecisionHud
            key={`${view.state.sessionId}-${view.state.legIndex}`}
            view={view}
            selection={flow.selection}
            busy={flow.busy === 'prepare'}
            tools={tools}
            onSelect={(patch) => dispatch({ type: 'select', ...patch })}
            onSail={race.setSail}
            onRoutePreview={onRoutePreview}
            onAdvice={onRouteAdvice}
          />
        );
      case 'egg':
        if (!view) return null;
        return (
          <EggReveal
            key={`${view.state.sessionId}-${view.state.revision}`}
            view={view}
            busy={flow.busy === 'resolve'}
            tools={tools}
            onDecide={race.decideEgg}
            onAdvice={onEggAdvice}
          />
        );
      case 'cinematic':
        if (!flow.resolution) return null;
        return (
          <Cinematic
            key={`${view?.state.sessionId}-${flow.resolution.legIndex}`}
            resolution={flow.resolution}
            scene={scene}
            reducedMotion={settings.reducedMotion}
            onDone={() => dispatch({ type: 'cinematicDone' })}
          />
        );
      case 'result':
        if (!flow.resolution || !view) return null;
        return (
          <LegResult
            key={`${view.state.sessionId}-${flow.resolution.legIndex}`}
            resolution={flow.resolution}
            raceTimeCs={view.state.totalSimulatedTimeCs}
            tools={tools}
            onNext={() => dispatch({ type: 'next' })}
          />
        );
      case 'final':
        if (!view) return null;
        return (
          <FinalScreen
            key={view.state.sessionId}
            view={view}
            notes={flow.notes}
            rank={rank}
            reducedMotion={settings.reducedMotion}
            tools={tools}
            onNextVisitor={() => void race.nextVisitor()}
          />
        );
      default:
        return null;
    }
  }
}

/** Keeps the 3D scene in step with the flow: crew, current leg, idle framing. */
function useSceneSync(race: RaceController, scene: RaceSceneLike | null) {
  const { flow } = race;
  const characterId = flow.view?.state.characterId ?? flow.draft.characterId ?? DEFAULT_CREW.characterId;
  const pokemonId = flow.view?.state.pokemonId ?? flow.draft.pokemonId ?? DEFAULT_CREW.pokemonId;
  useEffect(() => {
    scene?.setCrew(characterId, pokemonId);
  }, [scene, characterId, pokemonId]);

  const leg = flow.view?.leg;
  const gap = flow.view?.state.pursuitGapM;
  const onLegScreen = flow.screen === 'decision' || flow.screen === 'egg';
  useEffect(() => {
    if (scene && onLegScreen && leg && gap !== undefined) scene.setLeg(leg.legIndex, leg.weather, gap);
  }, [scene, onLegScreen, leg?.legIndex, leg?.weather, gap]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (flow.screen !== 'decision') scene?.setRoutePreview(flow.screen === 'egg' ? flow.view?.state.prepared?.route ?? null : null);
  }, [scene, flow.screen, flow.view?.state.prepared?.route]);
}

function useSlowFlag(pending: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!pending) return;
    const t = setTimeout(() => setSlow(true), SLOW_SERVER_MS);
    return () => clearTimeout(t);
  }, [pending]);
  return slow;
}

function ErrorDialog({ race }: { race: RaceController }) {
  const error = race.flow.error!;
  const network = error.code === 'NETWORK' || error.code === 'SERVER';
  return (
    <Modal
      title={network ? 'Can’t reach the race server' : 'That didn’t work'}
      description={network ? 'Your choice is saved. Retry sends it again, safely.' : error.message}
      onClose={() => race.dispatch({ type: 'clearError' })}
      testId="dialog-error"
    >
      <div className="modal__actions">
        {error.retry ? (
          <Button variant="primary" icon="reset" onClick={race.retry} data-testid="btn-retry">Retry</Button>
        ) : (
          <Button variant="primary" onClick={() => race.dispatch({ type: 'clearError' })} data-testid="btn-dismiss">Back to the race</Button>
        )}
        <Button variant="ghost" onClick={() => race.dispatch({ type: 'reset' })} data-testid="btn-error-restart">Back to start</Button>
      </div>
    </Modal>
  );
}

function textSnapshot(race: RaceController, backendMode: string, advice: { route: AdviceStatus | null; egg: Advice | null }, scene: unknown) {
  const { flow } = race;
  const state = flow.view?.state;
  const leg = flow.view?.leg;
  const r: LegResolution | null = flow.resolution;
  const actions: Record<string, string[]> = {
    splash: ['Enter=start'],
    nickname: ['type nickname', 'Enter=continue'],
    captain: ['Arrows=browse', 'Space=select', 'Enter=continue'],
    pokemon: ['Arrows=browse', 'Space=select', 'Enter=continue'],
    confirm: ['Enter=start race'],
    decision: ['S=safe', 'H=shortcut', '1/2/3=push', 'A=use advice', 'Enter=set sail'],
    egg: [leg?.visibleOffers[state?.prepared?.route ?? 'safe'] !== 'none' ? 'C=collect' : 'C=disabled (no egg)', 'K=skip'],
    cinematic: ['Space=skip (after 2 s)'],
    result: ['Enter=next'],
    final: ['Enter=next visitor (after 2 s)'],
  };
  return {
    mode: 'terminal',
    backend: backendMode,
    screen: flow.screen,
    step: PRE_RACE_STEP[flow.screen] ?? null,
    busy: flow.busy,
    error: flow.error?.code ?? null,
    notice: flow.notice,
    draft: flow.draft,
    crew: state ? { character: CHARACTER_BY_ID[state.characterId].name, pokemon: state.pokemonId } : null,
    race: state && {
      status: state.status, phase: state.phase, revision: state.revision, leg: state.legIndex, legName: leg?.legName ?? null,
      weather: leg?.weather ?? null, hp: state.hp, stamina: state.stamina, gapM: state.pursuitGapM,
      catches: state.hydeCatchCount, bankedEggs: state.bankedEggPoints, simTimeS: state.totalSimulatedTimeCs / 100,
      finalScore: state.finalScore, finalEggPoints: state.finalEggPoints, dnfReason: state.dnfReason, verified: flow.view?.verified,
    },
    selection: flow.screen === 'decision' ? flow.selection : null,
    pushOptions: flow.screen === 'decision' && state
      ? getPushOptions(state).map((o) => ({ level: o.pushLevel, cost: o.staminaCost, pct: o.pushDiscountPct, legal: o.isLegal }))
      : null,
    visibleOffers: leg?.visibleOffers ?? null,
    advice: flow.screen === 'decision' && advice.route
      ? advice.route.kind === 'ready' ? { headline: advice.route.advice.headline, recommended: advice.route.advice.recommended } : advice.route.kind
      : flow.screen === 'egg' ? advice.egg?.headline ?? 'loading' : null,
    lastLeg: r && {
      leg: r.legIndex, outcome: r.outcome, route: r.route, push: r.pushLevel, legTimeS: r.time.totalCs / 100,
      crash: r.crashOccurred, caught: r.hydeCatch, eggOffer: r.eggOffer, eggBanked: r.eggPointsBanked,
    },
    actions: actions[flow.screen] ?? [],
    scene,
  };
}
