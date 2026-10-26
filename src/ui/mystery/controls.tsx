// ONE control reference for the whole mystery UI (UX_OVERHAUL §9, rulings R1/R4). Every key cap the visitor sees —
// onboarding card, HUD key strip, ability slots, prompts, Pause → Controls, duo cards — comes from CONTROLS +
// ABILITY_KEY_LABEL, so a key can never be labelled two ways.
//
// Rules:
//   * Ability SLOT ids stay 'F' (character power) / 'Q' (Pokémon move) in data/events; the key the player presses is
//     ABILITY_KEY_LABEL[slot] (Q / R). F still triggers the power as a silent alias (input.ts) and is NEVER displayed.
//   * M (mute) appears only in the `full` variant (Pause → Controls), never on the HUD.
//   * The Ctrl cap next to C appears only while the kiosk keyboard lock is active (`ctrlCrouch`), because Ctrl crouches
//     only then (kiosk.ts).
//
// API for other screens (frontend B: Pause → Controls, duo cards):
//   <KeyLegend variant="full" power={powerName} move={moveName} ctrlCrouch={ctrlCrouchEnabled()} />
//   <KeyLegend variant="strip" />                                    // HUD: Tab Evidence · X Map · Esc Pause (UX_FINAL)
//   <KeyLegend variant="card" power=… move=… highlight={['crouch', 'sprint']} />   // onboarding card
//   <KeyCap k={abilityKey('F')} />                                   // inline cap (prompts, ability slots, cards)
//   controlRows(variant, opts)                                       // the resolved rows (pure; tests / custom layouts)
import { Fragment } from 'react';
import { ABILITY_KEY_LABEL } from '../../mystery/types.ts';
import '../styles/mhud.css';

export type KeyLegendVariant = 'card' | 'full' | 'strip' | 'inline';
export type ControlId = 'move' | 'look' | 'sprint' | 'crouch' | 'interact' | 'power' | 'ability_move' | 'board' | 'lens' | 'hint' | 'pause' | 'mute';

export interface ControlDef {
  id: ControlId;
  /** Key caps in display order (each one cap). Never contains 'F'. */
  keys: readonly string[];
  /** Full label; `{power}` / `{move}` are filled with the duo's ability names. */
  label: string;
  /** Short label for the HUD strip. */
  short?: string;
  /** Variants that list this row. */
  in: readonly KeyLegendVariant[];
  /** Shown with a LOUD tag (lantern). */
  loud?: boolean;
}

/** The key the player presses for an ability SLOT ('F' power → Q, 'Q' move → R). */
export function abilityKey(slot: 'F' | 'Q'): string {
  return ABILITY_KEY_LABEL[slot];
}

export const CONTROLS: readonly ControlDef[] = [
  { id: 'move', keys: ['W', 'A', 'S', 'D'], label: 'Move', in: ['card', 'full'] },
  { id: 'look', keys: ['Mouse', '← → ↑ ↓'], label: 'Look', in: ['card', 'full'] },
  { id: 'sprint', keys: ['Shift'], label: 'Sprint', in: ['card', 'full'], loud: true },
  { id: 'crouch', keys: ['C'], label: 'Crouch', in: ['card', 'full'] },
  { id: 'interact', keys: ['E'], label: 'Search · use · hide (hold for long actions)', short: 'Search', in: ['card', 'full'] },
  { id: 'power', keys: [ABILITY_KEY_LABEL.F], label: '{power}', in: ['card', 'full'] },
  { id: 'ability_move', keys: [ABILITY_KEY_LABEL.Q], label: '{move}', in: ['card', 'full'] },
  { id: 'board', keys: ['Tab'], label: 'Evidence + map', short: 'Evidence', in: ['card', 'full', 'strip'] },
  // UX_FINAL §0: X = minimap danger view (strip + Pause); V = Principal Weems' PAID hint (Pause only — the Ask Weems
  // button shows its own V cap). Thing's advice is free and has no key.
  { id: 'lens', keys: ['X'], label: 'Map: switch danger view', short: 'Map', in: ['full', 'strip'] },
  { id: 'hint', keys: ['V'], label: 'Ask Weems (−50)', short: 'Weems', in: ['full'] },
  { id: 'pause', keys: ['Esc'], label: 'Pause', in: ['full', 'strip'] },
  { id: 'mute', keys: ['M'], label: 'Mute', in: ['full'] },
];

