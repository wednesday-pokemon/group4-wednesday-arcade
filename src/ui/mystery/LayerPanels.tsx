// The four game-wide analytics LayerPanels on the results screen (UX_MYSTERY §6 AnalyticsGrid). They only PRESENT
// what src/mystery/analytics computed for this run (any duo, any case): no placeholder numbers — when the report is
// missing each panel says "Analytics unavailable for this run". Clue counts are out of THIS case's clues; the
// diagnostic panel leads with why the case was not solved (incorrect deduction, missed clues by case-file title) and
// then the stealth causes. Shown after the accusation only; nothing here names a suspect.
import type { DiagnosticItem, ResultsAnalytics, TimelineMark } from '../../mystery/analytics/index.ts';
import { ThingSigil } from '../components/ThingSigil.tsx';
import { Icon, type IconName } from '../Icon.tsx';

interface Layer { key: 'descriptive' | 'diagnostic' | 'predictive' | 'prescriptive'; name: string; q: string; icon: IconName; color: string }

export const LAYERS: Layer[] = [
  { key: 'descriptive', name: 'Descriptive', q: 'What happened?', icon: 'barChart', color: '#d4cbb5' },
  { key: 'diagnostic', name: 'Diagnostic', q: 'Why?', icon: 'link', color: '#b3a8ff' },
  { key: 'predictive', name: 'Predictive', q: 'What was likely?', icon: 'gauge', color: '#5cc0e6' },
  { key: 'prescriptive', name: 'Prescriptive', q: 'What did Thing advise?', icon: 'signpost', color: '#6fd6a0' },
];

