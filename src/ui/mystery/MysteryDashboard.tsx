// MysteryDashboard (UX_MYSTERY §8, UX_OVERHAUL §10) — Laptop 1, LOCAL DEMO. Header KPI ribbon (Runs · Case solved ·
// Extraction success · Median time · Hyde chases / run for the selected case scope; "—" at n = 0, "small sample" when
// n < 10), then a 12-col grid:
//   A  StationLiveCard (this station: phase + time, duo, case, progress track clues → egg → tower, HP / caught / chases /
//      Hyde chip, risk · tower · egg odds with sources, newest Thing item, heartbeat age) · Station B · StandingsPanel
//   K  CaseBoard: four selectable case tiles = the case filter (All / Case 01 / 02 / 03 by title) and the per-case
//      summary (runs, mystery-solving accuracy, median time, extraction rate, all-clues share)
//   B  ClueSolvePanel (clues of each case, within that case) · DetectionTrendPanel · DuoPopularityPanel
//   C  the four analytics: Descriptive · Diagnostic · Predictive (ModelCard + reliability diagram) · Prescriptive
// Presents ONLY what src/mystery/analytics aggregated for the selected scope. Never shows seeds, the culprit or who
// anyone accused (accusation outcomes are counts: solved / right suspect with weak evidence / wrong suspect / none).
// The row K/B/C panels are exported for the LIVE board (src/app/mystery/liveDashboard.tsx), which feeds them server rows.
import { ACCUSATION_TEXT, caseLabel, clueCountFor, type CaseSummary, type DashboardAggregates, type PickRate } from '../../mystery/analytics/index.ts';
import { CASES } from '../../mystery/data/cases.ts';
import { NIGHTSHADES } from '../../mystery/data/nightshades.ts';
import { PARTNERS } from '../../mystery/data/partners.ts';
import { CASE_IDS, type CaseId } from '../../mystery/types.ts';
import type { LiveStatus, StoredRecord } from '../../app/mystery/records.ts';
import { HeaderTools } from '../components/HeaderTools.tsx';
import { ThingSigil } from '../components/ThingSigil.tsx';
import { Icon } from '../Icon.tsx';
import { characterArt, pokemonArt } from './duoView.ts';
import { LAYERS } from './LayerPanels.tsx';
import { curseCounts, kpiRibbon, stationViewFromLocal, type CurseCounts, type EggStep, type StationCardView } from './stationView.ts';

export type CaseScope = CaseId | 'all';

interface Props {
  records: StoredRecord[];
  live: LiveStatus | null;
  now: number;
  agg: DashboardAggregates;
  scope: CaseScope;
  onScope: (s: CaseScope) => void;
  /** False when no record carries a case id (combined-only board). */
  caseAware: boolean;
}

