// Laptop 1 dashboard: ranked leaderboard, live station cards, recent finishes, defeated log, analytics,
// and a visually separated operator drawer. Never displays seeds.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScoreRecord } from '../game/index.ts';
import type { AppServices, DashboardSnapshot } from '../lib/backend.ts';
import { readDemoData } from '../lib/local/demoStore.ts';
import { summariseRecords, summariseTelemetry } from '../analytics/descriptive.ts';
import { useHotkeys } from './keyboard.ts';
import { useTestHooks } from './testHooks.ts';
import { ConnectionBadge, VerifiedBadge } from '../ui/components/Badge.tsx';
import { Button } from '../ui/components/Button.tsx';
import { Leaderboard } from '../ui/dashboard/Leaderboard.tsx';
import { OperatorDrawer } from '../ui/dashboard/OperatorDrawer.tsx';
import { StationCard, stationsFor } from '../ui/dashboard/StationCard.tsx';
import { DefeatedLog, RecentFinishes, TodayStats } from '../ui/dashboard/BoardPanels.tsx';
import { Icon } from '../ui/Icon.tsx';

const NEW_ENTRY_MS = 60_000;
const LIVE_RETRY_MS = 30_000;
const TICK_MS = 5_000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Session IDs that appeared after the board first loaded, with the time they were first seen. */
function useNewEntries(records: ScoreRecord[] | undefined): Map<string, number> {
  const seen = useRef<Map<string, number> | null>(null);
  const [, force] = useState(0);
  useEffect(() => {
    if (!records) return;
    if (!seen.current) {
      seen.current = new Map(records.map((r) => [r.sessionId, 0]));
      return;
    }
    let changed = false;
    for (const r of records) {
      if (!seen.current.has(r.sessionId)) {
        seen.current.set(r.sessionId, Date.now());
        changed = true;
      }
    }
    if (changed) force((n) => n + 1);
  }, [records]);
  const now = Date.now();
  return new Map([...(seen.current ?? new Map<string, number>())].filter(([, t]) => t > 0 && now - t < NEW_ENTRY_MS));
}

export function DashboardApp({ services }: { services: AppServices }) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const now = useNow();
  const fresh = useNewEntries(snapshot?.leaderboard);
  const live = services.mode === 'live';
  const [liveProblem, setLiveProblem] = useState<string | null>(null);

  // LIVE: the feed hides load failures behind its connection badge, so probe once (and every 30 s while
  // failing) to tell the operator plainly when the backend is unreachable or not deployed yet.
  const checkLive = useCallback(() => {
    services.dashboard.refresh().then(
      () => setLiveProblem(null),
      (err: unknown) => setLiveProblem(err instanceof Error ? err.message : String(err)),
    );
  }, [services]);
  useEffect(() => {
    if (!live) return;
    checkLive();
    const t = setInterval(() => liveProblem && checkLive(), LIVE_RETRY_MS);
    return () => clearInterval(t);
  }, [live, liveProblem, checkLive]);

  useEffect(() => {
    try {
      return services.dashboard.subscribe((s) => {
        setSnapshot(s);
        setFeedError(null);
      });
    } catch (err) {
      setFeedError(err instanceof Error ? err.message : 'The board feed is unavailable.');
      return undefined;
    }
  }, [services]);

  useHotkeys((key) => {
    if (key === 'escape' && drawerOpen) {
      setDrawerOpen(false);
      return true;
    }
  });

  useTestHooks(
    () => ({
      mode: 'dashboard', backend: services.mode, connection: snapshot?.connection ?? null,
      leaderboard: snapshot?.leaderboard.slice(0, 8).map((r) => ({ nickname: r.nickname, score: r.finalScore, verified: r.verified })) ?? [],
      defeated: snapshot?.defeated.length ?? 0, stations: snapshot?.stations.map((s) => ({ id: s.stationId, status: s.status, leg: s.legIndex })) ?? [],
      operatorDrawer: drawerOpen,
    }),
    () => undefined,
  );

  const records = snapshot ? [...snapshot.leaderboard, ...snapshot.defeated] : [];
  const telemetry = !live ? summariseTelemetry(readDemoData().telemetry) : null;

  return (
    <main className="screen dashboard" data-testid="screen-dashboard">
      <header className="dash-head">
        <h1 className="display dash-head__title">Raven Island Regatta · {live ? 'Live board' : 'Demo board'}</h1>
        <div className="dash-head__badges">
          {live ? (
            <span className="badge badge--live badge--big"><span className="badge__dot" aria-hidden="true" />Live</span>
          ) : (
            <span className="badge badge--demo badge--big" data-testid="badge-demo">Local demo — unverified</span>
          )}
          {live && !liveProblem && <VerifiedBadge verified label="Verified scores" />}
          <ConnectionBadge state={snapshot?.connection ?? 'connecting'} />
          <span className="dash-head__clock num">{new Date(now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <Button variant="ghost" size="sm" icon="lock" onClick={() => setDrawerOpen(true)} aria-expanded={drawerOpen} data-testid="btn-operator">
          Operator
        </Button>
      </header>
      {feedError && <p className="notice" role="alert"><Icon name="wifiOff" />{feedError}</p>}
      <section className="dash-board panel" aria-labelledby="lb-title">
        <h2 id="lb-title" className="caps dash-section-title"><Icon name="trophy" />Leaderboard</h2>
        {liveProblem ? (
          <div className="dash-problem" role="alert" data-testid="live-problem">
            <p className="display dash-problem__title"><Icon name="wifiOff" />Live backend unreachable or not set up</p>
            <p className="text-2">The board can’t load verified scores right now. Details: {liveProblem}</p>
            <div className="button-row">
              <Button variant="secondary" icon="reset" onClick={checkLive} data-testid="btn-live-retry">Retry live</Button>
              <Button variant="ghost" onClick={() => { window.location.search = '?mode=dashboard&legacy=1&demo=1'; }} data-testid="btn-demo-board">
                Show demo board (unverified)
              </Button>
            </div>
          </div>
        ) : (
          <Leaderboard records={snapshot?.leaderboard ?? null} fresh={fresh} />
        )}
      </section>
      <section className="dash-stations" aria-label="Stations">
        {stationsFor(services.mode, snapshot?.stations ?? []).map((s) => (
          <StationCard key={s.stationId} station={s} live={live} now={now} />
        ))}
      </section>
      <RecentFinishes records={snapshot?.leaderboard ?? []} now={now} />
      <DefeatedLog records={snapshot?.defeated ?? []} now={now} />
      <TodayStats summary={summariseRecords(records)} telemetry={telemetry} />
      {drawerOpen && <OperatorDrawer services={services} onClose={() => setDrawerOpen(false)} />}
    </main>
  );
}