export interface ControlRowOptions {
  power?: string;
  move?: string;
  /** Kiosk keyboard lock active: Ctrl also crouches, so its cap is shown next to C. */
  ctrlCrouch?: boolean;
  /** Explicit subset (in this order); default = every row of the variant. */
  only?: readonly ControlId[];
}

export interface ControlRow { id: ControlId; keys: string[]; label: string; loud: boolean }

/** The rows a variant shows, with names filled in. Pure (unit-tested: no F cap, M only in `full`, Ctrl only locked). */
export function controlRows(variant: KeyLegendVariant, o: ControlRowOptions = {}): ControlRow[] {
  const defs = o.only
    ? o.only.map((id) => CONTROLS.find((c) => c.id === id)).filter((c): c is ControlDef => !!c)
    : CONTROLS.filter((c) => c.in.includes(variant));
  return defs
    .filter((c) => variant !== 'strip' || c.in.includes('strip'))
    .filter((c) => c.id !== 'mute' || variant === 'full')
    .map((c) => {
      const keys = c.id === 'crouch' && o.ctrlCrouch ? [...c.keys, 'Ctrl'] : [...c.keys];
      const base = variant === 'strip' || variant === 'card' ? (c.short ?? c.label) : c.label;
      const label = base.replace('{power}', o.power ?? 'Power').replace('{move}', o.move ?? 'Move');
      return { id: c.id, keys, label, loud: !!c.loud };
    });
}

export function KeyCap({ k, className }: { k: string; className?: string }) {
  return <kbd className={`kcap${className ? ` ${className}` : ''}`}>{k}</kbd>;
}

export interface KeyLegendProps extends ControlRowOptions {
  variant: KeyLegendVariant;
  /** `card`: rows of the current onboarding step are lantern, the others dimmed. */
  highlight?: readonly ControlId[];
  /** Legacy (overhaul strip showed the V cooldown); ignored — the Ask Weems button shows it now. */
  hintCooldownS?: number;
  className?: string;
  'data-testid'?: string;
}

export function KeyLegend({ variant, highlight, hintCooldownS: _legacyCooldown, className, ...o }: KeyLegendProps) {
  const rows = controlRows(variant, o);
  const testId = o['data-testid'] ?? `key-legend-${variant}`;
  if (variant === 'inline') {
    return (
      <span className={`klegend klegend--inline${className ? ` ${className}` : ''}`} data-testid={testId}>
        {rows.map((r, i) => (
          <Fragment key={r.id}>
            {i > 0 && <span className="klegend__sep" aria-hidden="true"> · </span>}
            <span className="klegend__item">
              {r.keys.map((k) => <KeyCap key={k} k={k} />)} {r.label}
            </span>
          </Fragment>
        ))}
      </span>
    );
  }
  if (variant === 'strip') {
    return (
      <p className={`klegend klegend--strip${className ? ` ${className}` : ''}`} data-testid={testId}>
        {rows.map((r) => (
          <span key={r.id} className="klegend__item">
            {r.keys.map((k) => <KeyCap key={k} k={k} />)}
            <span>{r.label}</span>
          </span>
        ))}
      </p>
    );
  }
  return (
    <dl className={`klegend klegend--${variant}${className ? ` ${className}` : ''}`} data-testid={testId}>
      {rows.map((r) => {
        const state = highlight ? (highlight.includes(r.id) ? ' is-current' : ' is-dim') : '';
        return (
          <div key={r.id} className={`klegend__row${state}`} data-control={r.id}>
            <dt>{r.keys.map((k) => <KeyCap key={k} k={k} />)}</dt>
            <dd>
              {r.label}
              {r.loud && <span className="loud-tag">LOUD</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
