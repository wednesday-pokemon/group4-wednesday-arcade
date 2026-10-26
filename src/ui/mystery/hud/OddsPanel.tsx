// Odds panel v3 (docs/final/UX_FINAL.md §1c, 256×≤184 at 1094,292): "DANGER SOON" title (gauge, cyan caps), one line per
// monster (icon 16 | label 72 | bar 48 | % 40 right tabular | band 52) — Hyde red + 45° hatch, Crackstone green stipple,
// Slurp orchid + 0° line hatch — then the objective row on two lines (tag + name / bar 56 + % + band, delta chip), and
// the footer grouped by source. Facts are words; "Away" is muted with no bar. Rendered ≤ 1 Hz (the view object changes
// once a second); monster rows crossfade, only row 4 tweens + shows deltas. Horizons live in the aria-labels.
import { memo } from 'react';
import type { OddsV3Row, OddsV3View } from '../../../app/mystery/hud/oddsV3.ts';
import { Icon } from '../../Icon.tsx';
import { HudIcon } from './HudIcon.tsx';

export const OddsPanel = memo(function OddsPanel({ odds }: { odds: OddsV3View }) {
  if (odds.phase === 'hidden' || odds.rows.length === 0) return null;
  const monsters = odds.rows.filter((r) => r.id !== 'objective');
  const objective = odds.rows.find((r) => r.id === 'objective') ?? null;
  return (
    <section className="mhud-panel mhud-odds mhud-odds--v3" aria-label="Danger soon: the odds" data-testid="hud-odds" data-phase={odds.phase}>
      <p className="mhud-odds__title"><Icon name="gauge" />Danger soon</p>
      {monsters.length > 0 && (
        <ul className="mhud-odds__rows">
          {monsters.map((r) => <MonsterRow key={`${r.id}:${r.kind}`} r={r} />)}
        </ul>
      )}
      {objective && <ObjectiveRow r={objective} />}
      <p className="mhud-odds__src" data-testid="hud-odds-source">
        {odds.footer.map((f) => <span key={f}>{f}</span>)}
      </p>
    </section>
  );
});

function MonsterRow({ r }: { r: OddsV3Row }) {
  const hyde = r.id === 'hyde';
  return (
    <li
      className={`mhud-orow mhud-orow--${r.tone} is-${r.kind}`}
      data-odds-id={r.id}
      aria-label={r.aria}
      data-testid={hyde ? 'risk-chip' : `hud-odds-${r.id}`}
      data-band={hyde ? r.riskBand ?? r.cell?.band ?? undefined : r.cell?.band ?? undefined}
      data-kind={r.kind}
    >
      <span className="mhud-orow__icon" aria-hidden="true"><HudIcon name={r.icon} /></span>
      <span className="mhud-orow__label">{r.label}</span>
      {r.kind === 'away' ? null : r.kind === 'next' ? (
        <>
          <span className="mhud-orow__pct num">{r.cell?.text}</span>
          <span className="mhud-orow__band">{r.cell?.band}</span>
        </>
      ) : (
        <>
          <span className="mhud-orow__bar" aria-hidden="true"><span style={{ width: `${r.bar}%` }} /></span>
          {r.kind === 'fact' ? (
            <span className="mhud-orow__fact" data-testid={hyde ? 'risk-chip-label' : undefined}>{r.cell?.text}</span>
          ) : (
            <>
              <span className="mhud-orow__pct num">{r.cell?.text}</span>
              <span className="mhud-orow__band">{r.cell?.band}</span>
            </>
          )}
        </>
      )}
    </li>
  );
}

function ObjectiveRow({ r }: { r: OddsV3Row }) {
  return (
    <div className={`mhud-oobj mhud-oobj--${r.tone}`} data-odds-id={r.id} aria-label={r.aria} data-testid="hud-odds-objective">
      <p className="mhud-oobj__name">
        <span className="mhud-odds__tag">{r.tag}</span>
        <span className="mhud-oobj__label">{r.label}</span>
      </p>
      <p className="mhud-oobj__line" aria-hidden="true">
        <span className="mhud-oobj__bar"><span style={{ width: `${r.bar}%` }} /></span>
        <span className="mhud-orow__pct num">{r.cell?.text}</span>
        {r.delta ? (
          <span className={`mhud-odds__delta is-${r.delta.dir}`} data-testid="odds-delta">{r.delta.dir === 'up' ? '▲' : '▼'} {r.delta.text}</span>
        ) : (
          r.cell?.band && <span className="mhud-orow__band">{r.cell.band}</span>
        )}
      </p>
    </div>
  );
}
