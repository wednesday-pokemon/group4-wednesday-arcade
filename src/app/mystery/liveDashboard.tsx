// `/?mode=dashboard` — Laptop 1 LIVE board for "The Silent Evidence" (mystery-v3.1).
//   Row A: Station A + Station B live cards (Realtime status rows + heartbeat; "Signal lost" after 15 s) · Standings
//          (verified results: every finisher ranked above every DNF)
//   Row B/C: clue solve rate, Hyde detections, pick rates and the four analytics layers, computed by
//          dashboard(records, clueIds) from server rows (event-level panels need an operator sign-in: RLS).
// Operator drawer (shared component): operator sign-in → "Reset Station A/B" with confirmation → admin-reset.
// Never shows seeds, the culprit or who anyone accused. `/?mode=dashboard&demo=1` stays the LOCAL DEMO board,
// `/?mode=dashboard&legacy=1` the v2.5 board.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { bundledPredictiveService, dashboard } from '../../mystery/analytics/index.ts';
import { SILENT_EVIDENCE } from '../../mystery/data/case.ts';
import { NIGHTSHADES } from '../../mystery/data/nightshades.ts';
import { PARTNERS } from '../../mystery/data/partners.ts';
import type { BoardStation, MysteryBoardSnapshot } from '../../lib/supabase/mysteryDashboardFeed.ts';
import type { MysteryBoardServices } from '../../lib/supabase/mysteryLive.ts';
import { toNum, type HeartbeatPhase, type MysteryStandingRow } from '../../lib/supabase/mysteryWire.ts';
import { ConnectionBadge } from '../../ui/components/Badge.tsx';
import { Button } from '../../ui/components/Button.tsx';
import { OperatorDrawer } from '../../ui/dashboard/OperatorDrawer.tsx';
import { Icon } from '../../ui/Icon.tsx';
import {
  ClueSolve, DescriptiveLayer, DetectionTrend, DiagnosticLayer, DuoPopularity, PredictiveLayer, PrescriptiveLayer,
} from '../../ui/mystery/MysteryDashboard.tsx';
import '../../ui/styles/mystery.css';
import { useHotkeys } from '../keyboard.ts';
import { useTestHooks } from '../testHooks.ts';
import { liveConfigured } from './liveConfig.ts';

type Boot = { kind: 'loading' } | { kind: 'ready'; services: MysteryBoardServices } | { kind: 'problem'; message: string };

const DEMO_BOARD = '?mode=dashboard&demo=1';

export function MysteryLiveDashboardApp() {
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });
  const start = useCallback(async () => {
    setBoot({ kind: 'loading' });
    if (!liveConfigured()) {
      setBoot({ kind: 'problem', message: 'Live mode is not configured on this laptop (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env).' });
      return;
    }
    try {
      const { createMysteryBoardServices } = await import('../../lib/supabase/mysteryLive.ts');
      setBoot({ kind: 'ready', services: await createMysteryBoardServices() });
    } catch (err) {
      setBoot({ kind: 'problem', message: err instanceof Error ? err.message : String(err) });
    }
  }, []);
  useEffect(() => {
    void start();
  }, [start]);

  if (boot.kind === 'loading') return <div className="boot" role="status" data-testid="boot">Lighting the lanterns…</div>;
  if (boot.kind === 'problem') return <BoardProblem message={boot.message} onRetry={() => void start()} />;
  return <LiveBoard services={boot.services} />;
}

function BoardProblem({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="mdash" data-testid="screen-dashboard" data-board="mystery-live">
      <header className="mdash__head">
        <h1 className="display mdash__title">Raven Island · Control Center</h1>
        <span className="mdash__chip">mystery-v3.1</span>
      </header>
      <div className="dash-problem" role="alert" data-testid="live-problem">
        <p className="display dash-problem__title"><Icon name="wifiOff" />Live backend unreachable or not set up</p>
        <p className="text-2">The board can’t load verified results right now. Details: {message}</p>
        <div className="button-row">
          <Button variant="secondary" icon="reset" onClick={onRetry} data-testid="btn-live-retry">Retry live</Button>
          <Button variant="ghost" onClick={() => { window.location.search = DEMO_BOARD; }} data-testid="btn-demo-board">Show demo board (unverified)</Button>
        </div>
      </div>
    </main>
  );
}

const nameOfChar = (id: string | null | undefined) => (id ? NIGHTSHADES[id as keyof typeof NIGHTSHADES]?.shortName ?? id : '');
const nameOfMon = (id: string | null | undefined) => (id ? PARTNERS[id as keyof typeof PARTNERS]?.name ?? id : '');

