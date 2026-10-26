// The four game-wide analytics LayerPanels on the results screen (UX_MYSTERY §6 AnalyticsGrid). They only PRESENT
// what src/mystery/analytics computed for this run (any duo, any case): no placeholder numbers — when the report is
// missing each panel says "Analytics unavailable for this run". Clue counts are out of THIS case's clues; the
// diagnostic panel leads with why the case was not solved (incorrect deduction, missed clues by case-file title) and
// then the stealth causes. Shown after the accusation only; nothing here names a suspect.
// Final wave (UX_FINAL §6): the descriptive tiles are TIME · CLUES · SEEN · HITS · HINTS · EGG — Seen / Hits / Hints are
// the run's RULE-event counts (RunResult.detections / hits / hintsUsed); "—" when the run does not carry them.
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { DiagnosticItem, ResultsAnalytics, TimelineMark } from '../../mystery/analytics/index.ts';
import { adviceScorecard, lostPts, predictionSummary } from '../../mystery/analytics/insights.ts';
import { ABILITY_KEY_LABEL, type RunResult } from '../../mystery/types.ts';
import { ThingSigil } from '../components/ThingSigil.tsx';
import { Icon, type IconName } from '../Icon.tsx';

interface Layer { key: 'descriptive' | 'diagnostic' | 'predictive' | 'prescriptive'; name: string; q: string; icon: IconName; color: string }

export const LAYERS: Layer[] = [
  { key: 'descriptive', name: 'Descriptive', q: 'What happened?', icon: 'barChart', color: '#d4cbb5' },
  { key: 'diagnostic', name: 'Diagnostic', q: 'Why?', icon: 'link', color: '#b3a8ff' },
  { key: 'predictive', name: 'Predictive', q: 'What was likely?', icon: 'gauge', color: '#5cc0e6' },
  { key: 'prescriptive', name: 'Prescriptive', q: 'What did Thing advise?', icon: 'signpost', color: '#6fd6a0' },
];

/** The run's v4 tally (optional: older callers pass only the report). */
export type ResultTally = Partial<Pick<RunResult, 'detections' | 'hits' | 'hintsUsed'>>;

