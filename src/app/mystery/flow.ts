// Mystery visitor flow (rules mystery-v3.1), a pure reducer:
//   home → nickname → cards → case (the assigned case file is revealed) → prologue (Thing's case story) → tutorial → play ⇄ (board overlay | pause overlay) → accusing → results → reset (home).
// No separate character / Pokémon menus: the visitor picks one of the three offered duo cards. Side effects
// (persisting the session, starting runs) live in MysteryApp; this file only decides what screen comes next.
import type { ResultsAnalytics } from '../../mystery/analytics/index.ts';
import type { Duo, RunResult } from '../../mystery/types.ts';
import { offeredCard, withClosed, withNickname, withSelected, type MysterySession } from './session.ts';

export type MysteryScreen = 'home' | 'nickname' | 'cards' | 'case' | 'prologue' | 'tutorial' | 'play' | 'accusing' | 'results';
export type MysteryOverlay = 'none' | 'board' | 'pause';

export interface MysteryFlowState {
  screen: MysteryScreen;
  overlay: MysteryOverlay;
  session: MysterySession;
  /** Increments for every new run (a fresh MysteryRun + scene). */
  attempt: number;
  result: RunResult | null;
  /** The four analytics panels for the finished run (Phase 4), null when unavailable. */
  analytics: ResultsAnalytics | null;
  /** Dev shortcut tutorial=0: selecting a duo goes straight to play. */
  skipTutorial: boolean;
  /** Operator `prologue=0` / dev shortcuts: selecting a duo skips the case-file reveal and Thing's story. */
  skipPrologue: boolean;
}

export type MysteryAction =
  | { type: 'start' }
  | { type: 'back' }
  | { type: 'nickname'; nickname: string }
  | { type: 'select'; duo: Duo }
  | { type: 'caseRevealed' }
  | { type: 'prologueDone' }
  | { type: 'tutorialDone' }
  | { type: 'toggleBoard' }
  | { type: 'closeOverlay' }
  | { type: 'pause' }
  | { type: 'togglePause' }
  | { type: 'deposited' }
  | { type: 'ended'; result: RunResult; analytics?: ResultsAnalytics | null }
  | { type: 'reset'; session: MysterySession };

/** Screens that host the island (one run, one scene). */
export const ON_ISLAND: readonly MysteryScreen[] = ['tutorial', 'play', 'accusing'];
export const isOnIsland = (s: MysteryScreen) => ON_ISLAND.includes(s);

/** Fresh page load: a session that already has a nickname resumes on its (same) three cards. */
export function initialFlow(session: MysterySession, skipTutorial = false, skipPrologue = skipTutorial): MysteryFlowState {
  return { screen: session.nickname ? 'cards' : 'home', overlay: 'none', session, attempt: 0, result: null, analytics: null, skipTutorial, skipPrologue };
}

/** Where the journey goes once the prologue is done (or skipped). */
const afterPrologue = (state: MysteryFlowState): MysteryScreen => (state.skipTutorial ? 'play' : 'tutorial');

/** Dev shortcut `/?mode=mystery&character=..&pokemon=..`: the duo is selected and the run starts immediately. */
export function shortcutFlow(session: MysterySession, duo: Duo, skipTutorial: boolean): MysteryFlowState {
  const base = initialFlow({ ...session, nickname: session.nickname || 'Guest' }, skipTutorial, true);
  return mysteryReducer({ ...base, screen: 'cards' }, { type: 'select', duo });
}

export function mysteryReducer(state: MysteryFlowState, action: MysteryAction): MysteryFlowState {
  switch (action.type) {
    case 'start':
      return state.screen === 'home' ? { ...state, screen: 'nickname' } : state;
    case 'back':
      if (state.screen === 'nickname') return { ...state, screen: 'home' };
      if (state.screen === 'cards') return { ...state, screen: 'nickname' };
      return state;
    case 'nickname':
      if (state.screen !== 'nickname') return state;
      return { ...state, screen: 'cards', session: withNickname(state.session, action.nickname) };
    case 'select': {
      if (state.screen !== 'cards' || !offeredCard(state.session.offer, action.duo)) return state;
      return {
        ...state,
        screen: state.skipPrologue ? afterPrologue(state) : 'case',
        overlay: 'none',
        session: withSelected(state.session, action.duo),
        attempt: state.attempt + 1,
        result: null,
        analytics: null,
      };
    }
    case 'caseRevealed':
      return state.screen === 'case' ? { ...state, screen: 'prologue' } : state;
    case 'prologueDone':
      return state.screen === 'prologue' ? { ...state, screen: afterPrologue(state), overlay: 'none' } : state;
    case 'tutorialDone':
      return state.screen === 'tutorial' ? { ...state, screen: 'play', overlay: 'none' } : state;
    case 'toggleBoard':
      if (state.screen !== 'tutorial' && state.screen !== 'play') return state;
      if (state.overlay === 'pause') return state;
      return { ...state, overlay: state.overlay === 'board' ? 'none' : 'board' };
    case 'closeOverlay':
      return state.overlay === 'none' ? state : { ...state, overlay: 'none' };
    case 'pause':
      return isOnIsland(state.screen) && state.overlay !== 'pause' ? { ...state, overlay: 'pause' } : state;
    case 'togglePause':
      if (!isOnIsland(state.screen)) return state;
      // Esc on an open board closes it rather than pausing (one Esc = one layer).
      if (state.overlay === 'board') return { ...state, overlay: 'none' };
      return { ...state, overlay: state.overlay === 'pause' ? 'none' : 'pause' };
    case 'deposited':
      return state.screen === 'play' ? { ...state, screen: 'accusing', overlay: 'none' } : state;
    case 'ended':
      if (!isOnIsland(state.screen)) return state;
      // The session is closed with its result: a refresh can never resume this case for a second accusation.
      return { ...state, screen: 'results', overlay: 'none', session: withClosed(state.session), result: action.result, analytics: action.analytics ?? null };
    case 'reset':
      return { screen: 'home', overlay: 'none', session: action.session, attempt: state.attempt, result: null, analytics: null, skipTutorial: state.skipTutorial, skipPrologue: state.skipPrologue };
    default:
      return state;
  }
}

/** Step indicator (UX §1–3: "Step 1 of 3 · Name", "Step 2 of 3 · Duo", tutorial = 3). */
export const MYSTERY_STEP: Partial<Record<MysteryScreen, number>> = { nickname: 1, cards: 2, tutorial: 3 };
export const MYSTERY_STEPS_TOTAL = 3;
