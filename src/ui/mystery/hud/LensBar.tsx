// Minimap danger-view lens bar (docs/final/UX_FINAL.md §1d, 224×28 at 1126,256): `[X] (A)(claw)(hat)(slurp)  Hyde odds ·
// auto`. KeyCap X, four 24×24 icon toggles (selected = filled in its enemy colour + 2 px border), the fs-xs label. X
// cycles Auto → Hyde → Crackstone → Slurp → Auto (keyboard only; pointer lock stays) — the toggles are a display.
import { memo } from 'react';
import type { LensView } from '../../../app/mystery/hudModel.ts';
import type { EnemyId } from '../../../mystery/types.ts';
import { KeyCap } from '../controls.tsx';
import { HudIcon, type HudIconName } from './HudIcon.tsx';
import { LENS_BASE, lensSuffix } from '../../../app/mystery/hud/enemies.ts';

const ICON: Record<EnemyId, HudIconName> = { hyde: 'claw', crackstone: 'hat', slurp: 'slurp' };

export const LensBar = memo(function LensBar({ lens }: { lens: LensView }) {
  return (
    <div className="mhud-lens" data-testid="hud-lens" data-enemy={lens.enemy} data-auto={lens.auto || undefined} data-inactive={lens.inactive || undefined}>
      <KeyCap k="X" />
      <span className="mhud-lens__toggles" aria-hidden="true">
        <span className={`mhud-lens__t mhud-lens__t--auto${lens.auto ? ' is-on' : ''}`}>A</span>
        {lens.present.map((e) => (
          <span key={e} className={`mhud-lens__t mhud-lens__t--${e}${!lens.auto && lens.enemy === e ? ' is-on' : lens.auto && lens.enemy === e ? ' is-auto' : ''}`}>
            <HudIcon name={ICON[e]} />
          </span>
        ))}
      </span>
      <span className="mhud-lens__label" data-testid="hud-lens-label" aria-label={lens.label}>
        <span className="mhud-lens__base">{LENS_BASE[lens.enemy]}</span>
        {lensSuffix(lens.auto, lens.inactive) && <span className="mhud-lens__suffix">{lensSuffix(lens.auto, lens.inactive)}</span>}
      </span>
    </div>
  );
});
