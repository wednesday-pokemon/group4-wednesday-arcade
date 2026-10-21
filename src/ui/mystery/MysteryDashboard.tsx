// MysteryDashboard (UX_MYSTERY §8) — Laptop 1, LOCAL DEMO. 12-col grid:
//   A  StationLiveCard (this station) · Station B (live backend) · StandingsPanel
//   B  ClueSolvePanel · DetectionTrendPanel · DuoPopularityPanel
//   C  the four analytics: Descriptive · Diagnostic · Predictive (ModelCard + reliability diagram) · Prescriptive
// Presents ONLY what src/mystery/analytics aggregated. Never shows seeds, the culprit or who anyone accused.
// The row B/C panels are exported for the LIVE board (src/app/mystery/liveDashboard.tsx), which feeds them server rows.
import type { DashboardAggregates, PickRate } from '../../mystery/analytics/index.ts';
import { NIGHTSHADES } from '../../mystery/data/nightshades.ts';
import { PARTNERS } from '../../mystery/data/partners.ts';
import type { LivePhase, LiveStatus, StoredRecord } from '../../app/mystery/records.ts';
import { HeaderTools } from '../components/HeaderTools.tsx';
import { Icon } from '../Icon.tsx';
import { LAYERS } from './LayerPanels.tsx';

interface Props {
  records: StoredRecord[];
  live: LiveStatus | null;
  now: number;
  agg: DashboardAggregates;
  clues: { id: string; title: string }[];
}

const pct = (x: number | null | undefined, digits = 0) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(digits)}%`);
/** For the aggregates' *Pct fields, which are already 0–100. */
const pct100 = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${Math.round(x)}%`);
const num = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? '—' : x.toFixed(d));
const nameOfChar = (id: string) => NIGHTSHADES[id as keyof typeof NIGHTSHADES]?.shortName ?? id;
const nameOfMon = (id: string) => PARTNERS[id as keyof typeof PARTNERS]?.name ?? id;
const abilityName = (id: string) =>
  Object.values(NIGHTSHADES).find((n) => n.power.id === id)?.power.name ?? Object.values(PARTNERS).find((p) => p.move.id === id)?.move.name ?? id;

const PHASE_TEXT: Record<LivePhase, string> = {
  idle: 'Idle', name: 'Name entry', duo: 'Choosing duo', tutorial: 'Tutorial', investigating: 'Investigating',
  carrying: 'Carrying egg', accusing: 'Accusing', results: 'Results', dnf: 'DNF',
};
const SIGNAL_LOST_MS = 15000;

