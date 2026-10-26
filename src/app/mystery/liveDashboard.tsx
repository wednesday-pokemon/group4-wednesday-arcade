// `/?mode=dashboard` — Laptop 1 LIVE board for the three cases (mystery-v3.1).
//   Header: KPI ribbon (runs, case solved %, extraction %, median time, chases / run — real aggregates of the scope).
//   Row A: Station A + Station B live cards (the shared StationLiveCard + stationViewFromBoard of src/ui/mystery, so the
//          live and demo boards match and fit 1366×768: Realtime status rows + heartbeat analytics — objective, chases,
//          risk, tower odds, the egg estimate while it is uncertain, the Hyde chip, the newest Thing item as fixed copy;
//          "Signal lost" after 15 s) · Standings (verified results: every finisher ranked above every DNF; per case when
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
import { boardOptions, bundledPredictiveService, dashboard } from '../../mystery/analytics/index.ts';
import { CASES } from '../../mystery/data/cases.ts';
import { NIGHTSHADES } from '../../mystery/data/nightshades.ts';
import { PARTNERS } from '../../mystery/data/partners.ts';
import type { BoardStation, MysteryBoardSnapshot } from '../../lib/supabase/mysteryDashboardFeed.ts';
import type { MysteryBoardServices } from '../../lib/supabase/mysteryLive.ts';
import { toNum, type MysteryStandingRow } from '../../lib/supabase/mysteryWire.ts';
import { ConnectionBadge } from '../../ui/components/Badge.tsx';
import { Button } from '../../ui/components/Button.tsx';
import { OperatorDrawer } from '../../ui/dashboard/OperatorDrawer.tsx';
import { Icon } from '../../ui/Icon.tsx';
import {
  CaseBoard, CaseTag, ClueSolve, DescriptiveLayer, DetectionTrend, DiagnosticLayer, DuoPopularity, KpiRibbon, PredictiveLayer, PrescriptiveLayer,
  StationLiveCard, type CaseScope,
} from '../../ui/mystery/MysteryDashboard.tsx';
import { stationViewFromBoard, type StationCardView } from '../../ui/mystery/stationView.ts';
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

/**
 * The shared card view of a live station, plus the spectator egg rule: once the visitor LOCATED the egg (seen, or the
 * estimate is certain) the station sends no site at all (heartbeat `eggLocated`) and the card shows "seen" — Laptop 1
 * never names the true egg site.
 */
export function liveStationView(station: BoardStation, now: number): StationCardView {
  const v = stationViewFromBoard(station, now);
  if (station.heartbeat?.eggLocated === true) return { ...v, eggOdds: null, egg: v.egg === 'resting' || v.egg === 'unknown' ? 'seen' : v.egg };
  return v;
}
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
    <main className="mdash mdash--kpi" data-testid="screen-dashboard" data-board="mystery-live">
      <header className="mdash__head mdash__head--kpi">
        <h1 className="display mdash__title" title="Rules mystery-v3.1 · live, verified results">Nevermore · Control Center</h1>
        <KpiRibbon agg={agg} />
        <span className="badge badge--live" data-testid="badge-mode"><span className="badge__dot" aria-hidden="true" />Live · verified</span>
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

      <div className="mdash__grid mdash__grid--cases mdash__grid--live" data-scope={agg.scope}>
        {(snap?.stations ?? []).map((s, i) => (
          <StationLiveCard key={s.stationId} view={liveStationView(s, now)} area={i === 0 ? 'mdash-a1' : 'mdash-a2'} testId={`station-live-${s.stationId}`} />
        ))}
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
