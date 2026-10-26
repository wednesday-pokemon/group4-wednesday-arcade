// Final HUD glyphs (docs/final/UX_FINAL.md §0): `slurp` (drooping zombie head), `cabinet`, `hush` — same 24×24 stroke
// style as src/ui/Icon.tsx. Kept here (frontend A's folder) so the shared Icon set stays untouched; every other name is
// delegated to <Icon>. If Icon.tsx later gains these names, this wrapper can simply forward.
import type { ReactElement } from 'react';
import { Icon, type IconName } from '../../Icon.tsx';

const FINAL_PATHS = {
  slurp: <><path d="M6 10a6 6 0 0 1 12 0v4a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3Z" /><path d="M9.5 10h.01M14.5 10h.01" /><path d="M9.5 14c1.5-1 3.5-1 5 0" /><path d="M10 17v3M14 17v2" /></>,
  cabinet: <><path d="M5 21V3h14v18" /><path d="M3 21h18" /><path d="M9 7h6M9 10h6M9 13h6" /></>,
  hush: <><path d="M12 4v10" /><circle cx="12" cy="18" r="2" /><path d="M4 12h3M17 12h3" /></>,
} satisfies Record<string, ReactElement>;

export type FinalIconName = keyof typeof FINAL_PATHS;
export type HudIconName = IconName | FinalIconName;

export function isFinalIcon(name: string): name is FinalIconName {
  return Object.prototype.hasOwnProperty.call(FINAL_PATHS, name);
}

export function HudIcon({ name, className }: { name: HudIconName; className?: string }) {
  if (!isFinalIcon(name)) return <Icon name={name} className={className} />;
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
    >
      {FINAL_PATHS[name]}
    </svg>
  );
}