const pct = (x: number | null | undefined, digits = 0) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(digits)}%`);
/** For the aggregates' *Pct fields, which are already 0–100. */
const pct100 = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${Math.round(x)}%`);
const num = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? '—' : x.toFixed(d));
const secs = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${x.toFixed(0)} s`);
const nameOfChar = (id: string) => NIGHTSHADES[id as keyof typeof NIGHTSHADES]?.shortName ?? id;
const nameOfMon = (id: string) => PARTNERS[id as keyof typeof PARTNERS]?.name ?? id;
const abilityName = (id: string) =>
  Object.values(NIGHTSHADES).find((n) => n.power.id === id)?.power.name ?? Object.values(PARTNERS).find((p) => p.move.id === id)?.move.name ?? id;
const isCase = (v: unknown): v is CaseId => typeof v === 'string' && (CASE_IDS as readonly string[]).includes(v);

export function MysteryDashboard({ records, live, now, agg, scope, onScope, caseAware }: Props) {
  return (
    <main className="mdash mdash--kpi" data-testid="mystery-dashboard" data-scope={agg.scope}>
      <header className="mdash__head mdash__head--kpi">
        <h1 className="display mdash__title" title={`Rules mystery-v3.1 · LOCAL DEMO: ${records.length} session${records.length === 1 ? '' : 's'} played in this browser`}>Nevermore · Control Center</h1>
        <KpiRibbon agg={agg} curses={curseCounts(inScope(records, agg.scope).map((r) => r.record))} />
        <HeaderTools mode="local_demo" />
      </header>

      <div className="mdash__grid mdash__grid--cases mdash__grid--live">
        <StationLiveCard view={stationViewFromLocal(live, now)} area="mdash-a1" testId="station-live" />
        <section className="mdash-card mdash-card--muted mdash-a2" aria-label="Station B">
          <p className="caps">Station B</p>
          <p className="text-2">Both stations appear here live once the Supabase backend is deployed (Realtime). This demo reads only the sessions played in this browser.</p>
        </section>
        <Standings records={records} scope={agg.scope} />

        <CaseBoard agg={agg} scope={scope} onScope={onScope} caseAware={caseAware} />

        <ClueSolve agg={agg} />
        <DetectionTrend agg={agg} />
        <DuoPopularity agg={agg} />

        <DescriptiveLayer agg={agg} />
        <DiagnosticLayer agg={agg} />
        <PredictiveLayer agg={agg} />
        <PrescriptiveLayer agg={agg} />
      </div>
    </main>
  );
}

/** Records of a case scope (all = every record). */
function inScope(records: StoredRecord[], scope: CaseScope): StoredRecord[] {
  return scope === 'all' ? records : records.filter((r) => (r.record.caseId ?? r.record.result?.caseId) === scope);
}

/** Clue pips sized to the case's clue count (legacy / unknown case → 3). */
export function CluePips({ found, caseId }: { found: number; caseId?: string | null }) {
  const total = clueCountFor(isCase(caseId) ? caseId : null);
  return (
    <span role="img" aria-label={`${Math.min(found, total)} of ${total} clues`} data-testid="clue-pips" data-total={total}>
      {Array.from({ length: total }, (_, i) => <span key={i} className={`mdash-pip${i < found ? ' is-on' : ''}`} />)}
    </span>
  );
}

// ----------------------------------------------------------------------------------------------------- station card

const EGG_WORD: Record<EggStep, string> = {
  unknown: 'Egg', resting: 'Egg not found', seen: 'Egg seen', carried: 'Egg carried', dropped: 'Egg dropped', delivered: 'Egg secured',
};
const SRC: Record<'ml' | 'rule', string> = { ml: 'ML', rule: 'Rule-based' };

/**
 * One station, live (UX_OVERHAUL §10). Presentational: the view comes from stationView.ts (local LiveStatus or a live
 * BoardStation via stationViewFromBoard). Status always reads as icon + word; CHASE adds a red frame + "CHASING" chip,
 * a lost signal a dashed frame. Never shows the culprit, the accused suspect or the true egg site.
 */
export function StationLiveCard({ view: v, area, testId }: { view: StationCardView; area: string; testId: string }) {
  const state = v.lost ? 'lost' : v.chasing ? 'chase' : v.phase;
  return (
    <section
      className={`mdash-card ${area} mstation${v.chasing ? ' is-chase' : ''}${v.hunted ? ' is-hunted' : ''}${v.lost ? ' is-lost' : ''}${v.dnf ? ' is-dnf' : ''}`}
      data-testid={testId} data-phase={v.lost ? 'lost' : v.phase} data-state={state} aria-label={v.label}
    >
      <div className="mstation__r1">
        <p className="caps mstation__label">{v.label}</p>
        <span className={`mdash-phase mdash-phase--${v.lost ? 'lost' : v.phase}`}><Icon name={v.phaseIcon} />{v.phaseText}</span>
        {v.chasing && <span className="mstation__chasing" data-testid={`${testId}-chasing`}><Icon name="claw" />CHASING</span>}
        {v.hunted && <span className="mstation__hunted" data-testid={`${testId}-hunted`}><Icon name="hat" />HUNTED</span>}
        {v.timeText && <span className="mstation__time" data-testid={`${testId}-time`}>{v.timeText}</span>}
      </div>
      {!v.active && !v.duo ? (
        <p className="text-2 mstation__idle">{v.notice ?? 'No visitor yet.'}</p>
      ) : (
        <>
          <div className="mstation__r2">
            {v.duo && (
              <span className="mstation__faces" aria-hidden="true">
                <img src={characterArt(v.duo.characterId)} alt="" width={28} height={28} />
                <img src={pokemonArt(v.duo.pokemonId)} alt="" width={28} height={28} />
              </span>
            )}
            <strong className="mstation__nick">{v.nickname ?? '—'}</strong>
            {v.duoText && <span className="mstation__duo">{v.duoText}</span>}
          </div>
          {v.caseText && <p className="mstation__case" data-testid={`${testId}-case`}>
            <span className="mstation__casetext">{v.caseText}</span>
            {v.chasesText && <span className="mstation__chases" data-testid={`${testId}-chases`}>{v.chasesText}</span>}
          </p>}
          <ProgressTrack v={v} testId={testId} />
          <div className="mstation__r5">
            <span className="mstation__hp" title="HP">
              <Icon name="heart" />
              <span className="mstation__hpbar" aria-hidden="true">
                <span style={{ width: `${Math.max(0, Math.min(100, ((v.hp ?? 0) / v.maxHp) * 100))}%` }} className={(v.hp ?? 0) <= 50 ? 'is-low' : undefined} />
              </span>
              <b>{v.hp ?? '—'}</b>
            </span>
            <span>Caught <b>{v.catches ?? '—'}/2</b></span>
            {v.hyde && <span className={`mstation__hyde${v.hyde.chase ? ' is-chase' : ''}`} data-testid={`${testId}-hyde`}><Icon name={v.hyde.icon} />{v.hyde.word}</span>}
            {v.crack && <span className={`mstation__crack${v.crack.hunting ? ' is-hunting' : ''}`} data-testid={`${testId}-crack`} title="Joseph Crackstone"><Icon name={v.crack.icon} />{v.crack.word}</span>}
          </div>
          <p className="mstation__r6" data-testid={`${testId}-odds`}>
            <span>Risk <b>{v.risk ? v.risk.band : '—'}</b>{v.risk && <span className="mstation__src"> · {SRC[v.risk.source]}</span>}</span>
            <span>Tower <b>{v.tower ? `${v.tower.pct}%` : '—'}</b>{v.tower && <span className="mstation__src"> · {SRC[v.tower.source]}</span>}</span>
            {v.eggOdds && <span>Egg: <b>{v.eggOdds.name} {v.eggOdds.pct}%</b><span className="mstation__src"> · Bayesian</span></span>}
          </p>
          <p className="mstation__r7" data-testid={`${testId}-thing`}>
            <ThingSigil size={24} pose="point" />
            {v.thing ? (
              <>
                <span className="mstation__head">{v.thing.head}</span>
                <span className="mstation__text">{v.thing.text}</span>
                {v.thing.followed && <span className="mstation__followed">{v.thing.followed}</span>}
              </>
            ) : <span className="mstation__text text-2">No Thing message yet.</span>}
          </p>
          {v.notice && <p className="mdash-advice">{v.notice}</p>}
        </>
      )}
      {v.ageText && <p className="mdash-age text-2 mstation__age">{v.ageText}</p>}
    </section>
  );
}

/** ◆◆◇ clues → egg → tower + objective word (icon + word, never colour alone). */
function ProgressTrack({ v, testId }: { v: StationCardView; testId: string }) {
  const done = v.clues >= v.cluesTotal;
  const eggOn = v.egg === 'carried' || v.egg === 'delivered' || v.egg === 'seen' || v.egg === 'dropped';
  const eggWord = EGG_WORD[v.egg].replace(/^Egg ?/, '') || '—';
  return (
    <div
      className="mstation__track" data-testid={`${testId}-track`} role="img"
      aria-label={`${v.clues} of ${v.cluesTotal} clues · ${EGG_WORD[v.egg]} · ${v.towerReached ? 'tower reached' : 'tower not reached'}${v.objectiveText ? ` · ${v.objectiveText}` : ''}`}
    >
      <span className={`mstation__step${done ? ' is-done' : ''}`}><CluePips found={v.clues} caseId={v.caseId} /></span>
      <span className="mstation__arrow" aria-hidden="true">→</span>
      <span className={`mstation__step mstation__egg is-${v.egg}${eggOn ? ' is-on' : ''}`}><Icon name="egg" /><span>{eggWord}</span></span>
      <span className="mstation__arrow" aria-hidden="true">→</span>
      <span className={`mstation__step mstation__tower${v.towerReached ? ' is-on' : ''}`}><Icon name="flag" /><span>Tower</span></span>
      {v.objectiveText && <span className="mstation__obj">{v.objectiveText}</span>}
    </div>
  );
}

/** Header KPI ribbon for the selected case scope (stat tiles: label + value; "small sample" under n = 10). */
export function KpiRibbon({ agg, curses = null }: { agg: DashboardAggregates; curses?: CurseCounts | null }) {
  const scopeText = agg.scope === 'all' ? 'All cases' : `Case ${CASES[agg.scope].number}`;
  return (
    <dl className="mdash-kpis" data-testid="kpi-ribbon" aria-label={`Key numbers · ${scopeText}`} data-scope={agg.scope}>
      {kpiRibbon(agg.descriptive, curses).map((k) => (
        <div key={k.key} className="mdash-kpi" data-testid={`kpi-${k.key}`} title={k.title} data-n={k.n}>
          <dt aria-label={k.label}>{k.short}</dt>
          <dd>
            <span className="mdash-kpi__v">{k.value}</span>
            {k.small && <span className="mdash-kpi__small">small sample</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** "C02" tag for a case id (nothing for legacy rows). */
export function CaseTag({ caseId }: { caseId: string | null | undefined }) {
  if (!isCase(caseId)) return null;
  return <span className="mdash-casetag" title={caseLabel(caseId)}>C{CASES[caseId].number}</span>;
}

function Standings({ records, scope }: { records: StoredRecord[]; scope: CaseScope }) {
  const inScope = scope === 'all' ? records : records.filter((r) => (r.record.caseId ?? r.record.result?.caseId) === scope);
  const finished = inScope.filter((r) => r.record.result?.outcome === 'finished' && r.record.result.score !== null)
    .sort((a, b) => (b.record.result!.score! - a.record.result!.score!) || (a.record.result!.activeTimeS - b.record.result!.activeTimeS));
  const dnf = inScope.filter((r) => r.record.result?.outcome === 'dnf');
  return (
    <section className="mdash-card mdash-a3" aria-label="Standings" data-testid="standings">
      <p className="caps">Standings · {scope === 'all' ? 'all cases' : `Case ${CASES[scope].number}`} · mystery-v3.1</p>
      {finished.length === 0 ? <p className="text-2">No finishers yet.</p> : (
        <ol className="mdash-standings mdash-standings--cases">
          {finished.slice(0, 6).map((r, i) => (
            <li key={r.record.sessionId}>
              <span className="num mdash-rank">{i + 1}</span>
              <span className="mdash-name">{r.nickname}</span>
              <span className="text-2 mdash-duo">{r.record.duo ? `${nameOfChar(r.record.duo.characterId)} & ${nameOfMon(r.record.duo.pokemonId)}` : ''}</span>
              <CaseTag caseId={r.record.caseId ?? r.record.result?.caseId} />
              <span className="num mdash-score">{r.record.result!.score!.toFixed(1)}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="mdash-dnf text-2">Did not finish — unranked ({dnf.length})</p>
    </section>
  );
}

// ----------------------------------------------------------------------------------------------------- cases

/**
 * Row K — the case filter AND the per-case summary in one: four selectable tiles (All cases / Case 01 / 02 / 03, by
 * title), each showing runs, mystery-solving accuracy (case solved ÷ finished), median completion time (finishers),
 * extraction rate (egg delivered ÷ ended runs) and the share that found all of the case's clues. A radiogroup: arrow
 * keys / click select the scope of every panel below. Combined-only boards (no case ids) disable the case tiles.
 */
export function CaseBoard({ agg, scope, onScope, caseAware }: { agg: DashboardAggregates; scope: CaseScope; onScope: (s: CaseScope) => void; caseAware: boolean }) {
  const d = agg.descriptive;
  const tiles: { id: CaseScope; head: string; title: string; c: CaseSummary }[] = [
    {
      id: 'all', head: 'All cases', c: d.combined,
      title: !caseAware ? 'Combined only (no case ids yet)' : d.legacyExcluded > 0 ? `Combined · ${d.legacyExcluded} legacy run${d.legacyExcluded === 1 ? '' : 's'} not counted` : 'Combined',
    },
    ...d.cases.map((c) => ({ id: c.caseId as CaseScope, head: `Case ${c.number}`, title: c.title, c })),
  ];
  const current = caseAware ? scope : 'all';
  const move = (dir: number) => {
    const enabled = tiles.filter((t) => caseAware || t.id === 'all');
    const i = enabled.findIndex((t) => t.id === current);
    onScope(enabled[(i + dir + enabled.length) % enabled.length]!.id);
  };
  return (
    <section className="mdash-case" aria-label="Results per case" data-testid="case-board">
      <div
        className="mdash-tiles" role="radiogroup" aria-label="Case filter" data-testid="case-filter"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
        }}
      >
        {tiles.map(({ id, head, title, c }) => {
          const on = current === id;
          const disabled = !caseAware && id !== 'all';
          const summary = `${c.runs} runs · solved ${pct100(c.solvedPctOfFinished)} of ${c.finished} finished · median ${secs(c.medianTimeS)} · extraction ${pct100(c.extractionPct)} · all clues ${pct100(c.allCluesPct)}`;
          return (
            <button
              key={id} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} disabled={disabled}
              className={`mdash-tile${on ? ' is-on' : ''}`} onClick={() => onScope(id)}
              aria-label={`${head}: ${title}. ${summary}`} title={summary}
              data-testid={`case-filter-${id}`}
            >
              <span className="mdash-tile__head">
                <strong>{head}</strong>
                <span className="mdash-tile__title" data-testid={id === 'all' && d.legacyExcluded > 0 ? 'legacy-note' : undefined}>{title}</span>
                <span className="num mdash-tile__runs" data-testid={`case-row-${id}`}>{c.runs} run{c.runs === 1 ? '' : 's'}</span>
              </span>
              <span className="mdash-tile__stats num" data-testid={id === 'all' ? 'case-summary' : undefined}>
                <span>Solved <b>{pct100(c.solvedPctOfFinished)}</b></span>
                <span>Median <b>{secs(c.medianTimeS)}</b></span>
                <span>Extract <b>{pct100(c.extractionPct)}</b></span>
                <span>Clues <b>{pct100(c.allCluesPct)}</b></span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Bar({ label, value, note, title }: { label: string; value: number | null; note?: string; title?: string }) {
  return (
    <div className="mdash-bar" title={title}>
      <span className="mdash-bar__label">{label}</span>
      <span className="mdash-bar__track"><span style={{ width: `${Math.round((value ?? 0) * 100)}%` }} /></span>
      <span className="num mdash-bar__value">{pct(value)}{note && <span className="mdash-small"> {note}</span>}</span>
    </div>
  );
}

const OUTCOME_ORDER = [
  ['solved', 'solved'], ['rightSuspectWrongEvidence', 'right_suspect_wrong_evidence'], ['wrongSuspect', 'wrong_suspect'],
  ['notAccused', 'not_accused'], ['unsolved', 'unsolved'], ['dnf', 'dnf'],
] as const;

/** Stacked bar of accusation outcomes (counts only — never who was accused). */
export function AccusationBar({ agg }: { agg: DashboardAggregates }) {
  const a = agg.descriptive.accusation;
  const parts = OUTCOME_ORDER.map(([k, kind]) => ({ kind, n: a[k] })).filter((p) => p.n > 0);
  const total = parts.reduce((s, p) => s + p.n, 0);
  if (total === 0) return <p className="mdash-small">No accusations yet.</p>;
  const legend = `Accusations: ${parts.map((p) => `${ACCUSATION_TEXT[p.kind]} ${p.n}`).join(' · ')}${a.deductionCorrectPctOfAccused !== null ? ` · evidence exactly right ${pct100(a.deductionCorrectPctOfAccused)}` : ''}`;
  return (
    <div className="mdash-acc" data-testid="accusation-outcomes">
      <div className="mdash-acc__bar" role="img" aria-label={parts.map((p) => `${ACCUSATION_TEXT[p.kind]} ${p.n}`).join(', ')}>
        {parts.map((p) => <span key={p.kind} className={`mdash-acc__seg mdash-acc__seg--${p.kind}`} style={{ width: `${(100 * p.n) / total}%` }} />)}
      </div>
      <p className="mdash-small mdash-acc__legend" title={legend}>{legend}</p>
    </div>
  );
}

/** Clue find rates, always WITHIN each case (each case has its own three clues). */
export function ClueSolve({ agg }: { agg: DashboardAggregates }) {
  const d = agg.descriptive;
  const groups = new Map<string, typeof d.clueRates>();
  for (const c of d.clueRates) groups.set(c.caseId ?? 'legacy', [...(groups.get(c.caseId ?? 'legacy') ?? []), c]);
  const many = groups.size > 1;
  return (
    <section className="mdash-card mdash-b1" aria-label="Clue solve rates" data-testid="clue-solve">
      <p className="caps">Clues · find rate{d.scope === 'all' ? ' · within each case' : ` · Case ${CASES[d.scope].number}`}</p>
      {groups.size === 0 && <p className="text-2">No finished runs yet.</p>}
      {many ? (
        <div className="mdash-cluemx" role="table" aria-label="Clue find rate per case">
          {[...groups.entries()].map(([key, list]) => (
            <div key={key} className="mdash-cluemx__row" role="row" data-testid={`clue-group-${key}`}>
              <span className="mdash-cluemx__case num" role="rowheader" title={key === 'legacy' ? 'Legacy case' : caseLabel(key as CaseId)}>
                {key === 'legacy' ? 'old' : CASES[key as CaseId].number}<span className="mdash-small"> n={list[0]?.of ?? 0}</span>
              </span>
              {list.slice(0, 3).map((c) => (
                <span key={c.clueId} className="mdash-cluemx__cell" role="cell" title={`${c.title}${c.location ? ` — ${c.location}` : ''}: ${c.found}/${c.of}`}>
                  <span className="mdash-cluemx__title">{c.title}</span>
                  <span className="mdash-cluemx__val"><span className="mdash-bar__track"><span style={{ width: `${Math.round((c.rate ?? 0) * 100)}%` }} /></span><b className="num">{pct(c.rate)}</b></span>
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : (
        [...groups.values()].map((list) => list.map((c) => (
          <Bar key={c.clueId} label={c.title} value={c.rate} title={c.location ? `${c.title} — ${c.location}` : c.title} note={`${c.found}/${c.of}`} />
        )))
      )}
      {!many && <p className="mdash-foot">All clues of this case: <strong>{pct100(d.allCluesPct)}</strong> · Case Solved: <strong>{pct100(d.caseSolvedPctOfFinished)}</strong> of finishers · n = {d.runs}</p>}
      <AccusationBar agg={agg} />
    </section>
  );
}

export function DetectionTrend({ agg }: { agg: DashboardAggregates }) {
  const d = agg.descriptive;
  const xs = d.detectionsLast20;
  const max = Math.max(1, ...xs);
  const alerts = d.heardAlerts + d.seenAlerts;
  return (
    <section className="mdash-card mdash-b2" aria-label="Detection trend" data-testid="detection-trend">
      <p className="caps">Hyde detections · last {xs.length || 0} runs</p>
      <div className="mdash-bars" role="img" aria-label={`Detections per run: ${xs.join(', ')}`}>
        {xs.map((v, i) => <span key={i} style={{ height: `${(v / max) * 100}%` }} title={`${v}`} />)}
        {xs.length === 0 && <span className="mdash-empty text-2">No runs yet.</span>}
      </div>
      <p className="mdash-foot">
        Per run: <strong>{num(d.detectionsPerRun)}</strong> · Heard {alerts ? pct(d.heardAlerts / alerts) : '—'} vs seen {alerts ? pct(d.seenAlerts / alerts) : '—'} · first alert median {d.medianFirstAlertS === null ? '—' : `${d.medianFirstAlertS.toFixed(0)} s`}
      </p>
    </section>
  );
}

export function DuoPopularity({ agg }: { agg: DashboardAggregates }) {
  const { characters, pokemon } = agg.descriptive.pickRate;
  const mons = [...pokemon].filter((p) => p.offered > 0).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  const row = (p: PickRate, name: string) => (
    <li key={p.id}><span>{name}{p.smallSample ? '*' : ''}</span><span className="num">{pct(p.rate)}</span><span className="mdash-small num">{p.selected}/{p.offered}</span></li>
  );
  const small = [...characters, ...pokemon].some((p) => p.offered > 0 && p.smallSample);
  const scopeSummary = agg.scope === 'all' ? agg.descriptive.combined : agg.descriptive.cases.find((c) => c.caseId === agg.scope);
  const topDuo = scopeSummary?.duos[0];
  return (
    <section className="mdash-card mdash-b3" aria-label="Duo popularity" data-testid="duo-popularity">
      <p className="caps">Pick rate when offered</p>
      <div className="mdash-two">
        <ul className="mdash-list">{characters.map((c) => row(c, nameOfChar(c.id)))}</ul>
        <ul className="mdash-list">
          {mons.slice(0, 4).map((p) => row(p, nameOfMon(p.id)))}
          {mons.length > 6 && <li className="mdash-sep">…</li>}
          {mons.length > 6 && mons.slice(-2).map((p) => row(p, nameOfMon(p.id)))}
          {mons.length > 4 && mons.length <= 6 && mons.slice(4).map((p) => row(p, nameOfMon(p.id)))}
        </ul>
      </div>
      {topDuo && <p className="mdash-small" data-testid="top-duo">Most played{agg.scope === 'all' ? '' : ' in this case'}: {nameOfChar(topDuo.characterId)} &amp; {nameOfMon(topDuo.pokemonId)} ×{topDuo.runs}</p>}
      {small && <p className="mdash-small">* small sample (offered fewer than 10 times)</p>}
    </section>
  );
}

function LayerHead({ k }: { k: (typeof LAYERS)[number]['key'] }) {
  const l = LAYERS.find((x) => x.key === k)!;
  return <p className="layer-panel__badge" style={{ ['--layer' as string]: l.color }}><Icon name={l.icon} /> {l.name} · {l.q}</p>;
}

export function DescriptiveLayer({ agg }: { agg: DashboardAggregates }) {
  const d = agg.descriptive;
  const s = d.stanceMix;
  return (
    <section className="mdash-card mdash-layer" style={{ ['--layer' as string]: LAYERS[0]!.color }} data-testid="dash-descriptive">
      <LayerHead k="descriptive" />
      <dl className="mdash-kv mdash-kv--tiles">
        <div><dt>Runs</dt><dd>{d.runs}</dd></div>
        <div><dt>Finished</dt><dd>{d.finished}</dd></div>
        <div><dt>DNF</dt><dd>{d.dnf}</dd></div>
        <div><dt>Solved</dt><dd>{pct100(d.caseSolvedPctOfFinished)}</dd></div>
        <div title={`Finishers' completion time: median ${secs(d.medianTimeS)}, mean ${secs(d.meanTimeS)}`}><dt>Median time</dt><dd>{secs(d.medianTimeS)}</dd></div>
      </dl>
      <div className="lp-stance">
        {(['crouch', 'walk', 'sprint', 'idle'] as const).map((k) => s[k] > 0 && <span key={k} className={`lp-stance__seg lp-stance__seg--${k}`} style={{ width: `${s[k] * 100}%` }} />)}
      </div>
      <p className="lp-legend">Crouch {pct(s.crouch)} · Walk {pct(s.walk)} · Sprint {pct(s.sprint)} · Still {pct(s.idle)}</p>
      <p className="mdash-foot">Mean time {secs(d.meanTimeS)} · Top powers &amp; moves: {d.topAbilities.slice(0, 3).map((a) => `${abilityName(a.abilityId)} ×${a.uses}`).join(' · ') || '—'}</p>
      {d.smallSample && <p className="mdash-small">Small sample — read with care.</p>}
    </section>
  );
}

