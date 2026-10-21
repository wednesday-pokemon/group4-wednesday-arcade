// v3 terminal journey (LOCAL DEMO): Home → Nickname → Captain → Pokémon → Confirm → Tutorial → Stage 1 → Complete | DNF.
// Menu screens float over the idle 3D regatta scene (same identity as v2.5); the water stage is lazy-loaded.
import { lazy, Suspense, useEffect, useReducer, useRef, type ReactNode } from 'react';
import type { CharacterId, PokemonId } from '../../game/index.ts';
import { HeaderTools } from '../../ui/components/HeaderTools.tsx';
import { Nickname } from '../../ui/screens/Nickname.tsx';
import { Splash } from '../../ui/screens/Splash.tsx';
import { CharacterSelectV3, PokemonSelectV3 } from '../../ui/screens/v3/CrewSelectV3.tsx';
import { ConfirmV3 } from '../../ui/screens/v3/ConfirmV3.tsx';
import { StageEnd } from '../../ui/screens/v3/StageEnd.tsx';
import { useRaceScene } from '../sceneHost.ts';
import { useSettings } from '../settings.ts';
import { useTestHooks } from '../testHooks.ts';
import { initialV3, shortcutState, v3Reducer, V3_STEP, type V3State } from './flow.ts';
import type { StageDebugHandle } from './StageView.tsx';
import '../../ui/styles/v3.css';

const StageView = lazy(() => import('./StageView.tsx'));

const V3_STEPS = [
  { title: 'Row for your life', body: 'Tap SPACE in a steady rhythm; A and D steer. Rocks, reefs and fog lie between Nevermore and Raven Island.' },
  { title: 'The Hyde hunts your wake', body: 'Row cleanly and he falls back. Crash or stall and he closes in. Watch the Hyde meter.' },
  { title: 'Your Pokémon has your back', body: 'Q fires its ability. If the Hyde grabs you, press Q at once. Caught twice and you don’t finish.' },
];

interface V3AppProps {
  characterId: CharacterId | null;
  pokemonId: PokemonId | null;
  skipTutorial: boolean;
}

export function V3App({ characterId, pokemonId, skipTutorial }: V3AppProps) {
  const [state, dispatch] = useReducer(
    v3Reducer,
    null,
    (): V3State => (characterId && pokemonId ? shortcutState(characterId, pokemonId, skipTutorial) : initialV3),
  );
  const stageDebug = useRef<StageDebugHandle | null>(null);
  const onWater = state.screen === 'tutorial' || state.screen === 'stage';
  const { draft } = state;
  const tools = <HeaderTools mode="local_demo" />;

  useTestHooks(
    () => snapshot(state, stageDebug.current),
    (ms) => stageDebug.current?.advance(ms),
  );

  return (
    <>
      {!onWater && <MenuBackdrop characterId={draft.characterId} pokemonId={draft.pokemonId} />}
      {renderScreen()}
    </>
  );

  function renderScreen(): ReactNode {
    switch (state.screen) {
      case 'splash':
        return (
          <Splash
            stationName="Nevermore boathouse"
            mode="local_demo"
            tools={tools}
            notice={null}
            restoring={false}
            steps={V3_STEPS}
            footnote="Stage 1, The Crossing, is open. About 2 minutes on the water."
            startLabel="Start Game"
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
              dispatch({ type: 'go', screen: 'character' });
            }}
          />
        );
      case 'character':
        return (
          <CharacterSelectV3
            selectedId={draft.characterId}
            tools={tools}
            onSelect={(id) => dispatch({ type: 'draft', patch: { characterId: id } })}
            onBack={() => dispatch({ type: 'go', screen: 'nickname' })}
            onContinue={() => dispatch({ type: 'go', screen: 'pokemon' })}
          />
        );
      case 'pokemon':
        return (
          <PokemonSelectV3
            characterId={draft.characterId ?? 'wednesday'}
            selectedId={draft.pokemonId}
            tools={tools}
            onSelect={(id) => dispatch({ type: 'draft', patch: { pokemonId: id } })}
            onBack={() => dispatch({ type: 'go', screen: 'character' })}
            onContinue={() => dispatch({ type: 'go', screen: 'confirm' })}
          />
        );
      case 'confirm':
        if (!draft.characterId || !draft.pokemonId) return null;
        return (
          <ConfirmV3
            nickname={draft.nickname}
            characterId={draft.characterId}
            pokemonId={draft.pokemonId}
            tools={tools}
            onChangeCaptain={() => dispatch({ type: 'go', screen: 'character' })}
            onChangePokemon={() => dispatch({ type: 'go', screen: 'pokemon' })}
            onStart={() => dispatch({ type: 'startTutorial' })}
          />
        );
      case 'tutorial':
      case 'stage':
        if (!draft.characterId || !draft.pokemonId) return null;
        return (
          <Suspense fallback={<div className="boot" role="status">Launching the boat…</div>}>
            <StageView
              characterId={draft.characterId}
              pokemonId={draft.pokemonId}
              practice={state.screen === 'tutorial'}
              attempt={state.attempt}
              holdToRow={state.holdToRow}
              onHoldToRow={(on) => dispatch({ type: 'holdToRow', on })}
              onTutorialDone={() => dispatch({ type: 'tutorialDone' })}
              onEnded={(result) => dispatch({ type: 'ended', result })}
              onRestart={() => dispatch({ type: 'playAgain' })}
              onMainMenu={() => dispatch({ type: 'mainMenu' })}
              debugRef={stageDebug}
            />
          </Suspense>
        );
      case 'complete':
      case 'dnf':
        if (!state.result || !draft.characterId || !draft.pokemonId) return null;
        return (
          <StageEnd
            key={state.attempt}
            result={state.result}
            nickname={draft.nickname}
            characterId={draft.characterId}
            pokemonId={draft.pokemonId}
            tools={tools}
            onPlayAgain={() => dispatch({ type: 'playAgain' })}
            onMainMenu={() => dispatch({ type: 'mainMenu' })}
          />
        );
      default:
        return null;
    }
  }
}

