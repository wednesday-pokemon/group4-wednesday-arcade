// PushButton radio group (UX_SPEC §4): effective discount + stamina cost from getPushOptions();
// illegal options stay focusable (aria-disabled), hatched, with disabledReason shown verbatim.
import { useId, useRef } from 'react';
import type { PushLevel, PushOption } from '../../game/index.ts';
import { announce } from '../../app/announce.tsx';
import { Icon } from '../Icon.tsx';
import { MINUS } from '../format.ts';

interface PushGroupProps {
  options: PushOption[];
  selected: PushLevel;
  advised: PushLevel | null;
  onSelect: (level: PushLevel) => void;
  onHover: (level: PushLevel | null) => void;
}

export function PushGroup({ options, selected, advised, onSelect, onHover }: PushGroupProps) {
  const labelId = useId();
  const reasonId = useId();
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const reasons = options.filter((o) => !o.isLegal && o.disabledReason);

  const activate = (o: PushOption) => {
    if (!o.isLegal) {
      announce(o.disabledReason ?? 'Not enough stamina');
      const el = document.getElementById(reasonId);
      el?.classList.remove('reason--pulse');
      void el?.offsetWidth;
      el?.classList.add('reason--pulse');
      return;
    }
    onSelect(o.pushLevel);
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (e.key === ' ') {
      e.preventDefault();
      activate(options[i]);
      return;
    }
    if (!delta) return;
    e.preventDefault();
    const j = Math.max(0, Math.min(options.length - 1, i + delta));
    refs.current[j]?.focus();
    activate(options[j]);
  };

  return (
    <div className="push">
      <span id={labelId} className="caps push__label">Push</span>
      <div role="radiogroup" aria-labelledby={labelId} className="push__group">
        {options.map((o, i) => {
          const isSelected = o.pushLevel === selected;
          return (
            <div
              key={o.pushLevel}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="radio"
              aria-checked={isSelected}
              aria-disabled={!o.isLegal || undefined}
              aria-describedby={!o.isLegal ? reasonId : undefined}
              tabIndex={isSelected ? 0 : -1}
              className={`push-btn${isSelected ? ' is-selected' : ''}${!o.isLegal ? ' is-illegal' : ''}`}
              onClick={() => activate(o)}
              onMouseEnter={() => onHover(o.pushLevel)}
              onMouseLeave={() => onHover(null)}
              onKeyDown={(e) => onKeyDown(e, i)}
              data-testid={`push-${o.pushLevel}`}
            >
              <span className="push-btn__title">Push {o.pushLevel}</span>
              <span className="push-btn__pct num">{MINUS}{o.pushDiscountPct}% time</span>
              <span className="push-btn__cost">
                Costs {o.staminaCost} stamina{o.pushLevel === 3 && <span className="push-btn__extra"> · +10&nbsp;m lead</span>}
              </span>
              <kbd className="push-btn__kbd">{o.pushLevel}</kbd>
              {advised === o.pushLevel && <span className="ribbon ribbon--corner">Advised</span>}
            </div>
          );
        })}
      </div>
      <div id={reasonId} className="reason push__reason" aria-live="polite">
        {reasons.length > 0 && (
          <>
            <Icon name="alert" />
            <span>Push {reasons.map((o) => o.pushLevel).join(' & ')}: {reasons[0].disabledReason}</span>
          </>
        )}
      </div>
    </div>
  );
}
