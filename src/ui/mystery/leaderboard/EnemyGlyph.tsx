// Monster glyphs for the leaderboard, defeat log, results and station card (UX_FINAL §0/§3): Hyde = claw, Crackstone =
// hat, Slurp = the new "slurp" face (inline SVG, same 24-px stroke grid as Icon.tsx). Decorative — always next to text.
// EnemyMedallion = the game-over medallion in the monster's chip silhouette (circle / square / drooping coffin).
import type { EnemyId } from '../../../mystery/types.ts';
import { Icon } from '../../Icon.tsx';

/** Short display names for body copy ({Name} in UX_FINAL §8). */
export const ENEMY_SHORT: Readonly<Record<EnemyId, string>> = { hyde: 'The Hyde', crackstone: 'Crackstone', slurp: 'Slurp' };

/** Death flavour lines (UX_FINAL §8 death.flavour). */
export const ENEMY_FLAVOUR: Readonly<Record<EnemyId, string>> = {
  hyde: 'It followed your sound out of the fog.',
  crackstone: 'His curse caught you in the open.',
  slurp: 'Slurp lurched out of the dark and grabbed you.',
};

export function EnemyGlyph({ enemy, className }: { enemy: EnemyId; className?: string }) {
  if (enemy === 'hyde') return <Icon name="claw" className={className} />;
  if (enemy === 'crackstone') return <Icon name="hat" className={className} />;
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
    >
      <path d="M6 10a6 6 0 0 1 12 0v4a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3Z" />
      <path d="M9.5 10h.01M14.5 10h.01" />
      <path d="M9.5 14c1.5-1 3.5-1 5 0" />
      <path d="M10 17v3M14 17v2" />
    </svg>
  );
}

export function EnemyMedallion({ enemy, size = 'md' }: { enemy: EnemyId; size?: 'md' | 'lg' }) {
  return (
    <span className={`enemy-medal enemy-medal--${enemy} enemy-medal--${size}`} aria-hidden="true" data-enemy={enemy}>
      <EnemyGlyph enemy={enemy} />
    </span>
  );
}
