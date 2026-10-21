// Horizontal additive time waterfall (UX_SPEC Waterfall chart). Uses buildWaterfall(), which throws when
// the rows do not reconstruct the leg time exactly. An sr-only table lists every step, zeros included.
import { useId } from 'react';
import { formatSeconds, type TimeBreakdown } from '../../game/index.ts';
import { buildWaterfall, type WaterfallStep } from '../../analytics/diagnostics.ts';
import { fmtDS, fmtS } from '../format.ts';

const SPOKEN: Record<WaterfallStep['key'], string> = {
  base: 'base', savings: 'for speed', weather: 'weather', crash: 'crash', egg: 'egg pickup', hyde: 'Hyde catch',
  floor: 'minimum time adjustment', total: 'total',
};

const SOURCE_LABEL: Record<string, string> = {
  push: 'Push', bianca: 'Bianca', gomez: 'Gomez', dragapult: 'Dragapult', drifblim: 'Drifblim',
  basculegion: 'Basculegion', ceruledge: 'Ceruledge', yoko: 'Yoko', galarian_corsola: 'Corsola',
};

function describe(steps: WaterfallStep[]): string {
  const parts = steps.filter((s) => s.key !== 'total' && (s.key === 'base' || s.deltaCs !== 0)).map((s) => {
    if (s.key === 'base') return `Base ${formatSeconds(s.deltaCs)} seconds`;
    return `${s.deltaCs < 0 ? 'minus' : 'plus'} ${formatSeconds(Math.abs(s.deltaCs))} ${SPOKEN[s.key]}`;
  });
  const total = steps[steps.length - 1];
  return `${parts.join(', ')}, equals ${formatSeconds(total.runningCs)} seconds.`;
}

export function Waterfall({ time, title = 'Time breakdown' }: { time: TimeBreakdown; title?: string }) {
  const titleId = useId();
  const descId = useId();
  const steps = buildWaterfall(time);
  const maxCs = Math.max(...steps.map((s) => s.runningCs), time.baseCs, 1);
  const visible = steps.filter((s) => s.key === 'base' || s.key === 'total' || s.deltaCs !== 0);
  const sources = time.discountSources.map((d) => `${SOURCE_LABEL[d.source] ?? d.source} ${d.pct}%`).join(' · ');

  let prev = 0;
  const rows = visible.map((s) => {
    const before = s.key === 'total' || s.key === 'base' ? 0 : prev;
    const after = s.runningCs;
    if (s.key !== 'total') prev = after;
    const from = Math.min(before, after);
    const to = Math.max(before, after);
    return { s, left: (from / maxCs) * 100, width: Math.max(0.6, ((to - from) / maxCs) * 100) };
  });

  return (
    <figure className="waterfall">
      <figcaption id={titleId} className="caps">{title}</figcaption>
      <div className="waterfall__chart" role="img" aria-labelledby={titleId} aria-describedby={descId} data-testid="waterfall">
        {rows.map(({ s, left, width }) => (
          <div key={s.key} className={`wf-row wf-row--${s.key}`}>
            <span className="wf-row__label">
              {s.key === 'savings' ? `Speed savings ${time.discountPct}%` : shortLabel(s)}
              {s.key === 'savings' && sources && <span className="wf-row__sub">{sources}</span>}
            </span>
            <span className="wf-row__track">
              <span className="wf-row__bar" style={{ left: `${left}%`, width: `${width}%` }} />
            </span>
            <span className="wf-row__value num">{s.key === 'base' || s.key === 'total' ? fmtS(s.deltaCs) : fmtDS(s.deltaCs)}</span>
          </div>
        ))}
      </div>
      <p id={descId} className="sr-only">{describe(steps)}</p>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr><th scope="col">Step</th><th scope="col">Change</th><th scope="col">Running total</th></tr>
        </thead>
        <tbody>
          {fullSteps(time).map((r) => (
            <tr key={r.label}><th scope="row">{r.label}</th><td>{r.change}</td><td>{r.running}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function shortLabel(s: WaterfallStep): string {
  const labels: Record<WaterfallStep['key'], string> = {
    base: 'Base time', savings: 'Speed savings', weather: 'Weather', crash: 'Crash', egg: 'Egg pickup',
    hyde: 'Hyde catch', floor: '10 s minimum', total: 'Leg time',
  };
  return labels[s.key];
}

/** Every row including zero ones, for the accessible table. */
function fullSteps(t: TimeBreakdown) {
  const parts: [string, number][] = [
    ['Base time', t.baseCs], [`Speed savings ${t.discountPct}%`, -t.speedSavingsCs], ['Weather', t.weatherDelayCs],
    ['Crash', t.crashDelayCs], ['Egg pickup', t.eggDelayCs], ['Hyde catch', t.hydeDelayCs], ['10 s minimum', t.floorAdjustmentCs],
  ];
  let run = 0;
  const rows = parts.map(([label, delta], i) => {
    run += delta;
    return { label, change: i === 0 ? fmtS(delta) : fmtDS(delta), running: fmtS(run) };
  });
  return [...rows, { label: 'Leg time', change: fmtS(t.totalCs), running: fmtS(t.totalCs) }];
}
