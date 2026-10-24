// Original type symbols for the duo trading cards (UX_DUO_CARDS §3): 24-unit SVG glyphs drawn for this game — not the
// official energy icons. Ink glyph (currentColor, #120c14 on the card) on an accent disc; the disc and the colours live
// in CSS (`.type-disc[data-type]`). Decorative: the type words are always in the card caption (greyscale-safe).
import type { CSSProperties, ReactElement } from 'react';
import { TYPE_THEME, type ThemeType } from '../duoView.ts';

const R = (deg: number) => `rotate(${deg} 12 12)`;

/** Ice bar: a vertical bar with V tips near both ends (rotated ×3 for the snow-crystal). */
const ICE_BAR = 'M12 2.6V21.4M9.4 4.4 12 6.9l2.6-2.5M9.4 19.6 12 17.1l2.6 2.5';

export const TYPE_GLYPH: Readonly<Record<ThemeType, ReactElement>> = {
  // two-tongued flame (the inner tongue is cut out)
  fire: (
    <path fillRule="evenodd" d="M12 1.8c.9 3.6 6.4 6.3 6.4 12.3a6.4 6.4 0 0 1-12.8 0c0-3.3 1.8-5.2 3.1-7 .3 2 1.2 3.2 2.3 3.7-.6-3.2-.1-6 1-9ZM12 20.6a3 3 0 0 0 3-3c0-2-1.5-2.9-2-4.7-.6 1.7-2.4 2.6-3.3 3.9-.5.8-.7 1.3-.7 1.9a3 3 0 0 0 3 1.9Z" />
  ),
  // droplet with a crescent cut-out
  water: (
    <path fillRule="evenodd" d="M12 2.2S4.8 10.4 4.8 15.2a7.2 7.2 0 0 0 14.4 0C19.2 10.4 12 2.2 12 2.2ZM8.4 14.2c-.5 2.9 1.2 5.2 4.1 5.6-1.9-1.1-3.1-3-3-5.6Z" />
  ),
  // two leaves on one stem
  grass: (
    <>
      <path d="M11.4 13.4C5.8 13.6 3.2 9.9 3.6 4.4c5.4-.2 8.2 3.2 7.8 9Z" />
      <path d="M12.6 16.6c-.1-5.5 3-8.8 8-8.9.4 5.2-2.6 8.8-8 8.9Z" />
      <path d="M12 22V12.4" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" />
    </>
  ),
  // three crossed bars with V tips
  ice: (
    <g fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d={ICE_BAR} />
      <path d={ICE_BAR} transform={R(60)} />
      <path d={ICE_BAR} transform={R(120)} />
    </g>
  ),
  // hex nut
  steel: (
    <path fillRule="evenodd" d="M12 2.3 20.4 7.15v9.7L12 21.7 3.6 16.85v-9.7ZM12 7.9a4.1 4.1 0 1 0 0 8.2 4.1 4.1 0 0 0 0-8.2Z" />
  ),
  // three rising bubbles
  poison: (
    <>
      <circle cx="8.2" cy="16" r="4.6" />
      <circle cx="15.6" cy="10.6" r="3.3" />
      <circle cx="18.4" cy="4.4" r="2" />
      <circle cx="9.6" cy="6.4" r="1.4" />
    </>
  ),
  // crescent moon
  dark: <path d="M14.6 2.4a9.6 9.6 0 1 0 7 14.2A7.8 7.8 0 0 1 14.6 2.4Z" />,
  // raven feather (notched vane + quill)
  flying: (
    <>
      <path d="M5.6 18.4c.8-5.9 4.4-10.9 9.4-13.3l-1.4 2.9 3-3.4c1-.4 2-.7 3.2-1-.4 3.4-1.8 6.3-3.8 8.6l-2.6.3 1.8.6c-2.4 2.6-5.6 4.4-9.6 5.3Z" />
      <path d="M3.4 20.6 11.2 12.8" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
    </>
  ),
  // twin curved fangs
  dragon: (
    <>
      <path d="M4.2 3.6c-.2 7.4 2.4 13.2 6.4 17.2-1.2-5.4-1.4-10.8-.2-17.2Z" />
      <path d="M19.8 3.6c.2 7.4-2.4 13.2-6.4 17.2 1.2-5.4 1.4-10.8.2-17.2Z" />
    </>
  ),
  // sheet-wisp with a wavy hem and two eye holes
  ghost: (
    <path fillRule="evenodd" d="M12 2.4c-4.6 0-7.2 3.5-7.2 8.2v10c1.3 1.1 2.4-.9 3.6.3 1.2 1.2 2.4-.9 3.6.3 1.2 1.2 2.4-.9 3.6.3 1.2 1.2 2.1-.2 3.6-.9v-10c0-4.7-2.6-8.2-7.2-8.2ZM9.5 8.6c-.8 0-1.3.9-1.3 2s.5 2 1.3 2 1.3-.9 1.3-2-.5-2-1.3-2Zm5 0c-.8 0-1.3.9-1.3 2s.5 2 1.3 2 1.3-.9 1.3-2-.5-2-1.3-2Z" />
  ),
};

/** Character-power crest: an eye inside a pointed diamond (original). */
export const POWER_GLYPH: ReactElement = (
  <path fillRule="evenodd" d="M12 1.4 22.6 12 12 22.6 1.4 12ZM5.4 12c2.4-3.9 10.8-3.9 13.2 0-2.4 3.9-10.8 3.9-13.2 0Zm6.6-2.3a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6Z" />
);

/** Glyph only (no disc). */
export function Glyph({ children, className }: { children: ReactElement; className?: string }) {
  return (
    <svg className={`tglyph${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** Accent disc + ink glyph. `size` picks the CSS size class (header symbol, ability glyph, secondary Ghost disc). */
export function TypeDisc({ type, size = 'md', className }: { type: ThemeType; size?: 'lg' | 'md' | 'sm'; className?: string }) {
  return (
    <span
      className={`type-disc type-disc--${size}${className ? ` ${className}` : ''}`}
      data-type={type}
      style={{ '--disc': TYPE_THEME[type].accent } as CSSProperties}
      aria-hidden="true"
    >
      <Glyph>{TYPE_GLYPH[type]}</Glyph>
    </span>
  );
}

/** Silver disc + the power crest. */
export function PowerDisc() {
  return (
    <span className="type-disc type-disc--md type-disc--power" aria-hidden="true">
      <Glyph>{POWER_GLYPH}</Glyph>
    </span>
  );
}