/** The idle v2.5 regatta scene behind the menus (boat + crew preview). Unmounted on the water to free WebGL. */
function MenuBackdrop({ characterId, pokemonId }: { characterId: CharacterId | null; pokemonId: PokemonId | null }) {
  const settings = useSettings();
  const ref = useRef<HTMLDivElement>(null);
  const status = useRaceScene(ref, { reducedMotion: settings.reducedMotion, lowGraphics: settings.lowGraphics });
  const scene = status.kind === 'ready' ? status.scene : null;
  useEffect(() => {
    scene?.setCrew(characterId ?? 'wednesday', pokemonId ?? 'gengar');
  }, [scene, characterId, pokemonId]);
  return (
    <>
      <div id="scene" ref={ref} aria-hidden="true" />
      {!scene && <div className="scene-backdrop" aria-hidden="true" />}
    </>
  );
}

function snapshot(state: V3State, stage: StageDebugHandle | null) {
  const actions: Record<V3State['screen'], string[]> = {
    splash: ['Enter=start'],
    nickname: ['type nickname', 'Enter=continue'],
    character: ['Arrows=browse+select', 'Enter=continue'],
    pokemon: ['Arrows=browse+select', 'Enter=continue'],
    confirm: ['Enter=start tutorial'],
    tutorial: ['Space=row', 'A/D=steer', 'W=glide', 'S=brake', 'Q=ability', 'H=hold-to-row', 'Enter=skip tutorial', 'Esc=pause'],
    stage: ['Space=row', 'A/D=steer', 'W=glide', 'S=brake', 'Q=ability/rescue', 'H=hold-to-row', 'Esc=pause'],
    complete: ['Enter=play again'],
    dnf: ['Enter=play again'],
  };
  return {
    mode: 'v3',
    rules: 'v3.0-realtime',
    backend: 'local_demo',
    screen: state.screen,
    step: V3_STEP[state.screen] ?? null,
    draft: state.draft,
    holdToRow: state.holdToRow,
    tutorialDone: state.tutorialDone,
    attempt: state.attempt,
    result: state.result,
    actions: actions[state.screen],
    view: stage?.extra() ?? null,
    stage: stage?.debug() ?? null,
  };
}