export function DiagnosticLayer({ agg }: { agg: DashboardAggregates }) {
  const d = agg.diagnostic;
  return (
    <section className="mdash-card mdash-layer" style={{ ['--layer' as string]: LAYERS[1]!.color }} data-testid="dash-diagnostic">
      <LayerHead k="diagnostic" />
      <p className="mdash-sub">Why cases stayed unsolved ({d.unsolvedRuns} run{d.unsolvedRuns === 1 ? '' : 's'})</p>
      <ul className="mdash-list" data-testid="case-failures">
        {d.caseFailures.slice(0, 2).map((c) => <li key={`${c.code}:${c.ref ?? ''}`}><span className="lp-badge lp-badge--case">Case</span><span>{c.text}</span><span className="num">{c.count}</span></li>)}
        {d.caseFailures.length === 0 && <li className="text-2">{d.unsolvedRuns > 0 ? 'No rule-verified cause recorded yet.' : agg.descriptive.finished === 0 ? 'No finished runs yet.' : 'Every finished case was solved.'}</li>}
      </ul>
      <p className="mdash-sub">Rule-verified causes of catches / DNFs</p>
      <ul className="mdash-list">
        {d.failureCauses.slice(0, 2).map((c) => <li key={c.code}><span className="lp-badge lp-badge--cause">Cause</span><span>{c.text}</span><span className="num">{c.count}</span></li>)}
        {d.failureCauses.length === 0 && <li className="text-2">No catches recorded.</li>}
      </ul>
      <p className="mdash-sub">Patterns (correlation, not proof)</p>
      <ul className="mdash-list">
        {d.patterns.slice(0, 1).map((p) => <li key={p.code}><span className="lp-badge lp-badge--pattern">≈ Pattern</span><span>{p.text}</span><span className="num">{p.numerator}/{p.denominator}</span></li>)}
        {d.patterns.length === 0 && <li className="text-2">Not enough runs for a pattern.</li>}
      </ul>
    </section>
  );
}

