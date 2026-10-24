// HUD Odds panel (UX_OVERHAUL §7): ≤ 4 rows by phase, bars on a common baseline (56×6, cyan; Hyde rows red + hatch),
// the rounded number (largest remainder, facts as words) and the verbal band; a cyan delta chip "50% → 80%" replaces
// the band word for 3 s after an observation; exact source labels in one muted footer line. Rendered ≤ 1 Hz (the view
// object only changes once a second), bars tween 600 ms in CSS (none with reduced motion).
import { memo } from 'react';
import type { OddsGroup, OddsRow, OddsView } from '../../../app/mystery/hud/oddsModel.ts';
import { Icon } from '../../Icon.tsx';

export const OddsPanel = memo(function OddsPanel({ odds }: { odds: OddsView }) {
  if (odds.phase === 'hidden' || odds.groups.length === 0) return null;
  return (
    <section className="mhud-panel mhud-odds" aria-label="The odds" data-testid="hud-odds" data-phase={odds.phase}>
      {odds.groups.map((g) => <Group key={g.id} g={g} />)}
      <p className="mhud-odds__src" data-testid="hud-odds-source">
        {odds.footer.map((f) => <span key={f}>{f}</span>)}
      </p>
    </section>
  );
});

function Group({ g }: { g: OddsGroup }) {
  return (
    <div className={`mhud-odds__group mhud-odds__group--${g.id}`} data-group={g.id}>
      {g.title && (
        <p className="mhud-odds__title">
          <Icon name="gauge" />
          {g.title}
        </p>
      )}
      <ul className="mhud-odds__rows">
        {g.rows.map((r) => <Row key={r.id} r={r} tag={g.tag} crack={g.id === 'crack'} />)}
      </ul>
    </div>
  );
}

const FULL_FACTS = new Set(['Seen', 'Seen now', 'Hunting you']);

function Row({ r, tag, crack = false }: { r: OddsRow; tag: string | null; crack?: boolean }) {
  const width = r.cell.fact && FULL_FACTS.has(r.cell.fact) ? 100 : r.cell.pct ?? 0;
  const label = `${crack ? 'Crackstone — ' : ''}${r.name}: ${r.cell.text}${r.cell.band ? `, ${r.cell.band}` : ''}`;
  return (
    <li className={`mhud-odds__row${r.top ? ' is-top' : ''}${r.hyde ? ' is-hyde' : ''}${crack ? ' is-crack' : ''}${r.cell.fact ? ' is-fact' : ''}`} data-odds-id={r.id} aria-label={label} data-testid={crack ? 'hud-odds-crack' : undefined}>
      <span className="mhud-odds__name">
        {crack && <span className="mhud-odds__hat"><Icon name="hat" /></span>}
        {tag && <span className="mhud-odds__tag">{tag}</span>}
        <span className="mhud-odds__label">{r.name}</span>
      </span>
      <span className="mhud-odds__line" aria-hidden="true">
        <span className="mhud-odds__bar"><span style={{ width: `${r.cell.fact === 'Not here' || r.cell.fact === 'Hidden' ? 0 : width}%` }} /></span>
        <span className="mhud-odds__pct num">{r.cell.text}</span>
        {r.delta ? (
          <span className={`mhud-odds__delta is-${r.delta.dir}`} data-testid="odds-delta">{r.delta.dir === 'up' ? '▲' : '▼'} {r.delta.text}</span>
        ) : (
          r.cell.band && <span className="mhud-odds__band">{r.cell.band}</span>
        )}
      </span>
    </li>
  );
}