export function MysteryDashboard({ records, live, now, agg, clues }: Props) {
  return (
    <main className="mdash" data-testid="mystery-dashboard">
      <header className="mdash__head">
        <h1 className="display mdash__title">Raven Island · Control Center</h1>
        <span className="mdash__chip">mystery-v3.1</span>
        <span className="mdash__chip mdash__chip--demo">LOCAL DEMO · this browser only</span>
        <span className="text-2 mdash__count">{records.length} session{records.length === 1 ? '' : 's'}</span>
        <HeaderTools mode="local_demo" />
      </header>

      <div className="mdash__grid">
        <StationLiveCard live={live} now={now} />
        <section className="mdash-card mdash-card--muted mdash-a2" aria-label="Station B">
          <p className="caps">Station B</p>
          <p className="text-2">Both stations appear here live once the Supabase backend is deployed (Realtime). This demo reads only the sessions played in this browser.</p>
        </section>
        <Standings records={records} />

        <ClueSolve agg={agg} clues={clues} />
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

function StationLiveCard({ live, now }: { live: LiveStatus | null; now: number }) {
  if (!live) {
    return (
      <section className="mdash-card mdash-a1" data-testid="station-live">
        <p className="caps">This station</p>
        <p className="mdash-phase mdash-phase--idle">Idle</p>
        <p className="text-2">No visitor yet.</p>
      </section>
    );
  }
  const age = Math.max(0, Math.round((now - live.updatedAt) / 1000));
  const active = !['idle', 'results', 'dnf'].includes(live.phase);
  const lost = active && now - live.updatedAt > SIGNAL_LOST_MS;
  return (
    <section className="mdash-card mdash-a1" data-testid="station-live" data-phase={lost ? 'lost' : live.phase}>
      <div className="mdash-row">
        <p className="caps">This station</p>
        <span className={`mdash-phase mdash-phase--${lost ? 'lost' : live.phase}`}>{lost ? 'Signal lost' : PHASE_TEXT[live.phase]}</span>
      </div>
      <p className="mdash-station__who"><strong>{live.nickname || '—'}</strong>{live.duo && <> · {nameOfChar(live.duo.characterId)} &amp; {nameOfMon(live.duo.pokemonId)}</>}</p>
      <dl className="mdash-kv">
        <div><dt>Clues</dt><dd>{[0, 1, 2].map((i) => <span key={i} className={`mdash-pip${i < live.clues ? ' is-on' : ''}`} />)}</dd></div>
        <div><dt>Egg</dt><dd>{live.egg ? `${live.egg.tier ?? 'not found'}${live.egg.tier ? ` · ${live.egg.security}` : ''}` : '—'}</dd></div>
        <div><dt>HP · caught</dt><dd className="num">{live.hp ?? '—'} · {live.catches ?? '—'}/2</dd></div>
        <div><dt>Hyde</dt><dd>{live.hydeMode ?? '—'}</dd></div>
        <div><dt>Risk</dt><dd className="num">{live.risk ? `${live.risk.p.toFixed(2)} · ${live.risk.label === 'ML estimate' ? 'ML' : 'Rule-based'}` : '—'}</dd></div>
        <div><dt>Time</dt><dd className="num">{live.activeTimeS !== null ? `${live.activeTimeS.toFixed(1)} s` : '—'}</dd></div>
      </dl>
      {live.advice && <p className="mdash-advice">Thing: “{live.advice.text}” {live.advice.followed === null ? '' : live.advice.followed ? '· followed' : '· not followed'}</p>}
      <p className="mdash-age text-2">updated {age} s ago</p>
    </section>
  );
}

function Standings({ records }: { records: StoredRecord[] }) {
  const finished = records.filter((r) => r.record.result?.outcome === 'finished' && r.record.result.score !== null)
    .sort((a, b) => (b.record.result!.score! - a.record.result!.score!) || (a.record.result!.activeTimeS - b.record.result!.activeTimeS));
  const dnf = records.filter((r) => r.record.result?.outcome === 'dnf');
  return (
    <section className="mdash-card mdash-a3" aria-label="Standings" data-testid="standings">
      <p className="caps">Standings · mystery-v3.1</p>
      {finished.length === 0 ? <p className="text-2">No finishers yet.</p> : (
        <ol className="mdash-standings">
          {finished.slice(0, 7).map((r, i) => (
            <li key={r.record.sessionId}>
              <span className="num mdash-rank">{i + 1}</span>
              <span className="mdash-name">{r.nickname}</span>
              <span className="text-2 mdash-duo">{r.record.duo ? `${nameOfChar(r.record.duo.characterId)} & ${nameOfMon(r.record.duo.pokemonId)}` : ''}</span>
              <span className="num mdash-score">{r.record.result!.score!.toFixed(1)}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="mdash-dnf text-2">Did not finish — unranked ({dnf.length})</p>
    </section>
  );
}

function Bar({ label, value, note }: { label: string; value: number | null; note?: string }) {
  return (
    <div className="mdash-bar">
      <span className="mdash-bar__label">{label}</span>
      <span className="mdash-bar__track"><span style={{ width: `${Math.round((value ?? 0) * 100)}%` }} /></span>
      <span className="num mdash-bar__value">{pct(value)}{note && <span className="mdash-small"> {note}</span>}</span>
    </div>
  );
}

export function ClueSolve({ agg, clues }: { agg: DashboardAggregates; clues: { id: string; title: string }[] }) {
  const d = agg.descriptive;
  return (
    <section className="mdash-card mdash-b1" aria-label="Clue solve rates" data-testid="clue-solve">
      <p className="caps">Clues · solve rate</p>
      {clues.map((c) => <Bar key={c.id} label={c.title} value={d.clueFindRate[c.id] ?? null} />)}
      <p className="mdash-foot">All three: <strong>{pct100(d.allThreePct)}</strong> · Case Solved: <strong>{pct100(d.caseSolvedPctOfFinished)}</strong> of finishers · n = {d.runs}</p>
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
        <div><dt>Median time</dt><dd>{d.medianTimeS === null ? '—' : `${d.medianTimeS.toFixed(0)} s`}</dd></div>
      </dl>
      <div className="lp-stance">
        {(['crouch', 'walk', 'sprint', 'idle'] as const).map((k) => s[k] > 0 && <span key={k} className={`lp-stance__seg lp-stance__seg--${k}`} style={{ width: `${s[k] * 100}%` }} />)}
      </div>
      <p className="lp-legend">Crouch {pct(s.crouch)} · Walk {pct(s.walk)} · Sprint {pct(s.sprint)} · Still {pct(s.idle)}</p>
      <p className="mdash-foot">Top F/Q: {d.topAbilities.slice(0, 3).map((a) => `${abilityName(a.abilityId)} ×${a.uses}`).join(' · ') || '—'}</p>
      {d.smallSample && <p className="mdash-small">Small sample — read with care.</p>}
    </section>
  );
}

export function DiagnosticLayer({ agg }: { agg: DashboardAggregates }) {
  const d = agg.diagnostic;
  return (
    <section className="mdash-card mdash-layer" style={{ ['--layer' as string]: LAYERS[1]!.color }} data-testid="dash-diagnostic">
      <LayerHead k="diagnostic" />
      <p className="mdash-sub">Rule-verified causes of catches / DNFs</p>
      <ul className="mdash-list">
        {d.failureCauses.slice(0, 3).map((c) => <li key={c.code}><span className="lp-badge lp-badge--cause">Cause</span><span>{c.text}</span><span className="num">{c.count}</span></li>)}
        {d.failureCauses.length === 0 && <li className="text-2">No catches recorded.</li>}
      </ul>
      <p className="mdash-sub">Patterns (correlation, not proof)</p>
      <ul className="mdash-list">
        {d.patterns.slice(0, 2).map((p) => <li key={p.code}><span className="lp-badge lp-badge--pattern">≈ Pattern</span><span>{p.text}</span><span className="num">{p.numerator}/{p.denominator}</span></li>)}
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
            <div><dt>Data</dt><dd title={c.split ?? ''}>{c.episodes ?? '—'} simulated episodes</dd></div>
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
      <p className="mdash-small">Live check: {live.n} forecast{live.n === 1 ? '' : 's'} observed{live.brier !== null ? ` · Brier ${live.brier.toFixed(3)}` : ''} — {live.note}</p>
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