export function PredictiveLayer({ agg }: { agg: DashboardAggregates }) {
  const c = agg.predictive.card;
  const live = agg.predictive.live;
  const bins = c.calibration;
  return (
    <section className="mdash-card mdash-layer" style={{ ['--layer' as string]: LAYERS[2]!.color }} data-testid="dash-predictive">
      <LayerHead k="predictive" />
      {c.source === 'ml' ? (
        <div className="mdash-model" data-testid="model-card">
          <dl className="mdash-kv mdash-kv--model">
            <div><dt>Model</dt><dd title={c.modelType ?? ''}>{c.modelType ?? '—'}</dd></div>
            <div><dt>Target</dt><dd title={c.target}>Detected within 15 s</dd></div>
            <div><dt>Data</dt><dd title={c.split ?? ''}>{c.episodes ?? '—'} simulated episodes · 3 cases</dd></div>
            <div><dt>Holdout</dt><dd title={c.split ?? ''}>{c.split && /session/i.test(c.split) ? 'session-grouped' : c.split ?? '—'}{c.sessionsTest ? ` · ${c.sessionsTest} sessions` : ''}</dd></div>
            <div><dt>Base rate</dt><dd className="num">{pct(c.baseRate, 1)}</dd></div>
            <div><dt>Brier</dt><dd className="num">{num(c.brier, 3)} <span className="mdash-small">vs {num(c.baselineBrier, 3)} base-rate</span></dd></div>
          </dl>
          <Reliability bins={bins} />
          <p className="mdash-small">{c.note || 'Validated on simulated data; live outcomes shown separately.'}</p>
        </div>
      ) : (
        <p className="text-2" data-testid="model-card">No trained model — stations show Rule-based risk estimate.{c.invalidReason ? ` (${c.invalidReason})` : ''}</p>
      )}
      <p className="mdash-small">Live check{agg.scope === 'all' ? '' : ` (Case ${CASES[agg.scope].number})`}: {live.n} forecast{live.n === 1 ? '' : 's'} observed{live.brier !== null ? ` · Brier ${live.brier.toFixed(3)}` : ''} — {live.note}</p>
    </section>
  );
}

