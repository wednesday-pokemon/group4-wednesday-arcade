// v3 visitor flow (rules v3.0-realtime), a pure reducer like the v2.5 flow:
// splash → nickname → character → pokemon → confirm → tutorial → stage → complete | dnf.
// Everything here is client-side LOCAL DEMO until the v3 scoring/backend phase.
import type { CharacterId, PokemonId } from '../../game/index.ts';

export type V3Screen = 'splash' | 'nickname' | 'character' | 'pokemon' | 'confirm' | 'tutorial' | 'stage' | 'complete' | 'dnf';

/** Summary of a finished (or DNF) Stage 1 run, captured from the run when it ends. */
export interface StageResult {
  outcome: 'finished' | 'dnf';
  timeS: number;
  hp: number;
  maxHp: number;
  catches: number;
  collisions: number;
  abilitiesUsed: number;
  closeCalls: number;
  rescues: number;
  cleanEscapes: number;
  strokes: number;
  missedStrokes: number;
  maxSpeed: number;
  distance: number;
  progress: number;
}

export interface V3Draft {
  nickname: string;
  characterId: CharacterId | null;
  pokemonId: PokemonId | null;
}

export interface V3State {
  screen: V3Screen;
  draft: V3Draft;
  holdToRow: boolean;
  tutorialDone: boolean;
  /** Increments for every new Stage 1 attempt (forces a fresh run + scene). */
  attempt: number;
  result: StageResult | null;
}

export type V3Action =
  | { type: 'go'; screen: 'splash' | 'nickname' | 'character' | 'pokemon' | 'confirm' }
  | { type: 'draft'; patch: Partial<V3Draft> }
  | { type: 'startTutorial' }
  | { type: 'tutorialDone' }
  | { type: 'ended'; result: StageResult }
  | { type: 'playAgain' }
  | { type: 'mainMenu' }
  | { type: 'holdToRow'; on: boolean };

const EMPTY_DRAFT: V3Draft = { nickname: '', characterId: null, pokemonId: null };

export const initialV3: V3State = { screen: 'splash', draft: EMPTY_DRAFT, holdToRow: false, tutorialDone: false, attempt: 0, result: null };

/** Dev shortcut (`/?mode=play&character=..&pokemon=..`): straight to the tutorial (or Stage 1 with tutorial=0). */
export function shortcutState(characterId: CharacterId, pokemonId: PokemonId, skipTutorial: boolean): V3State {
  return {
    ...initialV3,
    draft: { nickname: 'Guest', characterId, pokemonId },
    screen: skipTutorial ? 'stage' : 'tutorial',
    tutorialDone: skipTutorial,
    attempt: 1,
  };
}

export function v3Reducer(state: V3State, action: V3Action): V3State {
  switch (action.type) {
    case 'go':
      return { ...state, screen: action.screen };
    case 'draft':
      return { ...state, draft: { ...state.draft, ...action.patch } };
    case 'startTutorial':
      if (!state.draft.characterId || !state.draft.pokemonId) return state;
      // Returning players (Play again → Main menu → same session) still get the tutorial: it is short and skippable.
      return { ...state, screen: 'tutorial', tutorialDone: false, result: null, attempt: state.attempt + 1 };
    case 'tutorialDone':
      return state.screen === 'tutorial' ? { ...state, screen: 'stage', tutorialDone: true, attempt: state.attempt + 1 } : state;
    case 'ended':
      return state.screen === 'stage' ? { ...state, screen: action.result.outcome === 'finished' ? 'complete' : 'dnf', result: action.result } : state;
    case 'playAgain':
      return { ...state, screen: 'stage', result: null, attempt: state.attempt + 1 };
    case 'mainMenu':
      return { ...initialV3, holdToRow: state.holdToRow, attempt: state.attempt };
    case 'holdToRow':
      return { ...state, holdToRow: action.on };
    default:
      return state;
  }
}

export const V3_STEP: Partial<Record<V3Screen, number>> = { nickname: 1, character: 2, pokemon: 3, confirm: 4 };
