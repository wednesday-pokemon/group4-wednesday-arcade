// Visitor flow state machine (pure reducer). Outcomes are never computed here: every in-race screen is
// derived from the canonical SessionView / LegResolution returned by the backend.
import type {
  Advice, CharacterId, LegIndex, LegResolution, PokemonId, PushLevel, RouteId, SessionView,
} from '../game/index.ts';
import type { BackendErrorCode } from '../lib/backend.ts';
import type { LegPrediction } from '../analytics/ravenVision.ts';

export type ScreenName =
  | 'splash' | 'nickname' | 'captain' | 'pokemon' | 'confirm'
  | 'decision' | 'egg' | 'cinematic' | 'result' | 'final';

export type BusyKind = 'create' | 'prepare' | 'resolve' | 'abandon' | 'restore';
export type RetryKind = 'create' | 'prepare' | 'resolve' | 'abandon';

/** Client-side advisory memory per leg (shown on the final screen; never used for outcomes). */
export interface LegNotes {
  prediction: LegPrediction | null;
  advice: Advice | null;
  followedAdvice: boolean | null;
}

export interface FlowError {
  code: BackendErrorCode | 'UNKNOWN';
  message: string;
  retry: RetryKind | null;
}

export interface Draft {
  nickname: string;
  characterId: CharacterId | null;
  pokemonId: PokemonId | null;
}

export interface FlowState {
  screen: ScreenName;
  draft: Draft;
  view: SessionView | null;
  selection: { route: RouteId | null; pushLevel: PushLevel };
  resolution: LegResolution | null;
  notes: Partial<Record<LegIndex, LegNotes>>;
  busy: BusyKind | null;
  error: FlowError | null;
  notice: string | null;
}

export type FlowAction =
  | { type: 'go'; screen: 'splash' | 'nickname' | 'captain' | 'pokemon' | 'confirm' }
  | { type: 'draft'; patch: Partial<Draft> }
  | { type: 'select'; route?: RouteId; pushLevel?: PushLevel }
  | { type: 'busy'; busy: BusyKind | null }
  | { type: 'sessionCreated'; view: SessionView }
  | { type: 'prepared'; view: SessionView; notes: LegNotes }
  | { type: 'resolved'; view: SessionView; resolution: LegResolution }
  | { type: 'cinematicDone' }
  | { type: 'next' }
  | { type: 'restore'; view: SessionView; showResult: boolean }
  | { type: 'error'; error: FlowError }
  | { type: 'clearError' }
  | { type: 'reset'; notice?: string | null };

const EMPTY_DRAFT: Draft = { nickname: '', characterId: null, pokemonId: null };
const START_SELECTION = { route: null, pushLevel: 1 as PushLevel };

export const initialFlow: FlowState = {
  screen: 'splash',
  draft: EMPTY_DRAFT,
  view: null,
  selection: START_SELECTION,
  resolution: null,
  notes: {},
  busy: null,
  error: null,
  notice: null,
};

/** Screen for a canonical view (used after reload/reconnect and STALE_REVISION refetches). */
export function screenForView(view: SessionView, showResult: boolean): ScreenName {
  const { status, phase } = view.state;
  if (status === 'abandoned') return 'splash';
  if (status !== 'in_progress') return 'final';
  if (phase === 'awaiting_egg') return 'egg';
  return showResult && view.state.legResults.length > 0 ? 'result' : 'decision';
}

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case 'go':
      return { ...state, screen: action.screen, error: null, notice: action.screen === 'splash' ? state.notice : null };
    case 'draft':
      return { ...state, draft: { ...state.draft, ...action.patch } };
    case 'select':
      return { ...state, selection: { ...state.selection, ...withoutUndefined(action) } };
    case 'busy':
      return { ...state, busy: action.busy };
    case 'sessionCreated':
      return { ...state, view: action.view, screen: 'decision', selection: START_SELECTION, resolution: null, notes: {}, busy: null, error: null, notice: null };
    case 'prepared': {
      const leg = action.view.state.legIndex;
      return { ...state, view: action.view, screen: 'egg', notes: { ...state.notes, [leg]: action.notes }, busy: null, error: null };
    }
    case 'resolved':
      return { ...state, view: action.view, resolution: action.resolution, screen: 'cinematic', busy: null, error: null };
    case 'cinematicDone':
      return state.screen === 'cinematic' ? { ...state, screen: 'result' } : state;
    case 'next': {
      if (!state.view) return state;
      const inProgress = state.view.state.status === 'in_progress';
      return { ...state, screen: inProgress ? 'decision' : 'final', selection: START_SELECTION };
    }
    case 'restore': {
      const screen = screenForView(action.view, action.showResult);
      if (screen === 'splash') return { ...initialFlow };
      const last = action.view.state.legResults.at(-1) ?? null;
      return { ...state, view: action.view, screen, resolution: last, selection: START_SELECTION, busy: null, error: null };
    }
    case 'error':
      return { ...state, error: action.error, busy: null };
    case 'clearError':
      return { ...state, error: null };
    case 'reset':
      return { ...initialFlow, notice: action.notice ?? null };
    default:
      return state;
  }
}

function withoutUndefined(a: { route?: RouteId; pushLevel?: PushLevel }): Partial<FlowState['selection']> {
  const out: Partial<FlowState['selection']> = {};
  if (a.route !== undefined) out.route = a.route;
  if (a.pushLevel !== undefined) out.pushLevel = a.pushLevel;
  return out;
}

export const PRE_RACE_STEP: Partial<Record<ScreenName, number>> = { nickname: 1, captain: 2, pokemon: 3, confirm: 4 };
