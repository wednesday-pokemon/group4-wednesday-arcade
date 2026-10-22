// "The Silent Evidence" visitor journey (rules mystery-v3.1):
// Restored Home → Nickname → three duo cards → case-file reveal (the session's assigned case) → Thing's case
// prologue → Thing tutorial → island (HUD, Tab board, Esc pause) → accusation at
// Iago Tower → results → reset. The island view is lazy-loaded so three.js and the sim stay out of the menu bundle.
//
// Two modes:
//  * LOCAL DEMO (`/`, no `live` prop): crypto seed + draftOffer in this browser, persisted in
//    localStorage['raven.mystery.session']; unverified, never on the leaderboard.
//  * LIVE station (`/?mode=terminal&station=…`, `live` = liveRun.ts controller): the SERVER issues the session, seed
//    and the three cards (mystery-create-session, actionId persisted first), the selection goes through
//    mystery-select-duo, events stream to mystery-append-events and the result shown is the server's
//    (mystery-finalize). A refresh restores the same offer / selection via mystery-get-session.
import {
  lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type ReactNode,
} from 'react';
import type { Duo } from '../../mystery/types.ts';
import { HeaderTools } from '../../ui/components/HeaderTools.tsx';
import { Button } from '../../ui/components/Button.tsx';
import { ThingSigil } from '../../ui/components/ThingSigil.tsx';
import { DuoCards } from '../../ui/mystery/DuoCards.tsx';
import { offerViews } from '../../ui/mystery/duoView.ts';
import { CaseReveal } from '../../ui/mystery/CaseReveal.tsx';
import { MysteryResults } from '../../ui/mystery/MysteryResults.tsx';
import { ThingNarrator } from '../../ui/mystery/ThingNarrator.tsx';
import { ThingPrologue } from '../../ui/mystery/ThingPrologue.tsx';
import { Nickname } from '../../ui/screens/Nickname.tsx';
import { Splash } from '../../ui/screens/Splash.tsx';
import { serverRunResult } from '../../lib/supabase/mysteryWire.ts';
import { resetVisitorSettings } from '../settings.ts';
import { useTestHooks } from '../testHooks.ts';
import {
  initialFlow, isOnIsland, MYSTERY_STEP, MYSTERY_STEPS_TOTAL as STEPS_TOTAL, mysteryReducer, shortcutFlow, type MysteryAction,
  type MysteryFlowState,
} from './flow.ts';
import { cardFor, caseDef, integrationStatus, loadCaseSolution, makeOffer, realDraftAvailable } from './integration.ts';
import { drawCase } from './caseBag.ts';
import { LiveResultBanner, LiveStepNotice, LiveSyncChip } from './liveChrome.tsx';
import {
  LiveRunContext, LiveStepError, type LiveRestore, type LiveSessionData, type LiveStationHandle, type LiveUiState,
} from './liveContext.ts';
import type { PlayDebugHandle } from './PlayView.tsx';
import {
  browserRandomBytes, createSession, openSession, resetSession, sameDuo, writeSession, type MysterySession, type SessionDeps,
} from './session.ts';
import { openCaseFullscreen } from './kiosk.ts';
import { browserStorage, writeLive, type LivePhase } from './records.ts';
import { HOME_TAGLINE } from './thingLines.ts';
import { CASE_IDS, MYSTERY_RULES_VERSION, type CaseId, type CaseSolution } from '../../mystery/types.ts';
import '../../ui/styles/mystery.css';

const loadPlayView = () => import('./PlayView.tsx');
const PlayView = lazy(loadPlayView);
/** LOCAL DEMO station identity (live stations are station_a / station_b). */
const LOCAL_STATION_ID = 'local';
const HomeBackdrop = lazy(() => import('./HomeBackdrop.tsx'));

/** UX §1: the three step titles ARE the tagline verbatim. */
const HOME_STEPS = [
  { title: 'Stay Silent.', body: 'Crouch with C and move slowly. Hydes hunt by sound.' },
  { title: 'Read the Clues.', body: 'Find three pieces of evidence. Tab opens your board.' },
  { title: 'Escape the Hyde.', body: 'Carry the egg to Iago Tower, then name the culprit.' },
];