export function LayerPanels({ report }: { report: ResultsAnalytics | null }) {
  return (
    <section className="mys-analytics" aria-label="The four analytics">
      {LAYERS.map((l) => (
        <article key={l.key} className="layer-panel" style={{ ['--layer' as string]: l.color }} data-testid={`analytics-${l.key}`} data-filled={report ? true : undefined}>
          <p className="layer-panel__badge">
            {l.key === 'prescriptive' ? <ThingSigil size={24} pose="point" label="Thing" /> : <Icon name={l.icon} />} {l.name}
          </p>
          <h2 className="layer-panel__q">{l.q}</h2>
          {!report ? (
            <p className="layer-panel__empty text-2">Analytics unavailable for this run</p>
          ) : l.key === 'descriptive' ? (
            <Descriptive r={report} />
          ) : l.key === 'diagnostic' ? (
            <Diagnostic r={report} />
          ) : l.key === 'predictive' ? (
            <Predictive r={report} />
          ) : (
            <Prescriptive r={report} />
          )}
        </article>
      ))}
    </section>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
/** m:ss (same format as the analytics' fmtT; inlined so the results screen does not pull the analytics bundle). */
function fmtT(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Descriptive({ r }: { r: ResultsAnalytics }) {
  const d = r.descriptive;
  const tiles: [string, string][] = [
    ['Time', `${d.activeTimeS.toFixed(1)} s`],
    ['Clues', `${d.clues.count}/${d.clues.total}`],
    ['Chases', String(d.hyde.chases)],
    ['Caught', `${d.catches}/2`],
    ['Egg security', d.egg.security === null ? '—' : String(Math.round(d.egg.security))],
    ['Hints', String(d.hints)],
  ];
  const share = d.stanceShare;
  const segs: [keyof typeof share, string][] = [['crouch', 'Crouch'], ['walk', 'Walk'], ['sprint', 'Sprint'], ['idle', 'Still']];
  return (
    <div className="lp-desc">
      <dl className="lp-tiles">
        {tiles.map(([k, v]) => (
          <div key={k} className="lp-tile"><dt>{k}</dt><dd className="num">{v}</dd></div>
        ))}
      </dl>
      <div className="lp-stance" role="img" aria-label={`Stance mix: ${segs.map(([k, n]) => `${n} ${pct(share[k])}`).join(', ')}`}>
        {segs.map(([k]) => share[k] > 0 && <span key={k} className={`lp-stance__seg lp-stance__seg--${k}`} style={{ width: `${share[k] * 100}%` }} />)}
      </div>
      <p className="lp-legend">{segs.filter(([k]) => share[k] > 0).map(([k, n]) => `${n} ${pct(share[k])}`).join(' · ')}</p>
      <p className="lp-line">
        <kbd className="kcap">F</kbd> {d.abilities.F.name ?? 'Power'} ×{d.abilities.F.uses} · <kbd className="kcap">Q</kbd> {d.abilities.Q.name ?? 'Move'} ×{d.abilities.Q.uses}
      </p>
    </div>
  );
}

const MARK_GLYPH: Record<TimelineMark['kind'], { shape: 'dot' | 'diamond' | 'bar' | 'tri'; cls: string }> = {
  heard: { shape: 'dot', cls: 'warn' }, investigate: { shape: 'dot', cls: 'warn' }, search: { shape: 'dot', cls: 'warn' },
  chase: { shape: 'tri', cls: 'hyde' }, catch: { shape: 'bar', cls: 'hyde' }, clue: { shape: 'diamond', cls: 'good' },
  egg_pickup: { shape: 'diamond', cls: 'egg' }, egg_drop: { shape: 'bar', cls: 'warn' }, deposit: { shape: 'diamond', cls: 'egg' },
  ability: { shape: 'dot', cls: 'accent' }, hint: { shape: 'dot', cls: 'accent' }, end: { shape: 'bar', cls: 'muted' },
};

/** Case-rule rows: the accusation outcome, then ONE row listing every missed clue of the case (by title). */
function caseRows(r: ResultsAnalytics): DiagnosticItem[] {
  const items = r.diagnostic.caseReasons ?? [];
  const outcome = items.filter((it) => it.code !== 'missed_clue');
  const missed = items.filter((it) => it.code === 'missed_clue');
  if (missed.length === 0) return outcome;
  const titles = r.descriptive.clues.missing.map((m) => `“${m.title}”`);
  const t = missed[0]!.t;
  const text = `${fmtT(t)} · Missed ${titles.length === 1 ? 'clue' : `${titles.length} clues`}: ${titles.join(', ')} — a solved case needs all ${r.descriptive.clues.total}.`;
  return [...outcome, { ...missed[0]!, text, evidenceSeq: missed[0]!.evidenceSeq }];
}

function Diagnostic({ r }: { r: ResultsAnalytics }) {
  const d = r.diagnostic;
  const end = Math.max(1, r.descriptive.activeTimeS, ...d.timeline.map((m) => m.t));
  const cases = caseRows(r);
  const room = Math.max(1, 4 - cases.length);
  const causes = d.top.slice(0, d.topPattern ? Math.max(0, room - 1) : room);
  const rows = [...cases, ...causes, ...(d.topPattern && causes.length < room ? [d.topPattern] : [])].slice(0, 4);
  return (
    <div className="lp-diag">
      <svg className="lp-timeline" viewBox="0 0 380 40" preserveAspectRatio="none" role="img" aria-label="Timeline of this run" data-testid="diag-timeline">
        <line x1="0" y1="20" x2="380" y2="20" className="lp-axis" />
        {d.timeline.map((m) => {
          const x = 4 + (m.t / end) * 372;
          const g = MARK_GLYPH[m.kind];
          return g.shape === 'dot' ? <circle key={m.seq} cx={x} cy={20} r={3} className={`lp-m lp-m--${g.cls}`} />
            : g.shape === 'diamond' ? <rect key={m.seq} x={x - 3.5} y={16.5} width={7} height={7} transform={`rotate(45 ${x} 20)`} className={`lp-m lp-m--${g.cls}`} />
            : g.shape === 'tri' ? <path key={m.seq} d={`M${x} 9 L${x + 5} 18 L${x - 5} 18 Z`} className={`lp-m lp-m--${g.cls}`} />
            : <rect key={m.seq} x={x - 1} y={8} width={2} height={24} className={`lp-m lp-m--${g.cls}`} />;
        })}
      </svg>
      {rows.length === 0 ? (
        <p className="lp-line text-2">Case solved and no Hyde alerts were caused this run.</p>
      ) : (
        <ul className="lp-rows">
          {rows.map((it) => (
            <li key={`${it.kind}-${it.t}-${it.code}`} className="lp-row" data-kind={it.kind}>
              <span className={`lp-badge lp-badge--${it.kind}`}>{it.kind === 'cause' ? 'Cause' : it.kind === 'case' ? 'Case' : '≈ Pattern'}</span>
              {/* the service's text already starts with the m:ss time */}
              <span className="lp-row__text">{it.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Predictive({ r }: { r: ResultsAnalytics }) {
  const p = r.predictive;
  const end = Math.max(1, r.descriptive.activeTimeS, ...p.series.map((s) => s.t));
  const x = (t: number) => (t / end) * 380;
  const y = (v: number) => 86 - v * 80;
  const pts = p.series.map((s) => `${x(s.t).toFixed(1)},${y(s.p).toFixed(1)}`).join(' ');
  return (
    <div className="lp-pred">
      <svg className="lp-spark" viewBox="0 0 380 90" preserveAspectRatio="none" role="img" aria-label="Detection risk over the run" data-testid="pred-sparkline">
        <rect x="0" y={y(1)} width="380" height={y(0.66) - y(1)} className="lp-band-high" />
        <text x="4" y={y(1) + 11} className="lp-band-label">High</text>
        <line x1="0" y1={y(0)} x2="380" y2={y(0)} className="lp-axis" />
        {pts && <polyline points={pts} className="lp-spark__line" />}
        {p.detections.map((t, i) => <path key={i} d={`M${x(t)} ${y(0) + 2} l0 -10`} className="lp-tick" />)}
      </svg>
      <p className="lp-label" data-testid="pred-label">{p.label}</p>
    </div>
  );
}

function Prescriptive({ r }: { r: ResultsAnalytics }) {
  const p = r.prescriptive;
  return (
    <div className="lp-presc">
      {p.rows.length > 0 && (
        <ul className="lp-rows">
          {p.rows.slice(-3).map((row) => (
            <li key={`${row.t}-${row.action}`} className="lp-row">
              <span className="num">{fmtT(row.t)}</span>
              <span className="lp-row__text">{row.text}</span>
              <span className={`lp-status lp-status--${row.status.replace(/ /g, '-').toLowerCase()}`}>{row.status}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="lp-line" data-testid="presc-summary">{p.summary.text}</p>
      <p className="lp-engine">Advice from a {p.engine}.</p>
    </div>
  );
}
