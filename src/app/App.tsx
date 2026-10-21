// App shell: URL routing, service boot (live vs LOCAL DEMO, never a silent fallback), global keys (M, F),
// audio unlock, and the persistent live regions.
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { StationId } from '../game/index.ts';
import type { AppServices } from '../lib/backend.ts';
import { createServices } from '../lib/services.ts';
import { LiveRegions } from './announce.tsx';
import { audio } from './audio.ts';

const THEME_MUSIC = `${import.meta.env.BASE_URL}audio/MainThemeSong.mp3`;
import { DashboardApp } from './DashboardApp.tsx';
import { useHotkeys } from './keyboard.ts';
import { parseRoute, stationLabel } from './routing.ts';
import { toggleFullscreen, updateSettings, useSettings, getSettings } from './settings.ts';
import { TerminalApp } from './TerminalApp.tsx';
import { V3App } from './v3/V3App.tsx';
import { MysteryApp } from './mystery/MysteryApp.tsx';
// The mystery dashboard pulls in the analytics package: lazy so the visitor journey's menu bundle stays small.
const MysteryDashboardApp = lazy(() => import('./mystery/MysteryDashboardApp.tsx').then((m) => ({ default: m.MysteryDashboardApp })));
// LIVE station kiosk + LIVE board (Supabase is a further dynamic import inside them).
const MysteryStationApp = lazy(() => import('./mystery/liveStation.tsx').then((m) => ({ default: m.MysteryStationApp })));
const MysteryLiveDashboardApp = lazy(() => import('./mystery/liveDashboard.tsx').then((m) => ({ default: m.MysteryLiveDashboardApp })));
import { MessageScreen, StationGate } from '../ui/screens/GateScreens.tsx';

type Boot =
  | { kind: 'loading' }
  | { kind: 'ready'; services: AppServices }
  | { kind: 'gate'; problem: string | null; services: AppServices | null };

function useServices(stationId: StationId | null, forceLocal: boolean, requireStationAuth: boolean) {
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });

  const start = useCallback(
    async (local: boolean) => {
      setBoot({ kind: 'loading' });
      try {
        const services = await createServices(stationId, local);
        if (services.mode === 'live' && requireStationAuth) {
          const user = await services.auth?.currentUser();
          if (!user || user.role !== 'station' || (user.stationId && user.stationId !== stationId)) {
            setBoot({ kind: 'gate', problem: null, services });
            return;
          }
        }
        setBoot({ kind: 'ready', services });
      } catch (err) {
        setBoot({ kind: 'gate', problem: `Live service unreachable: ${err instanceof Error ? err.message : String(err)}`, services: null });
      }
    },
    [stationId, requireStationAuth],
  );

  useEffect(() => {
    void start(forceLocal);
  }, [start, forceLocal]);

  const signIn = async (email: string, password: string) => {
    if (boot.kind !== 'gate' || !boot.services?.auth) return;
    const user = await boot.services.auth.signIn(email, password);
    if (user.role !== 'station') throw new Error('This account is not a station account.');
    if (user.stationId && user.stationId !== stationId) throw new Error(`This account belongs to ${stationLabel(user.stationId)}.`);
    setBoot({ kind: 'ready', services: boot.services });
  };

  return { boot, retry: () => void start(false), playLocal: () => void start(true), signIn };
}

/**
 * `fullscreenHotkey`: legacy screens toggle fullscreen with F; the mystery game uses F for the character power.
 * `music`: looping background track for this route (mystery journey and live kiosks); none elsewhere.
 */
function GlobalShell({ children, fullscreenHotkey = true, music = null }: { children: ReactNode; fullscreenHotkey?: boolean; music?: string | null }) {
  const settings = useSettings();
  useEffect(() => audio.setMuted(settings.muted), [settings.muted]);
  useEffect(() => audio.setMusic(music), [music]);
  useEffect(() => {
    const unlock = () => audio.unlock();
    const tick = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest('button:not([aria-disabled="true"]), [role="radio"]')) audio.play('tick');
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('click', tick);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('click', tick);
    };
  }, []);
  useHotkeys((key) => {
    if (key === 'm') {
      updateSettings({ muted: !getSettings().muted });
      return true;
    }
    if (key === 'f' && fullscreenHotkey) {
      void toggleFullscreen();
      return true;
    }
  });
  return (
    <>
      {children}
      <LiveRegions />
    </>
  );
}

export function App() {
  const route = useMemo(() => parseRoute(window.location.search), []);
  if (route.kind === 'mystery') {
    return (
      <GlobalShell fullscreenHotkey={false} music={THEME_MUSIC}>
        <MysteryApp characterId={route.characterId} pokemonId={route.pokemonId} seed={route.seed} skipTutorial={route.skipTutorial} />
      </GlobalShell>
    );
  }
  if (route.kind === 'mystery_station') {
    return (
      <GlobalShell fullscreenHotkey={false} music={THEME_MUSIC}>
        <Suspense fallback={<div className="boot" role="status">Lighting the lanterns…</div>}><MysteryStationApp stationId={route.stationId} /></Suspense>
      </GlobalShell>
    );
  }
  if (route.kind === 'mystery_live_dashboard') {
    return (
      <GlobalShell>
        <Suspense fallback={<div className="boot" role="status">Lighting the lanterns…</div>}><MysteryLiveDashboardApp /></Suspense>
      </GlobalShell>
    );
  }
  if (route.kind === 'mystery_dashboard') {
    return (
      <GlobalShell>
        <Suspense fallback={<div className="boot" role="status">Lighting the lanterns…</div>}><MysteryDashboardApp /></Suspense>
      </GlobalShell>
    );
  }
  if (route.kind === 'play') {
    return <GlobalShell><V3App characterId={route.characterId} pokemonId={route.pokemonId} skipTutorial={route.skipTutorial} /></GlobalShell>;
  }
  return <GlobalShell>{route.kind === 'invalid' ? <MessageScreen title="Unknown address" message={route.message} /> : <Routed route={route} />}</GlobalShell>;
}

/** The demo board is its own URL so a refreshed Laptop 1 never silently swaps live for demo data. */
function showDemoBoard(): void {
  window.location.search = '?mode=dashboard&legacy=1&demo=1';
}

function Routed({ route }: { route: Extract<ReturnType<typeof parseRoute>, { kind: 'terminal' | 'dashboard' }> }) {
  const isTerminal = route.kind === 'terminal';
  const stationId = isTerminal ? route.stationId : null;
  const { boot, retry, playLocal, signIn } = useServices(stationId, route.forceLocal, isTerminal);
  const stationName = stationLabel(stationId);

  if (boot.kind === 'loading') return <div className="boot" role="status" data-testid="boot">Lighting the lanterns…</div>;
  if (boot.kind === 'gate') {
    return (
      <StationGate
        stationName={isTerminal ? stationName : 'Dashboard'}
        problem={boot.problem}
        onSignIn={boot.services?.auth ? signIn : undefined}
        onRetry={retry}
        onLocalDemo={isTerminal ? playLocal : showDemoBoard}
        localLabel={isTerminal ? undefined : 'Show demo board (unverified)'}
      />
    );
  }
  if (!isTerminal) return <DashboardApp services={boot.services} />;
  return <TerminalApp services={boot.services} stationName={boot.services.mode === 'live' ? stationName : 'Demo station'} stationKey={String(boot.services.backend.stationId)} />;
}
