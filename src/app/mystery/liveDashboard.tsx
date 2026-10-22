// `/?mode=dashboard` — Laptop 1 LIVE board for the three cases (mystery-v3.1).
//   Row A: Station A + Station B live cards (Realtime status rows + heartbeat; "Signal lost" after 15 s; clue pips sized
//          to the station's case) · Standings (verified results: every finisher ranked above every DNF; per case when
//          a case is selected, using the server's per-case ranks)
//   Row K: case filter (All / Case 01 / 02 / 03) + per-case summary table (runs, mystery-solving accuracy, median time,
//          extraction rate)
//   Row B/C: clue find rates (within each case), Hyde detections, pick rates and the four analytics layers, computed by
//          dashboard(records, { caseId }) from server rows (event-level panels need an operator sign-in: RLS).
//   Records without a case id degrade the board to "combined only" (boardOptions); legacy rows are otherwise excluded.
// Operator drawer (shared component): operator sign-in → "Reset Station A/B" with confirmation → admin-reset.
// Never shows seeds, the culprit or who anyone accused. `/?mode=dashboard&demo=1` stays the LOCAL DEMO board,
// `/?mode=dashboard&legacy=1` the v2.5 board.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { boardOptions, bundledPredictiveService, caseLabel, dashboard } from '../../mystery/analytics/index.ts';
import { CASES } from '../../mystery/data/cases.ts';
import { NIGHTSHADES } from '../../mystery/data/nightshades.ts';
import { CASE_IDS, type CaseId } from '../../mystery/types.ts';
import { PARTNERS } from '../../mystery/data/partners.ts';
import type { BoardStation, MysteryBoardSnapshot } from '../../lib/supabase/mysteryDashboardFeed.ts';
import type { MysteryBoardServices } from '../../lib/supabase/mysteryLive.ts';
import { toNum, type HeartbeatPhase, type MysteryStandingRow } from '../../lib/supabase/mysteryWire.ts';
import { ConnectionBadge } from '../../ui/components/Badge.tsx';
import { Button } from '../../ui/components/Button.tsx';
import { OperatorDrawer } from '../../ui/dashboard/OperatorDrawer.tsx';
import { Icon } from '../../ui/Icon.tsx';
import {
  CaseBoard, CaseTag, ClueSolve, CluePips, DescriptiveLayer, DetectionTrend, DiagnosticLayer, DuoPopularity, PredictiveLayer, PrescriptiveLayer,
  type CaseScope,
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
        <h1 className="display mdash__title">Nevermore · Control Center</h1>
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
  const [scope, setScope] = useState<CaseScope>('all');
  useEffect(() => services.feed.subscribe(setSnap), [services]);
  useHotkeys((key) => {
    if (key === 'escape' && drawerOpen) {
      setDrawerOpen(false);
      return true;
    }
  });

  const version = snap?.recordsVersion ?? -1;
  const records = snap?.records;
  const board = useMemo(() => boardOptions(records ?? [], scope), [version, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const agg = useMemo(() => dashboard(records ?? [], board.options), [version, board]); // eslint-disable-line react-hooks/exhaustive-deps
  const caseScope = board.caseAware ? agg.scope : 'all';
  const standingRows = caseScope === 'all' ? (snap?.standings ?? []) : (snap?.standingsByCase?.[caseScope] ?? (snap?.standings ?? []).filter((r) => r.case_id === caseScope));
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
      standings: standingRows.slice(0, 10).map((r) => ({ nickname: r.nickname, outcome: r.outcome, rank: r.rank, score: toNum(r.score), caseId: r.case_id ?? null })),
      scope: agg.scope,
      caseAware: board.caseAware,
      legacyExcluded: agg.descriptive.legacyExcluded,
      cases: agg.descriptive.cases.map((c) => ({ id: c.caseId, runs: c.runs, solvedPct: c.solvedPctOfFinished, medianTimeS: c.medianTimeS, extractionPct: c.extractionPct })),
      descriptive: { runs: agg.descriptive.runs, finished: agg.descriptive.finished, dnf: agg.descriptive.dnf, solvedPct: agg.descriptive.caseSolvedPctOfFinished },
      model: { source: card.source, label: card.label },
      operatorDrawer: drawerOpen,
    }),
    () => undefined,
  );

  return (
    <main className="mdash" data-testid="screen-dashboard" data-board="mystery-live">
      <header className="mdash__head">
        <h1 className="display mdash__title">Nevermore · Control Center</h1>
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

      <div className="mdash__grid mdash__grid--cases" data-scope={agg.scope}>
        {(snap?.stations ?? []).map((s, i) => <LiveStationCard key={s.stationId} station={s} now={now} area={i === 0 ? 'mdash-a1' : 'mdash-a2'} />)}
        {!snap && <section className="mdash-card mdash-a1"><p className="text-2">Connecting…</p></section>}
        <Standings rows={standingRows} loaded={snap?.loaded ?? false} scope={caseScope} />

        <CaseBoard agg={agg} scope={scope} onScope={setScope} caseAware={board.caseAware} />

        <ClueSolve agg={agg} />
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
  const caseId = active ? (row?.case_id ?? null) : null;
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
      {caseId && (CASE_IDS as readonly string[]).includes(caseId) && <p className="mdash-small" data-testid={`station-case-${station.stationId}`}>{caseLabel(caseId as CaseId)}</p>}
      <dl className="mdash-kv">
        <div><dt>Clues</dt><dd><CluePips found={clues} caseId={caseId} /></dd></div>
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

function Standings({ rows, loaded, scope }: { rows: MysteryStandingRow[]; loaded: boolean; scope: CaseScope }) {
  const finished = rows.filter((r) => r.outcome === 'finished');
  const dnf = rows.filter((r) => r.outcome === 'dnf');
  return (
    <section className="mdash-card mdash-a3" aria-label="Standings" data-testid="standings" data-scope={scope}>
      <p className="caps">Standings · {scope === 'all' ? 'all cases' : `Case ${CASES[scope].number}`} · verified · mystery-v3.1</p>
      {!loaded ? <p className="text-2">Loading…</p> : finished.length === 0 ? <p className="text-2">No finishers yet.</p> : (
        <ol className="mdash-standings mdash-standings--cases">
          {finished.slice(0, 6).map((r) => (
            <li key={r.session_id} data-testid="standing-row" data-group="finished" data-case={r.case_id ?? undefined}>
              <span className="num mdash-rank">{r.rank ?? '—'}</span>
              <span className="mdash-name">{r.nickname}</span>
              <span className="text-2 mdash-duo">{nameOfChar(r.character_id)} &amp; {nameOfMon(r.pokemon_id)}</span>
              <CaseTag caseId={r.case_id} />
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