export function LayerPanels({ report, result = null }: { report: ResultsAnalytics | null; result?: ResultTally | null }) {
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
            <Descriptive r={report} tally={result} />
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

/** Egg status word for the tile (delivered / carried / dropped / not found). */
function eggWord(d: ResultsAnalytics['descriptive']): string {
  if (d.egg.delivered) return 'Delivered';
  if (d.egg.pickupT === null) return 'Not found';
  const lastDrop = d.egg.drops.length ? d.egg.drops[d.egg.drops.length - 1]!.t : -1;
  return lastDrop >= d.egg.pickupT ? 'Dropped' : 'Carried';
}

function Descriptive({ r, tally }: { r: ResultsAnalytics; tally: ResultTally | null }) {
  const d = r.descriptive;
  const count = (v: number | undefined) => (typeof v === 'number' ? String(v) : '—');
  const tiles: [string, string][] = [
    ['Time', fmtT(d.activeTimeS)],
    ['Clues', `${d.clues.count}/${d.clues.total}`],
    ['Seen', count(tally?.detections)],
    ['Hits', count(tally?.hits)],
    ['Hints', typeof tally?.hintsUsed === 'number' ? String(tally.hintsUsed) : String(d.hints)],
    ['Egg', eggWord(d)],
  ];
  const share = d.stanceShare;
  const segs: [keyof typeof share, string][] = [['crouch', 'Crouch'], ['walk', 'Walk'], ['sprint', 'Sprint'], ['idle', 'Still']];
  return (
    <div className="lp-desc">
      <dl className="lp-tiles">
        {tiles.map(([k, v]) => (
          <div key={k} className="lp-tile" data-testid={`lp-tile-${k.toLowerCase()}`}><dt>{k}</dt><dd className="num">{v}</dd></div>
        ))}
      </dl>
      <div className="lp-stance" role="img" aria-label={`Stance mix: ${segs.map(([k, n]) => `${n} ${pct(share[k])}`).join(', ')}`}>
        {segs.map(([k]) => share[k] > 0 && <span key={k} className={`lp-stance__seg lp-stance__seg--${k}`} style={{ width: `${share[k] * 100}%` }} />)}
      </div>
      <p className="lp-legend">{segs.filter(([k]) => share[k] > 0).map(([k, n]) => `${n} ${pct(share[k])}`).join(' · ')}</p>
      <p className="lp-line" data-testid="lp-abilities">
        <AbilityUses slot="F" name={d.abilities.F.name ?? 'Power'} uses={d.abilities.F.uses} /> · <AbilityUses slot="Q" name={d.abilities.Q.name ?? 'Move'} uses={d.abilities.Q.uses} />
      </p>
    </div>
  );
}

/** "Q Wolf Shift 2 uses" — the key the player pressed (ABILITY_KEY_LABEL), never the F slot id. */
function AbilityUses({ slot, name, uses }: { slot: 'F' | 'Q'; name: string; uses: number }) {
  return (
    <span className="lp-ability">
      <kbd className="kcap">{ABILITY_KEY_LABEL[slot]}</kbd> {name} <span className="num">{uses}</span> {uses === 1 ? 'use' : 'uses'}
    </span>
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

/**
 * Analytics v2: the panel shows case reasons, then "Why you lost points" (≤ 5 one-line items, biggest first), then the
 * stealth causes + pattern. Its height depends on the screen and the case text below, so whole rows that would not fit
 * are dropped (pattern first, then causes, then the smallest points-lost items, cases last) — the panel never clips.
 * `data-drop` ranks the order (lower = dropped first); SSR / tests render every row.
 */
export function diagnosticDropRanks(nCases: number, nLost: number, nCauses: number, pattern: boolean): { cases: number[]; lost: number[]; causes: number[]; pattern: number | null } {
  return {
    pattern: pattern ? 0 : null,
    causes: Array.from({ length: nCauses }, (_, i) => 1 + (nCauses - 1 - i)),
    lost: Array.from({ length: nLost }, (_, i) => 100 + (nLost - 1 - i)),
    cases: Array.from({ length: nCases }, (_, i) => 200 + (nCases - 1 - i)),
  };
}

/** Layout effect in the browser, plain effect under SSR (static markup in tests renders every row). */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Drops `[data-drop]` rows (lowest rank first) until the content ends inside the layer panel; refits on resize. */
function useFitRows(ref: RefObject<HTMLDivElement | null>, key: string): void {
  useIsoLayoutEffect(() => {
    const root = ref.current;
    const panel = root?.closest<HTMLElement>('.layer-panel');
    if (!root || !panel) return;
    const fit = () => {
      const els = [...root.querySelectorAll<HTMLElement>('[data-drop]')];
      for (const e of els) e.style.display = '';
      const head = root.querySelector<HTMLElement>('.lp-lost__head');
      if (head) head.style.display = '';
      const limit = () => panel.getBoundingClientRect().bottom - (parseFloat(getComputedStyle(panel).paddingBottom) || 0) + 0.5;
      const bottom = () => Math.max(0, ...[...root.children].flatMap((c) => [c, ...c.querySelectorAll<HTMLElement>('li, p')])
        .filter((x) => (x as HTMLElement).style.display !== 'none').map((x) => x.getBoundingClientRect().bottom));
      for (const e of els.sort((a, b) => Number(a.dataset.drop) - Number(b.dataset.drop))) {
        if (bottom() <= limit()) break;
        e.style.display = 'none';
      }
      if (head) head.style.display = root.querySelector('.lp-row--lost:not([style*="none"])') ? '' : 'none';
    };
    fit();
    // refit once the web fonts are in (the first pass may run with fallback metrics) and whenever the panel resizes
    let alive = true;
    void document.fonts?.ready.then(() => alive && fit());
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
    ro?.observe(panel);
    window.addEventListener('resize', fit);
    return () => {
      alive = false;
      ro?.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [ref, key]);
}

function Diagnostic({ r }: { r: ResultsAnalytics }) {
  const d = r.diagnostic;
  const end = Math.max(1, r.descriptive.activeTimeS, ...d.timeline.map((m) => m.t));
  const cases = caseRows(r);
  const lost = (d.pointsLost ?? []).slice(0, 5);
  let rows: DiagnosticItem[];
  let after: DiagnosticItem[] = [];
  if (lost.length === 0) {
    const room = Math.max(1, 4 - cases.length);
    const causes = d.top.slice(0, d.topPattern ? Math.max(0, room - 1) : room);
    rows = [...cases, ...causes, ...(d.topPattern && causes.length < room ? [d.topPattern] : [])].slice(0, 4);
  } else {
    rows = cases.slice(0, 2);
    after = [...d.top.slice(0, 3), ...(d.topPattern ? [d.topPattern] : [])];
  }
  // drop ranks over everything shown (rows = cases + causes [+ pattern] without points lost)
  const all = [...rows, ...after];
  const isCase = (it: DiagnosticItem) => it.kind === 'case';
  const causeItems = all.filter((it) => !isCase(it) && it.kind !== 'pattern');
  const ranks = diagnosticDropRanks(all.filter(isCase).length, lost.length, causeItems.length, all.some((it) => it.kind === 'pattern'));
  const rankOf = (it: DiagnosticItem) => it.kind === 'pattern' ? ranks.pattern! : isCase(it) ? ranks.cases[all.filter(isCase).indexOf(it)]! : ranks.causes[causeItems.indexOf(it)]!;
  const ref = useRef<HTMLDivElement>(null);
  useFitRows(ref, `${all.map((it) => it.code + it.t).join('|')}#${lost.map((x) => x.text).join('|')}`);
  const row = (it: DiagnosticItem) => (
    <li key={`${it.kind}-${it.t}-${it.code}`} className="lp-row" data-kind={it.kind} data-drop={rankOf(it)}>
      <span className={`lp-badge lp-badge--${it.kind}`}>{it.kind === 'cause' ? 'Cause' : it.kind === 'case' ? 'Case' : '≈ Pattern'}</span>
      {/* the service's text already starts with the m:ss time */}
      <span className="lp-row__text">{it.text}</span>
    </li>
  );
  return (
    <div className="lp-diag" ref={ref}>
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
      {rows.length === 0 && lost.length === 0 && after.length === 0 ? (
        <p className="lp-line text-2">Case solved and no Hyde alerts were caused this run.</p>
      ) : (
        <>
          {rows.length > 0 && <ul className="lp-rows">{rows.map(row)}</ul>}
          {lost.length > 0 && (
            <div data-testid="points-lost" aria-label="Why you lost points">
              <p className="lp-lost__head">Why you lost points</p>
              <ul className="lp-rows lp-rows--lost">
                {lost.map((x, i) => (
                  <li key={`${i}-${x.text}`} className="lp-row lp-row--lost" data-kind="points" data-drop={ranks.lost[i]}>
                    <span className="lp-badge lp-badge--pts num">{lostPts(x.pts)}</span>
                    <span className="lp-row__text">{x.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {after.length > 0 && <ul className="lp-rows">{after.map(row)}</ul>}
        </>
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
    <div className={`lp-pred${p.checks?.length ? ' has-checks' : ''}`}>
      <svg className="lp-spark" viewBox="0 0 380 90" preserveAspectRatio="none" role="img" aria-label="Detection risk over the run" data-testid="pred-sparkline">
        <rect x="0" y={y(1)} width="380" height={y(0.66) - y(1)} className="lp-band-high" />
        <text x="4" y={y(1) + 11} className="lp-band-label">High</text>
        <line x1="0" y1={y(0)} x2="380" y2={y(0)} className="lp-axis" />
        {pts && <polyline points={pts} className="lp-spark__line" />}
        {p.detections.map((t, i) => <path key={i} d={`M${x(t)} ${y(0) + 2} l0 -10`} className="lp-tick" />)}
      </svg>
      <p className="lp-label" data-testid="pred-label">{p.label}</p>
      <PredictionScore r={r} />
    </div>
  );
}

/** Analytics v2: how the DISPLAYED odds of the searched sites held up ("Thing's predictions: 3 of 4 right"). */
function PredictionScore({ r }: { r: ResultsAnalytics }) {
  const s = predictionSummary(r.predictive.checks);
  if (!s) return null;
  return (
    <p className="lp-line lp-score" data-testid="results-predictions" title="Right = shown ≥ 50% and found, or < 50% and empty">
      {s.text}{s.calibration && <span className="lp-score__cal"> · {s.calibration}</span>}
    </p>
  );
}

function Prescriptive({ r }: { r: ResultsAnalytics }) {
  const p = r.prescriptive;
  // analytics v2: compact scorecard from the follow-up records (after, never "because"); none → the summary sentence
  const score = adviceScorecard(p.summary);
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
      {score ? (
        <p className="lp-line lp-score" data-testid="results-advice-card"><span className="lp-score__k">Thing&rsquo;s advice</span> {score}</p>
      ) : (
        <p className="lp-line" data-testid="presc-summary">{p.summary.text}</p>
      )}
      <p className="lp-engine">Advice from a {p.engine}.</p>
    </div>
  );
}
