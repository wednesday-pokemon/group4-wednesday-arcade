// Laptop 1 MYSTERY dashboard, LOCAL DEMO (`/?mode=dashboard&demo=1`): reads the sessions finished on this browser
// ('raven.mystery.records') and this station's live status ('raven.mystery.live'), refreshing every 2 s and on
// cross-tab `storage` events, and renders the four game-wide analytics via `dashboard(records, clueIds)`.
// The live (Supabase Realtime) feed for stations A and B arrives with the backend deploy.
import { useEffect, useMemo, useState } from 'react';
import { bundledPredictiveService, dashboard } from '../../mystery/analytics/index.ts';
import { SILENT_EVIDENCE } from '../../mystery/data/case.ts';
import { MysteryDashboard } from '../../ui/mystery/MysteryDashboard.tsx';
import '../../ui/styles/mystery.css';
import { useTestHooks } from '../testHooks.ts';
import { browserStorage, LIVE_KEY, loadRecords, readLive, RECORDS_KEY, type LiveStatus, type StoredRecord } from './records.ts';

const REFRESH_MS = 2000;

export function MysteryDashboardApp() {
  const [records, setRecords] = useState<StoredRecord[]>(() => loadRecords(browserStorage()));
  const [live, setLive] = useState<LiveStatus | null>(() => readLive(browserStorage()));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const refresh = () => {
      setRecords(loadRecords(browserStorage()));
      setLive(readLive(browserStorage()));
      setNow(Date.now());
    };
    const id = window.setInterval(refresh, REFRESH_MS);
    const onStorage = (e: StorageEvent) => {
      if (e.key === RECORDS_KEY || e.key === LIVE_KEY) refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const clueIds = useMemo(() => SILENT_EVIDENCE.clues.map((c) => c.id), []);
  const agg = useMemo(() => dashboard(records.map((r) => r.record), clueIds), [records, clueIds]);
  const card = bundledPredictiveService().modelCard();

  useTestHooks(
    () => ({
      mode: 'mystery_dashboard',
      backend: 'local_demo',
      records: records.length,
      live: live && { phase: live.phase, stale: now - live.updatedAt > 15000 },
      descriptive: { runs: agg.descriptive.runs, finished: agg.descriptive.finished, dnf: agg.descriptive.dnf, solvedPct: agg.descriptive.caseSolvedPctOfFinished },
      model: { source: card.source, label: card.label, brier: card.brier, baselineBrier: card.baselineBrier, episodes: card.episodes },
      prescriptive: { given: agg.prescriptive.given, uptakePct: agg.prescriptive.uptakePct },
      diagnostic: { causes: agg.diagnostic.failureCauses.length, patterns: agg.diagnostic.patterns.length },
    }),
    () => undefined,
  );

  return <MysteryDashboard records={records} live={live} now={now} agg={agg} clues={SILENT_EVIDENCE.clues.map((c) => ({ id: c.id, title: c.title }))} />;
}