const PHASE_TEXT: Record<HeartbeatPhase, string> = {
  idle: 'Idle', name: 'Name entry', duo: 'Choosing duo', tutorial: 'Tutorial', investigating: 'Investigating',
  carrying: 'Carrying egg', accusing: 'Accusing', results: 'Results', dnf: 'DNF',
};
const STATUS_TEXT: Record<string, string> = { idle: 'Idle', offered: 'Choosing duo', playing: 'Investigating', finished: 'Results', dnf: 'DNF' };
const STATUS_PHASE: Record<string, HeartbeatPhase> = { idle: 'idle', offered: 'duo', playing: 'investigating', finished: 'results', dnf: 'dnf' };

function LiveBoard({ services }: { services: MysteryBoardServices }) {
  const [snap, setSnap] = useState<MysteryBoardSnapshot | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => services.feed.subscribe(setSnap), [services]);
  useHotkeys((key) => {
    if (key === 'escape' && drawerOpen) {
      setDrawerOpen(false);
      return true;
    }
  });

  const clueIds = useMemo(() => SILENT_EVIDENCE.clues.map((c) => c.id), []);
  const clues = useMemo(() => SILENT_EVIDENCE.clues.map((c) => ({ id: c.id, title: c.title })), []);
  const version = snap?.recordsVersion ?? -1;
  const records = snap?.records;
  const agg = useMemo(() => dashboard(records ?? [], clueIds), [version, clueIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const card = bundledPredictiveService().modelCard();
  const now = snap?.updatedAt ?? Date.now();

  useTestHooks(
    () => ({
      mode: 'mystery_dashboard',
      backend: 'live',
      connection: snap?.connection ?? null,
      loaded: snap?.loaded ?? false,
      error: snap?.error ?? null,
      detailed: snap?.detailed ?? false,
      records: snap?.records.length ?? 0,
      stations: snap?.stations.map((s) => ({ id: s.stationId, status: s.row?.status ?? null, phase: s.heartbeat?.phase ?? null, signalLost: s.signalLost })) ?? [],
      standings: snap?.standings.slice(0, 10).map((r) => ({ nickname: r.nickname, outcome: r.outcome, rank: r.rank, score: toNum(r.score) })) ?? [],
      descriptive: { runs: agg.descriptive.runs, finished: agg.descriptive.finished, dnf: agg.descriptive.dnf, solvedPct: agg.descriptive.caseSolvedPctOfFinished },
      model: { source: card.source, label: card.label },
      operatorDrawer: drawerOpen,
    }),
    () => undefined,
  );

  return (
    <main className="mdash" data-testid="screen-dashboard" data-board="mystery-live">
      <header className="mdash__head">
        <h1 className="display mdash__title">Raven Island · Control Center</h1>
        <span className="mdash__chip">mystery-v3.1</span>
        <span className="badge badge--live" data-testid="badge-mode"><span className="badge__dot" aria-hidden="true" />Live · verified results</span>
        <ConnectionBadge state={snap?.connection ?? 'connecting'} />
        <span className="text-2 mdash__count">{snap?.records.length ?? 0} verified run{snap?.records.length === 1 ? '' : 's'}</span>
        <Button variant="ghost" size="sm" icon="lock" onClick={() => setDrawerOpen(true)} aria-expanded={drawerOpen} data-testid="btn-operator">Operator</Button>
      </header>
      {snap?.error && (
        <p className="notice" role="alert" data-testid="live-problem"><Icon name="wifiOff" />Live data could not be refreshed ({snap.error}). Showing the last known state; retrying.</p>
      )}
      {snap && !snap.detailed && (
        <p className="text-2" data-testid="board-detail-note" style={{ margin: '0 0 0.5rem' }}>
          Results-level analytics shown. Event-level panels (detections, stance, pick rates, advice) appear after an operator signs in (Operator ›).
        </p>
      )}

      <div className="mdash__grid">
        {(snap?.stations ?? []).map((s, i) => <LiveStationCard key={s.stationId} station={s} now={now} area={i === 0 ? 'mdash-a1' : 'mdash-a2'} />)}
        {!snap && <section className="mdash-card mdash-a1"><p className="text-2">Connecting…</p></section>}
        <Standings rows={snap?.standings ?? []} loaded={snap?.loaded ?? false} />

        <ClueSolve agg={agg} clues={clues} />
        <DetectionTrend agg={agg} />
        <DuoPopularity agg={agg} />

        <DescriptiveLayer agg={agg} />
        <DiagnosticLayer agg={agg} />
        <PredictiveLayer agg={agg} />
        <PrescriptiveLayer agg={agg} />
      </div>
      {drawerOpen && <OperatorDrawer services={services.drawerServices} onClose={() => setDrawerOpen(false)} />}
    </main>
  );
}

function LiveStationCard({ station, now, area }: { station: BoardStation; now: number; area: string }) {
  const row = station.row;
  const beat = station.heartbeat;
  const active = row !== null && row.status !== 'idle';
  const phase: HeartbeatPhase = beat?.phase ?? STATUS_PHASE[row?.status ?? 'idle'] ?? 'idle';
  const label = station.signalLost ? 'Signal lost' : beat ? PHASE_TEXT[beat.phase] : STATUS_TEXT[row?.status ?? 'idle'] ?? 'Idle';
  const age = station.lastSeenAt === null ? null : Math.max(0, Math.round((now - station.lastSeenAt) / 1000));
  const clues = row?.clues_found ?? beat?.clues ?? 0;
  const time = beat?.activeTimeS ?? toNum(row?.active_time_s);
  return (
    <section className={`mdash-card ${area}`} data-testid={`station-live-${station.stationId}`} data-phase={station.signalLost ? 'lost' : phase} aria-label={station.label}>
      <div className="mdash-row">
        <p className="caps">{station.label}</p>
        <span className={`mdash-phase mdash-phase--${station.signalLost ? 'lost' : phase}`}>{label}</span>
      </div>
      {active ? (
        <p className="mdash-station__who">
          <strong>{row?.nickname || '—'}</strong>
          {row?.character_id && row.pokemon_id && <> · {nameOfChar(row.character_id)} &amp; {nameOfMon(row.pokemon_id)}</>}
        </p>
      ) : (
        <p className="text-2">{row?.notice === 'operator_reset' ? 'Reset by the operator.' : 'No visitor yet.'}</p>
      )}
      <dl className="mdash-kv">
        <div><dt>Clues</dt><dd>{[0, 1, 2].map((i) => <span key={i} className={`mdash-pip${i < clues ? ' is-on' : ''}`} />)}</dd></div>
        <div><dt>Egg</dt><dd>{beat?.eggTier ? `${beat.eggTier} · ${beat.eggSecurity ?? '—'}` : row?.egg_state ?? '—'}</dd></div>
        <div><dt>HP · caught</dt><dd className="num">{beat?.hp ?? '—'} · {row?.catches ?? beat?.catches ?? '—'}/2</dd></div>
        <div><dt>Hyde</dt><dd>{beat?.hydeMode ?? '—'}</dd></div>
        <div><dt>Risk</dt><dd className="num">{beat?.risk !== null && beat?.risk !== undefined ? `${beat.risk.toFixed(2)} · ${beat.riskSource === 'ml' ? 'ML' : 'Rule-based'}` : '—'}</dd></div>
        <div><dt>Time</dt><dd className="num">{time !== null && time !== undefined ? `${time.toFixed(1)} s` : '—'}</dd></div>
      </dl>
      {beat && (beat.sync === 'offline' || beat.sync === 'unverified') && (
        <p className="mdash-advice" data-testid={`station-sync-${station.stationId}`}>{beat.sync === 'offline' ? 'Terminal offline · saving locally' : 'Unverified run — not on the board'}</p>
      )}
      <p className="mdash-age text-2">{age === null ? 'no heartbeat yet' : `heartbeat ${age} s ago`}</p>
    </section>
  );
}

function Standings({ rows, loaded }: { rows: MysteryStandingRow[]; loaded: boolean }) {
  const finished = rows.filter((r) => r.outcome === 'finished');
  const dnf = rows.filter((r) => r.outcome === 'dnf');
  return (
    <section className="mdash-card mdash-a3" aria-label="Standings" data-testid="standings">
      <p className="caps">Standings · verified · mystery-v3.1</p>
      {!loaded ? <p className="text-2">Loading…</p> : finished.length === 0 ? <p className="text-2">No finishers yet.</p> : (
        <ol className="mdash-standings">
          {finished.slice(0, 7).map((r) => (
            <li key={r.session_id} data-testid="standing-row" data-group="finished">
              <span className="num mdash-rank">{r.rank ?? '—'}</span>
              <span className="mdash-name">{r.nickname}</span>
              <span className="text-2 mdash-duo">{nameOfChar(r.character_id)} &amp; {nameOfMon(r.pokemon_id)}</span>
              <span className="num mdash-score">{(toNum(r.score) ?? 0).toFixed(1)}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="mdash-dnf text-2">Did not finish — unranked ({dnf.length})</p>
      {dnf.length > 0 && (
        <ul className="mdash-list">
          {dnf.slice(0, 3).map((r) => (
            <li key={r.session_id} data-testid="standing-row" data-group="dnf">
              <span>{r.nickname}</span>
              <span className="mdash-small">{nameOfChar(r.character_id)} &amp; {nameOfMon(r.pokemon_id)}</span>
              <span className="num mdash-small">{(toNum(r.active_time_s) ?? 0).toFixed(1)} s</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