export interface MysteryRouteProps {
  characterId: Duo['characterId'] | null;
  pokemonId: Duo['pokemonId'] | null;
  seed: string | null;
  skipTutorial: boolean;
  /** Operator `prologue=0`: skip Thing's story introduction (tutorial=0 skips it too). */
  skipPrologue?: boolean;
  /** Dev/operator `case=<id>`: force the case of this ephemeral (never persisted) session. */
  caseId?: CaseId | null;
}

export interface MysteryAppProps extends MysteryRouteProps {
  /** LIVE station controller; absent = LOCAL DEMO. */
  live?: LiveStationHandle | null;
}

function storage(): SessionDeps['storage'] {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** A uniformly random case for sessions that must not consume the kiosk's case bag (dev shortcuts, LIVE menus). */
function randomCase(): CaseId {
  for (;;) {
    const b = browserRandomBytes(1)[0]!;
    if (b < 255) return CASE_IDS[b % 3]!;
  }
}

/** LOCAL DEMO deals cases from the shuffled bag; LIVE menus only need a placeholder (the server assigns the case). */
function sessionDeps(live: boolean): SessionDeps {
  const store = storage();
  return {
    storage: store, randomBytes: browserRandomBytes, now: () => new Date(), makeOffer, realDraft: realDraftAvailable(),
    drawCase: live ? randomCase : () => drawCase(store, browserRandomBytes),
  };
}

/** Ephemeral (never persisted) session for the dev/operator shortcut. */
function shortcutSession(deps: SessionDeps, route: MysteryRouteProps): MysterySession {
  const s = createSession(deps, { ...(route.seed ? { seed: route.seed } : {}), nickname: 'Guest', caseId: route.caseId ?? randomCase() });
  if (!route.characterId || !route.pokemonId) return s;
  const duo: Duo = { characterId: route.characterId, pokemonId: route.pokemonId };
  if (s.offer.cards.some((c) => sameDuo(c, duo))) return s;
  // Put the requested pair first (dev/operator shortcut only; never persisted).
  const card = cardFor(duo);
  const rest = s.offer.cards.filter((c) => c.characterId !== duo.characterId && c.pokemonId !== duo.pokemonId);
  const cards = [card, ...rest, ...s.offer.cards].slice(0, 3) as [typeof card, typeof card, typeof card];
  return { ...s, offer: { seed: s.seed, cards } };
}

function init(route: MysteryRouteProps, deps: SessionDeps): { state: MysteryFlowState; persist: boolean; restored: boolean } {
  if (route.characterId && route.pokemonId) {
    const session = shortcutSession(deps, route);
    return { state: shortcutFlow(session, { characterId: route.characterId, pokemonId: route.pokemonId }, route.skipTutorial), persist: false, restored: false };
  }
  // Operator reproduction: `?mode=mystery&seed=..` opens that seed's three cards directly (never persisted).
  const skipPrologue = route.skipTutorial || !!route.skipPrologue;
  if (route.seed || route.caseId) {
    const s = createSession(deps, { ...(route.seed ? { seed: route.seed } : {}), nickname: route.seed ? 'Guest' : '', caseId: route.caseId ?? randomCase() });
    return { state: initialFlow(s, route.skipTutorial, skipPrologue), persist: false, restored: false };
  }
  const { session, restored } = openSession(deps);
  return { state: initialFlow(session, route.skipTutorial, skipPrologue), persist: true, restored };
}

/**
 * LIVE: the menus start on a throw-away local session (only its first card dresses the Home backdrop; it is never shown
 * as cards and never persisted). The real session comes from the server (restore / create).
 */
function liveInit(deps: SessionDeps): { state: MysteryFlowState; persist: boolean; restored: boolean } {
  return { state: initialFlow(createSession(deps, { nickname: '' })), persist: false, restored: false };
}

/** Boot once per page load (StrictMode double-invokes memos in dev; the session must be opened exactly once). */
let bootCache: { key: string; deps: SessionDeps; boot: ReturnType<typeof init> } | null = null;
function bootOnce(route: MysteryRouteProps, live: boolean) {
  const key = JSON.stringify({ route, live });
  if (!bootCache || bootCache.key !== key) {
    const deps = sessionDeps(live);
    bootCache = { key, deps, boot: live ? liveInit(deps) : init(route, deps) };
  }
  return bootCache;
}

/** The server's session as the journey's MysterySession (offer exactly as the server returned it). */
export function sessionFromLive(d: LiveSessionData, createdAt = new Date().toISOString()): MysterySession {
  return {
    rulesVersion: MYSTERY_RULES_VERSION,
    sessionId: d.sessionId,
    seed: d.seed,
    offer: d.offer,
    offerSource: 'draft',
    caseId: d.caseId,
    caseVersion: d.caseVersion,
    ...(d.selected ? { selected: d.selected } : {}),
    nickname: d.nickname,
    createdAt,
  };
}

/** Flow state for a restored live session (refresh / reconnect). */
export function flowFromRestore(r: LiveRestore, base: MysteryFlowState): MysteryFlowState {
  if (r.kind === 'offered') return { ...initialFlow(sessionFromLive(r.session)), screen: 'cards', attempt: base.attempt };
  if (r.kind === 'selected' && r.session.selected) {
    const { selected, ...rest } = sessionFromLive(r.session);
    void selected;
    const cards: MysteryFlowState = { ...initialFlow(rest), screen: 'cards', attempt: base.attempt };
    // A reload after the duo was locked in resumes at the tutorial: the story was already shown (or skipped).
    const picked = mysteryReducer(cards, { type: 'select', duo: r.session.selected });
    return mysteryReducer(mysteryReducer(picked, { type: 'caseRevealed' }), { type: 'prologueDone' });
  }
  return { ...base, screen: 'home', overlay: 'none', result: null, analytics: null };
}

type AppAction = MysteryAction | { type: 'replace'; state: MysteryFlowState };
function appReducer(state: MysteryFlowState, action: AppAction): MysteryFlowState {
  return action.type === 'replace' ? action.state : mysteryReducer(state, action);
}

const LOCAL_UI: LiveUiState = { connection: 'connected', sync: 'idle', syncReason: null, final: { kind: 'none' } };
const noSubscribe = () => () => undefined;
const localUi = () => LOCAL_UI;

type LiveBoot = { kind: 'restoring' } | { kind: 'ready' } | { kind: 'error'; message: string };

export function MysteryApp({ live = null, ...route }: MysteryAppProps) {
  const { deps, boot } = useMemo(() => bootOnce(route, live !== null), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, dispatch] = useReducer(appReducer, boot.state);
  const stateRef = useRef(state);
  stateRef.current = state;
  const persist = useRef(boot.persist);
  const playDebug = useRef<PlayDebugHandle | null>(null);
  const liveUi = useSyncExternalStore(live ? live.subscribeUi : noSubscribe, live ? live.getUi : localUi);
  const [liveBoot, setLiveBoot] = useState<LiveBoot>(live ? { kind: 'restoring' } : { kind: 'ready' });
  const [notice, setNotice] = useState<string | null>(null);
  const [step, setStep] = useState<{ busy: string | null; error: string | null }>({ busy: null, error: null });
  const [cardsKey, setCardsKey] = useState(0);
  const stationId = live ? live.stationId : LOCAL_STATION_ID;
  const tools = live ? <HeaderTools mode="live" connection={liveUi.connection} /> : <HeaderTools mode="local_demo" />;
  const { session } = state;
  const activeCase = useMemo(() => caseDef(session.caseId), [session.caseId]);
  // The answer key is fetched only once the run has ended (results); never before the accusation.
  const [solution, setSolution] = useState<CaseSolution | null>(null);
  useEffect(() => {
    if (state.screen !== 'results') return;
    let alive = true;
    void loadCaseSolution(session.caseId).then((s) => alive && setSolution(s), () => alive && setSolution(null));
    return () => {
      alive = false;
    };
  }, [state.screen, session.caseId]);

  useEffect(() => {
    if (persist.current) writeSession(deps.storage, session);
  }, [deps, session]);

  // ------------------------------------------------------------------------------------------- LIVE: restore + reset
  const restore = useCallback(async () => {
    if (!live) return;
    setLiveBoot({ kind: 'restoring' });
    const r = await live.restore();
    if (r.kind === 'error') {
      setLiveBoot({ kind: 'error', message: r.message });
      return;
    }
    if (r.kind === 'interrupted') setNotice('The last run was interrupted by a reload and can’t be verified. Start a new investigation.');
    dispatch({ type: 'replace', state: flowFromRestore(r, stateRef.current) });
    setLiveBoot({ kind: 'ready' });
  }, [live]);

  useEffect(() => {
    void restore();
  }, [restore]);

  const goHome = useCallback((message: string | null) => {
    setNotice(message);
    setStep({ busy: null, error: null });
    dispatch({ type: 'reset', session: createSession(deps, { nickname: '' }) });
  }, [deps]);

  useEffect(() => {
    if (!live) return undefined;
    return live.onReset(() => {
      // On the results screen the visitor keeps reading (the banner says it was not verified); elsewhere: back home.
      if (stateRef.current.screen === 'results') return;
      goHome('This station was reset by the operator.');
    });
  }, [live, goHome]);

  // Laptop 1: the menu phases of this station; the island writes its own 1 Hz status.
  useEffect(() => {
    // The prologue reports as 'tutorial' (the heartbeat phase set is fixed server-side): the visitor is being briefed.
    const menu: Partial<Record<typeof state.screen, LivePhase>> = { home: 'idle', nickname: 'name', cards: 'duo', case: 'tutorial', prologue: 'tutorial' };
    const phase = state.screen === 'results' ? (state.result?.outcome === 'dnf' ? 'dnf' : 'results') : menu[state.screen];
    if (!phase) return;
    const status = {
      stationId, phase, nickname: session.nickname, duo: session.selected ?? null, caseId: session.caseId, clues: state.result?.cluesFound.length ?? 0,
      egg: null, hp: state.result?.hp ?? null, catches: state.result?.catches ?? null, hydeMode: null, risk: null, advice: null,
      activeTimeS: state.result?.activeTimeS ?? null, updatedAt: Date.now(),
    };
    writeLive(browserStorage(), status);
    live?.menuStatus(status);
  }, [state.screen, state.result, session.nickname, session.selected, session.caseId, stationId, live]);

  const cardViews = useMemo(() => offerViews(session.offer.cards, session.offerSource), [session.offer, session.offerSource]);
  const selectedView = cardViews.find((c) => sameDuo(c.duo, session.selected)) ?? null;

  const reset = () => {
    resetVisitorSettings(); // UX §7: visitor settings reset on "New investigation"
    setNotice(null);
    setStep({ busy: null, error: null });
    if (live) {
      live.leave();
      dispatch({ type: 'reset', session: createSession(deps, { nickname: '' }) });
      return;
    }
    persist.current = true;
    dispatch({ type: 'reset', session: resetSession(deps) });
  };

  // ------------------------------------------------------------------------------------------- LIVE: create + select
  const submitNickname = (nickname: string) => {
    if (!live) {
      dispatch({ type: 'nickname', nickname });
      return;
    }
    if (step.busy) return;
    setStep({ busy: 'Opening your case file…', error: null });
    live.createSession(nickname).then(
      (d) => {
        setStep({ busy: null, error: null });
        setNotice(null);
        if (stateRef.current.screen !== 'nickname') return;
        dispatch({ type: 'replace', state: { ...initialFlow(sessionFromLive(d)), screen: 'cards', attempt: stateRef.current.attempt } });
      },
      (err: unknown) => setStep({ busy: null, error: err instanceof Error ? `${err.message} Press Enter to try again.` : String(err) }),
    );
  };

  const selectDuo = (duo: Duo) => {
    if (!live) {
      dispatch({ type: 'select', duo });
      return;
    }
    if (step.busy) return;
    setStep({ busy: 'Locking in your duo…', error: null });
    const adopt = (d: LiveSessionData) => dispatch({ type: 'replace', state: { ...stateRef.current, session: sessionFromLive(d, stateRef.current.session.createdAt) } });
    live.selectDuo(duo).then(
      (d) => {
        setStep({ busy: null, error: null });
        adopt(d);
        dispatch({ type: 'select', duo: d.selected ?? duo });
      },
      (err: unknown) => {
        const e = err instanceof LiveStepError ? err : new LiveStepError('other', String(err));
        if (e.kind === 'already_selected' && e.session?.selected) {
          // The server already holds this case's duo (e.g. chosen just before a reload): continue with it.
          setStep({ busy: null, error: null });
          adopt(e.session);
          dispatch({ type: 'select', duo: e.session.selected });
          return;
        }
        if (e.kind === 'closed' || e.kind === 'reset') {
          goHome(e.message);
          return;
        }
        if (e.session) adopt(e.session); // DUO_NOT_OFFERED: show the server's three cards again
        setCardsKey((k) => k + 1);
        setStep({ busy: null, error: e.message });
      },
    );
  };

  const backdropDuo = session.selected ?? session.offer.cards[0];

  // Fetch the island chunk (three.js + sim) while Thing tells the story, so the tutorial opens without a wait.
  useEffect(() => {
    if (state.screen === 'case' || state.screen === 'prologue') void loadPlayView();
  }, [state.screen]);
  const shownResult = state.result && live && liveUi.final.kind === 'verified' ? serverRunResult(liveUi.final.result, state.result) : state.result;

  useTestHooks(
    () => ({
      mode: 'mystery',
      rules: session.rulesVersion,
      backend: live ? 'live' : 'local_demo',
      station: live ? live.stationId : null,
      screen: live && liveBoot.kind !== 'ready' ? `live_${liveBoot.kind}` : state.screen,
      overlay: state.overlay,
      step: MYSTERY_STEP[state.screen] ?? null,
      session: {
        sessionId: session.sessionId,
        seed: live ? null : session.seed, // never echo a live seed into debug output
        caseId: session.caseId,
        caseVersion: session.caseVersion,
        persisted: persist.current,
        restored: boot.restored,
        offerSource: session.offerSource,
        offered: session.offer.cards.map((c) => ({ characterId: c.characterId, pokemonId: c.pokemonId, duoName: c.duoName, role: c.role, rarity: c.rarity })),
        selected: session.selected ?? null,
        nickname: session.nickname,
      },
      live: live ? { ui: liveUi, step, notice, ...live.debug() } : null,
      attempt: state.attempt,
      integration: integrationStatus(),
      result: shownResult,
      play: playDebug.current?.extra() ?? null,
      run: playDebug.current?.debug() ?? null,
    }),
    (ms) => playDebug.current?.advance(ms),
  );

  if (live && liveBoot.kind !== 'ready') {
    return (
      <>
        <div className="scene-backdrop mys-backdrop" aria-hidden="true" />
        {liveBoot.kind === 'restoring' ? (
          <div className="boot" role="status" data-testid="live-restoring">Opening the case file…</div>
        ) : (
          <section className="action-panel mys-message" role="alert" data-testid="live-restore-error">
            <h2 className="action-panel__title">Can’t reach the case server</h2>
            <p className="action-panel__lead">{liveBoot.message}</p>
            <div className="button-row">
              <Button variant="primary" icon="reset" onClick={() => void restore()} data-testid="btn-live-restore-retry">Try again</Button>
              <Button variant="ghost" onClick={() => { live.leave(); setLiveBoot({ kind: 'ready' }); goHome(null); }} data-testid="btn-live-start-over">Start over</Button>
            </div>
          </section>
        )}
      </>
    );
  }

  const island = isOnIsland(state.screen);
  return (
    <>
      {!island && state.screen !== 'results' && state.screen !== 'prologue' && state.screen !== 'case' && (
        <>
          <div className="scene-backdrop mys-backdrop" aria-hidden="true" />
          <Suspense fallback={null}>
            <HomeBackdrop duo={{ characterId: backdropDuo.characterId, pokemonId: backdropDuo.pokemonId }} seed={session.seed} />
          </Suspense>
        </>
      )}
      {state.screen === 'results' && <div className="scene-backdrop mys-backdrop" aria-hidden="true" />}
      {renderScreen()}
      {state.screen === 'nickname' && <PreloadPortraits urls={cardViews.flatMap((c) => [c.characterArt, c.pokemonArt])} />}
      {live && island && <LiveSyncChip ui={liveUi} />}
      {live && state.screen === 'results' && <LiveResultBanner final={liveUi.final} />}
      {live && state.screen === 'cards' && <LiveStepNotice busy={step.busy} error={step.error} floating />}
    </>
  );

  function renderScreen(): ReactNode {
    switch (state.screen) {
      case 'home':
        return (
          <Splash
            stationName={live ? `${live.stationName} · Nevermore: Deadly Secrets` : 'Demo station · Nevermore: Deadly Secrets'}
            mode={live ? 'live' : 'local_demo'}
            tools={tools}
            notice={notice}
            restoring={false}
            steps={HOME_STEPS}
            stepsLabel={HOME_TAGLINE}
            kicker="Pokémon Day III · Halloween Arcade"
            subtitle="A Nevermore Mystery"
            tagline="Every clue reveals a secret. Every sound invites the Hyde."
            emblem={<ThingSigil size={96} animated pose="wave" label="Thing, your guide" />}
            footnote="Score: egg points × 100 − your time. ~6 min"
            startLabel="Open the case"
            fullscreenHint={false}
            onStart={() => {
              // Kiosk: element fullscreen + keyboard lock from this click (Ctrl may then crouch). Never blocks the flow.
              void openCaseFullscreen();
              setNotice(null);
              dispatch({ type: 'start' });
            }}
          />
        );
      case 'nickname':
        return (
          <Nickname
            initial={session.nickname}
            tools={tools}
            stepLabel={`Step 1 of ${STEPS_TOTAL} · Name`}
            title="What should the case file call you?"
            aside={
              live && (step.busy || step.error)
                ? <LiveStepNotice busy={step.busy} error={step.error} />
                : <ThingNarrator text="Professor Orloff is dead. His egg is gone. Sign the case file." pose="tap" inline />
            }
            onBack={() => {
              setStep({ busy: null, error: null });
              dispatch({ type: 'back' });
            }}
            onSubmit={submitNickname}
          />
        );
      case 'cards':
        return (
          <DuoCards
            key={cardsKey}
            cards={cardViews}
            stepLabel={`Step 2 of ${STEPS_TOTAL} · Duo`}
            tools={tools}
            onBack={() => {
              setStep({ busy: null, error: null });
              dispatch({ type: 'back' });
            }}
            onSelect={selectDuo}
          />
        );
      case 'case':
        return <CaseReveal caseDef={activeCase} tools={tools} onDone={() => dispatch({ type: 'caseRevealed' })} />;
      case 'prologue':
        if (!selectedView) return null;
        return (
          <ThingPrologue
            card={selectedView}
            caseDef={activeCase}
            tools={tools}
            onDone={() => dispatch({ type: 'prologueDone' })}
          />
        );
      case 'tutorial':
      case 'play':
      case 'accusing': {
        if (!session.selected || !selectedView) return null;
        return (
          <LiveRunContext.Provider value={live ? live.hooks : null}>
            <Suspense fallback={<div className="boot" role="status">Crossing to Raven Island…</div>}>
              <PlayView
                key={state.attempt}
                duo={session.selected}
                seed={session.seed}
                caseDef={activeCase}
                hideSeed={live !== null}
                card={selectedView}
                screen={state.screen}
                overlay={state.overlay}
                tutorial={!state.skipTutorial}
                sessionId={session.sessionId}
                stationId={stationId}
                nickname={session.nickname}
                offered={session.offer.cards.map((c) => ({ characterId: c.characterId, pokemonId: c.pokemonId }))}
                dispatch={dispatch}
                onQuit={reset}
                debugRef={playDebug}
              />
            </Suspense>
          </LiveRunContext.Provider>
        );
      }
      case 'results':
        if (!shownResult || !selectedView) return null;
        return (
          <MysteryResults
            result={shownResult}
            analytics={state.analytics}
            nickname={session.nickname}
            card={selectedView}
            caseDef={activeCase}
            solution={solution?.caseId === activeCase.id ? solution : null}
            tools={tools}
            onPlayAgain={reset}
          />
        );
      default:
        return null;
    }
  }
}

/** Warm the image cache for the six offered portraits while the visitor types (UX §1). */
function PreloadPortraits({ urls }: { urls: string[] }) {
  useEffect(() => {
    for (const u of urls) {
      const img = new Image();
      img.src = u;
    }
  }, [urls.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
