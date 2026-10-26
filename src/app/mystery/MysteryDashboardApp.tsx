// Laptop 1 MYSTERY dashboard, LOCAL DEMO (`/?mode=dashboard&demo=1`): header KPI ribbon + StationLiveCard
// (docs/overhaul/UX_OVERHAUL.md §10, src/ui/mystery/stationView.ts) over the sessions finished on this browser
// ('raven.mystery.records') and this station's live status ('raven.mystery.live'), refreshing every 2 s and on
// cross-tab `storage` events, and renders the four game-wide analytics via `dashboard(records, { caseId })` for the
// selected case scope (All / Case 01 / 02 / 03) plus the per-case summary table. Records from before the three cases
// (no case id) are left out as soon as any case-tagged record exists (`boardOptions`); a browser that only holds such
// legacy records shows them combined, without the case filter.
// The live (Supabase Realtime) feed for stations A and B arrives with the backend deploy.
// Final wave (FINAL_CONTRACT §1/§10): the standings + "Top score" KPI rank mystery-v4 runs only (localEntries: v3.1 and
// legacy records never mix); once any v4 record exists the analytics / KPIs use the v4 records only as well.
import { useEffect, useMemo, useState } from 'react';
import { boardOptions, bundledPredictiveService, dashboard } from '../../mystery/analytics/index.ts';
import { MysteryDashboard, scoreKpi, type CaseScope } from '../../ui/mystery/MysteryDashboard.tsx';
import { kpiRibbon, stationViewFromLocal } from '../../ui/mystery/stationView.ts';
import { isV4Record, localEntries } from '../../ui/mystery/leaderboard/model.ts';
import '../../ui/styles/mystery.css';
import { useTestHooks } from '../testHooks.ts';
import { browserStorage, LIVE_KEY, loadRecords, readLive, RECORDS_KEY, type LiveStatus, type StoredRecord } from './records.ts';

const REFRESH_MS = 2000;

export function MysteryDashboardApp() {
  const [records, setRecords] = useState<StoredRecord[]>(() => loadRecords(browserStorage()));
  const [live, setLive] = useState<LiveStatus | null>(() => readLive(browserStorage()));
  const [now, setNow] = useState(() => Date.now());
  const [scope, setScope] = useState<CaseScope>('all');

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

  // v4 records once any exist (scores and analytics never mix rules versions); older-only browsers keep their records.
  const scoped = useMemo(() => {
    const v4 = records.filter((r) => isV4Record(r.record));
    return v4.length > 0 ? v4 : records;
  }, [records]);
  const entries = useMemo(() => localEntries(records), [records]);
  const sessionRecords = useMemo(() => scoped.map((r) => r.record), [scoped]);
  const { options, caseAware } = useMemo(() => boardOptions(sessionRecords, scope), [sessionRecords, scope]);
  const agg = useMemo(() => dashboard(sessionRecords, options), [sessionRecords, options]);
  const card = bundledPredictiveService().modelCard();

  useTestHooks(
    () => ({
      mode: 'mystery_dashboard',
      backend: 'local_demo',
      records: records.length,
      v4Records: entries.length,
      standings: scoreKpi(agg.scope === 'all' ? entries : entries.filter((e) => e.caseId === agg.scope)),
      scope: agg.scope,
      caseAware,
      legacyExcluded: agg.descriptive.legacyExcluded,
      cases: agg.descriptive.cases.map((c) => ({ id: c.caseId, runs: c.runs, solvedPct: c.solvedPctOfFinished, medianTimeS: c.medianTimeS, extractionPct: c.extractionPct })),
      live: live && { phase: live.phase, stale: now - live.updatedAt > 15000 },
      kpis: kpiRibbon(agg.descriptive).map((k) => ({ key: k.key, value: k.value, n: k.n, small: k.small })),
      station: (() => {
        const v = stationViewFromLocal(live, now);
        return { phase: v.lost ? 'lost' : v.phase, chasing: v.chasing, clues: v.clues, egg: v.egg, objective: v.objectiveText, hyde: v.hyde?.word ?? null, thing: v.thing?.head ?? null };
      })(),
      descriptive: { runs: agg.descriptive.runs, finished: agg.descriptive.finished, dnf: agg.descriptive.dnf, solvedPct: agg.descriptive.caseSolvedPctOfFinished },
      model: { source: card.source, label: card.label, brier: card.brier, baselineBrier: card.baselineBrier, episodes: card.episodes },
      prescriptive: { given: agg.prescriptive.given, uptakePct: agg.prescriptive.uptakePct },
      diagnostic: { causes: agg.diagnostic.failureCauses.length, caseFailures: agg.diagnostic.caseFailures.length, patterns: agg.diagnostic.patterns.length },
    }),
    () => undefined,
  );

  return <MysteryDashboard records={scoped} live={live} now={now} agg={agg} scope={scope} onScope={setScope} caseAware={caseAware} entries={entries} />;
}
