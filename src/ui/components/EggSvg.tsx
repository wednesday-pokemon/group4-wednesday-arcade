// Egg glyph that encodes tier by SHAPE as well as colour (UX_SPEC EggReveal):
// common = plain ivory, rare = cyan + 1 star, legendary = gold + 3 stars, none = dashed empty nest.
import type { EggTier } from '../../game/index.ts';

const EGG_PATH = 'M50 8C30 8 14 40 14 62c0 20 16 32 36 32s36-12 36-32C86 40 70 8 50 8z';
const STAR = 'M0-7l2 4.6 5 .6-3.7 3.4 1 5L0 4.2-4.3 6.6l1-5L-7-1.8l5-.6z';

export function EggSvg({ tier, size = 160, className }: { tier: EggTier; size?: number; className?: string }) {
  const stars = tier === 'rare' ? [[50, 52]] : tier === 'legendary' ? [[36, 58], [50, 44], [64, 58]] : [];
  return (
    <svg
      className={`egg egg--${tier}${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      {tier === 'none' ? (
        <>
          <ellipse cx="50" cy="78" rx="36" ry="12" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="6 5" />
          <path d="M18 76c8 6 20 9 32 9s24-3 32-9" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="6 5" />
        </>
      ) : (
        <>
          <path d={EGG_PATH} fill="currentColor" stroke="rgba(11,16,32,.55)" strokeWidth="2" />
          <path d="M34 30c-5 8-8 17-8 26" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth="4" strokeLinecap="round" />
          {stars.map(([x, y]) => (
            <path key={`${x}-${y}`} d={STAR} transform={`translate(${x} ${y}) scale(1.3)`} fill="#0b1020" />
          ))}
        </>
      )}
    </svg>
  );
}
