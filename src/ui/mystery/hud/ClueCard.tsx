// TL;DR clue card (UX_OVERHAUL §5): 16,112 · 400×≤132. CLUE FOUND / TITLE / one short sentence / Meaning. Slides in
// 200 ms, holds 6 s, then flies into its objective pip (300 ms; none with reduced motion). Never names a culprit (the copy
// comes from ClueDef.short / meaning — unit-tested for culprit words). Announced politely by the loop.
import type { ClueCardView } from '../../../app/mystery/hudModel.ts';
import { Icon } from '../../Icon.tsx';

export function ClueCard({ c }: { c: ClueCardView }) {
  return (
    <section className={`mhud-cluecard${c.leaving ? ' is-leaving' : ''}`} data-testid="hud-clue-card" aria-label={`Clue found: ${c.fullTitle}`}>
      <span className="mhud-cluecard__icon" aria-hidden="true"><Icon name={c.icon} /></span>
      <p className="mhud-cluecard__kicker">Clue found</p>
      <p className={`mhud-cluecard__title${c.title.length > 24 ? ' is-long' : ''}`} title={c.fullTitle}>{c.title}</p>
      {c.short && <p className="mhud-cluecard__short">{c.short}</p>}
      {c.meaning && (
        <p className="mhud-cluecard__meaning"><strong>Meaning:</strong> {c.meaning}</p>
      )}
    </section>
  );
}
