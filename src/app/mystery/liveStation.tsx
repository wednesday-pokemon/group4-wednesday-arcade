// `/?mode=terminal&station=station_a|station_b` — the mystery journey as a LIVE station kiosk.
// Boot: Supabase configured? → station sign-in gate (the shared StationGate; station account bound to THIS station)
// → MysteryApp with the live controller (server-issued session / offer / verified result). Unconfigured or
// unreachable live mode never falls back silently: the gate offers an explicit "Play LOCAL DEMO (unverified)".
// Lazy-loaded by App.tsx; supabase-js itself is a further dynamic import.
import { useCallback, useEffect, useState } from 'react';
import type { StationId } from '../../game/index.ts';
import type { MysteryStationServices } from '../../lib/supabase/mysteryLive.ts';
import { StationGate } from '../../ui/screens/GateScreens.tsx';
import { stationLabel } from '../routing.ts';
import { liveConfigured } from './liveConfig.ts';
import { createLiveController, type LiveController } from './liveRun.ts';
import { MysteryApp } from './MysteryApp.tsx';
import { browserStorage } from './records.ts';

type Boot =
  | { kind: 'loading' }
  | { kind: 'gate'; problem: string | null; services: MysteryStationServices | null }
  | { kind: 'ready'; services: MysteryStationServices }
  | { kind: 'local' };

export function MysteryStationApp({ stationId }: { stationId: StationId }) {
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });
  const name = stationLabel(stationId);

  const start = useCallback(async () => {
    setBoot({ kind: 'loading' });
    if (!liveConfigured()) {
      setBoot({ kind: 'gate', problem: 'Live mode is not configured on this laptop (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env).', services: null });
      return;
    }
    try {
      const { createMysteryStationServices } = await import('../../lib/supabase/mysteryLive.ts');
      const services = await createMysteryStationServices(stationId);
      const user = await services.auth.currentUser();
      setBoot(user && user.role === 'station' && user.stationId === stationId ? { kind: 'ready', services } : { kind: 'gate', problem: null, services });
    } catch (err) {
      setBoot({ kind: 'gate', problem: `Live service unreachable: ${err instanceof Error ? err.message : String(err)}`, services: null });
    }
  }, [stationId]);

  useEffect(() => {
    void start();
  }, [start]);

  if (boot.kind === 'loading') return <div className="boot" role="status" data-testid="boot">Lighting the lanterns…</div>;
  if (boot.kind === 'local') return <MysteryApp characterId={null} pokemonId={null} seed={null} skipTutorial={false} />;
  if (boot.kind === 'gate') {
    const services = boot.services;
    return (
      <StationGate
        stationName={name}
        problem={boot.problem}
        onSignIn={services ? async (email, password) => {
          const user = await services.auth.signIn(email, password); // refuses accounts of the other station / operators
          if (user.role !== 'station' || user.stationId !== stationId) throw new Error(`This account is not the ${name} account.`);
          setBoot({ kind: 'ready', services });
        } : undefined}
        onRetry={() => void start()}
        onLocalDemo={() => setBoot({ kind: 'local' })}
      />
    );
  }
  return <LiveStation services={boot.services} stationId={stationId} />;
}

function LiveStation({ services, stationId }: { services: MysteryStationServices; stationId: StationId }) {
  const [controller, setController] = useState<{ c: LiveController; n: number } | null>(null);
  // Created in an effect (not a memo) so StrictMode's mount → unmount → mount disposes the first instance cleanly.
  useEffect(() => {
    const c = createLiveController({ services, storage: browserStorage(), stationName: stationLabel(stationId) });
    setController((prev) => ({ c, n: (prev?.n ?? 0) + 1 }));
    return () => c.dispose();
  }, [services, stationId]);
  if (!controller) return <div className="boot" role="status" data-testid="boot">Lighting the lanterns…</div>;
  return <MysteryApp key={controller.n} characterId={null} pokemonId={null} seed={null} skipTutorial={false} live={controller.c} />;
}

