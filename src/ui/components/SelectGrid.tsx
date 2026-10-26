// Radio-group grid with roving tabindex (UX_SPEC SelectCard + §5 grid navigation):
// arrows move and select, Home/End (Ctrl for first/last), Space selects, Enter selects and continues,
// double-click selects and continues.
import { forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react';

interface SelectGridProps<T extends { id: string }> {
  items: T[];
  columns: number;
  selectedId: string | null;
  labelledBy: string;
  onSelect: (id: T['id']) => void;
  onContinue: () => void;
  renderCard: (item: T, selected: boolean) => ReactNode;
  describedBy: (item: T) => string;
  label: (item: T) => string;
  testIdPrefix: string;
  /** Optional: reports the focused card (detail panels follow focus, not hover). */
  onFocusItem?: (id: T['id']) => void;
  className?: string;
}

export interface SelectGridHandle {
  focus(): void;
}

function SelectGridInner<T extends { id: string }>(
  { items, columns, selectedId, labelledBy, onSelect, onContinue, renderCard, describedBy, label, testIdPrefix, onFocusItem, className }: SelectGridProps<T>,
  ref: React.ForwardedRef<SelectGridHandle>,
) {
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const selectedIndex = items.findIndex((i) => i.id === selectedId);
  const tabIndex = selectedIndex >= 0 ? selectedIndex : 0;

  useImperativeHandle(ref, () => ({ focus: () => cards.current[tabIndex]?.focus() }), [tabIndex]);

  const choose = (j: number) => {
    onSelect(items[j].id);
    cards.current[j]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.altKey || e.metaKey) return;
    const n = items.length;
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
    let j = i;
    if (e.key in moves) j = i + moves[e.key];
    else if (e.key === 'Home') j = e.ctrlKey ? 0 : i - (i % columns);
    else if (e.key === 'End') j = e.ctrlKey ? n - 1 : Math.min(n - 1, i - (i % columns) + columns - 1);
    else if (e.key === ' ') {
      e.preventDefault();
      choose(i);
      return;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onSelect(items[i].id);
      onContinue();
      return;
    } else return;
    e.preventDefault();
    if (j >= 0 && j < n) choose(j);
  };

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className={`select-grid${className ? ` ${className}` : ''}`} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {items.map((item, i) => {
        const selected = item.id === selectedId;
        return (
          <div
            key={item.id}
            ref={(el) => {
              cards.current[i] = el;
            }}
            role="radio"
            aria-checked={selected}
            aria-label={label(item)}
            aria-describedby={describedBy(item)}
            tabIndex={i === tabIndex ? 0 : -1}
            className={`card select-card${selected ? ' is-selected' : ''}`}
            onClick={() => choose(i)}
            onDoubleClick={() => {
              onSelect(item.id);
              onContinue();
            }}
            onKeyDown={(e) => onKeyDown(e, i)}
            onFocus={onFocusItem ? () => onFocusItem(item.id) : undefined}
            data-testid={`${testIdPrefix}-${item.id}`}
          >
            {selected && <span className="selected-badge" aria-hidden="true">Selected</span>}
            {renderCard(item, selected)}
          </div>
        );
      })}
    </div>
  );
}

export const SelectGrid = forwardRef(SelectGridInner) as <T extends { id: string }>(
  props: SelectGridProps<T> & { ref?: React.Ref<SelectGridHandle> },
) => ReturnType<typeof SelectGridInner>;
