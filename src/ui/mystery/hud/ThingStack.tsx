// ONE Thing message stack (UX_OVERHAUL §6), bottom-centre (x 403–963, bottom 16): ≤ 1 THING'S LOG line + ≤ 1 card
// (WHY or THING'S ADVICE), left-aligned. Polite live region; a CHASE HYDE ALERT is announced assertively by the loop.
// Analytics v2: each item carries its numbered layer badge (1 LOG · 2 WHY · 4 ADVICE; 3 sits on the Odds panel); the
// advice card adds the Why line's source layer ("(Predictive)") and one muted "Also considered: …" line.
import type { StackView } from '../../../app/mystery/hudModel.ts';
import { ThingSigil } from '../../components/ThingSigil.tsx';
import { Icon } from '../../Icon.tsx';
import { LayerBadge } from './LayerBadge.tsx';

const HEAD_CLASS: Record<string, string> = {
  'HYDE ALERT': 'is-hyde',
  'POWER STATUS': 'is-power',
  'EGG STATUS': 'is-egg',
  INVESTIGATION: 'is-investigation',
  PATTERN: 'is-pattern',
  CRACKSTONE: 'is-crack',
  SLURP: 'is-slurp',
};

export function ThingStackView({ log, card }: { log: StackView | null; card: StackView | null }) {
  return (
    <div className="mhud-stack" data-testid="thing-stack" role="status" aria-live="polite">
      {log && (
        <p key={log.id} className="mhud-log" data-testid="thing-log">
          <LayerBadge layer="desc" />
          <Icon name="barChart" />
          <span className="mhud-log__tag">THING&rsquo;S LOG</span>
          <span className="mhud-log__text">{log.text}</span>
        </p>
      )}
      {card && <Card key={card.id} c={card} />}
    </div>
  );
}

function Card({ c }: { c: StackView }) {
  if (c.kind === 'advice') {
    return (
      <div className={`mhud-card mhud-card--advice${c.alt ? ' has-alt' : ''}`} data-testid="thing-line" data-kind="advice">
        <ThingSigil size={32} pose="point" />
        <span className={`mhud-card__head${c.head === 'CRACKSTONE' ? ' is-crack' : ''}`}>
          <LayerBadge layer="presc" /><Icon name="signpost" /> {c.head}
          {/* UX_FINAL §4: Thing's advice is free (never a hint_requested); the chip makes the contrast with Weems explicit */}
          <span className="mhud-card__free" data-testid="thing-free">free</span>
        </span>
        <span className="mhud-card__text">{c.text}</span>
        {c.why && (
          <span className="mhud-card__why">
            Why: {c.why}
            {c.whySource && <span className="mhud-card__src" data-testid="thing-why-source" data-layer={c.whySource.startsWith('Diagnostic') ? 'diag' : 'pred'}> ({c.whySource})</span>}
          </span>
        )}
        {c.alt && <span className="mhud-card__alt" data-testid="thing-alt">{c.alt}</span>}
      </div>
    );
  }
  const pattern = c.basis === 'pattern';
  return (
    <div className={`mhud-card mhud-card--why${pattern ? ' is-pattern' : ''}`} data-testid="thing-line" data-kind="why" data-basis={c.basis ?? 'rule'}>
      <span className={`mhud-card__head ${HEAD_CLASS[c.head] ?? ''}`}><LayerBadge layer="diag" /><Icon name="link" /> {pattern ? '≈ ' : ''}{c.head}</span>
      <span className="mhud-card__text">{c.text}</span>
    </div>
  );
}