/** 10-bin reliability diagram: predicted vs observed, diagonal = perfect calibration. */
function Reliability({ bins }: { bins: { lower: number; upper: number; count: number; meanPredicted: number; observedRate: number }[] }) {
  const s = 70;
  return (
    <svg className="mdash-rel" viewBox={`0 0 ${s + 10} ${s + 10}`} role="img" aria-label="Reliability diagram (predicted vs observed)" data-testid="reliability">
      <rect x="5" y="5" width={s} height={s} className="mdash-rel__frame" />
      <line x1="5" y1={s + 5} x2={s + 5} y2="5" className="mdash-rel__diag" />
      {bins.filter((b) => b.count > 0).map((b, i) => (
        <circle key={i} cx={5 + b.meanPredicted * s} cy={s + 5 - b.observedRate * s} r={Math.min(4, 1.5 + Math.log10(b.count + 1))} className="mdash-rel__pt" />
      ))}
    </svg>
  );
}

export function PrescriptiveLayer({ agg }: { agg: DashboardAggregates }) {
  const p = agg.prescriptive;
  return (
    <section className="mdash-card mdash-layer" style={{ ['--layer' as string]: LAYERS[3]!.color }} data-testid="dash-prescriptive">
      <LayerHead k="prescriptive" />
      <p className="mdash-foot">Advice given <strong>{p.given}</strong> · uptake <strong>{pct100(p.uptakePct)}</strong></p>
      <ul className="mdash-list">
        {p.byAction.slice(0, 4).map((a) => <li key={a.action}><span>{a.action.replace(/_/g, ' ')}</span><span className="num">{a.given}</span><span className="mdash-small">followed {pct100(a.followedPct)}</span></li>)}
        {p.byAction.length === 0 && <li className="text-2">No advice yet.</li>}
      </ul>
      <p className="mdash-small">Undetected 15 s after: followed {pct100(p.undetectedAfterFollowedPct)} vs not {pct100(p.undetectedAfterNotFollowedPct)} — {p.note}</p>
    </section>
  );
}
