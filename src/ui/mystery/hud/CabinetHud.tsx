// Hiding cabinet HUD (docs/final/UX_FINAL.md §2): the hiding-view overlay (first child of .mhud, under the panels,
// pointer-events none, 300 ms opacity — instant in reduced motion), the status chip (360×28, y496) and the prompt row
// (≤ 480×44, y532). Copy exactly as §8.
import type { CabinetView } from '../../../app/mystery/hud/cabinet.ts';
import { CABINET_COPY } from '../../../app/mystery/hud/cabinet.ts';
import { KeyCap } from '../controls.tsx';
import { Icon } from '../../Icon.tsx';
import { HudIcon } from './HudIcon.tsx';

/** Overlay: open = door edge + vignette; closed = slats + heavy vignette; data-near tints it in that enemy's colour. */
export function CabinetOverlay({ v }: { v: CabinetView }) {
  return <div className="mhud-cabinet" data-door={v.door ?? 'none'} data-near={v.near ?? undefined} aria-hidden="true" data-testid="hud-cabinet-view" />;
}

export function CabinetBlock({ v }: { v: CabinetView }) {
  if (!v.chip && !v.prompt) return null;
  return (
    <div className="mhud-cabblock" data-testid="hud-cabinet">
      {v.chip && (
        <div
          className={`mhud-cabchip is-${v.chip.door}${v.chip.flash ? ' is-creak' : ''}`}
          data-witnessed={v.chip.witnessedBy ?? undefined}
          role="status"
          data-testid="hud-cabinet-chip"
        >
          <p className="mhud-cabchip__main">
            <HudIcon name="cabinet" />
            <span>{v.chip.text}</span>
            {v.chip.door === 'closed' && <Icon name="shieldCheck" className="mhud-cabchip__ok" />}
          </p>
          {v.chip.line2 && (
            <p className={`mhud-cabchip__line2 is-${v.chip.line2Tone ?? 'muted'}`} data-testid="hud-cabinet-line2">
              {v.chip.line2Tone === 'lantern' && <Icon name="alert" />}
              {v.chip.line2}
            </p>
          )}
        </div>
      )}
      {v.prompt && (
        <div className={`mhud-cabprompt is-${v.prompt.kind}`} data-testid="hud-cabinet-prompt" data-kind={v.prompt.kind}>
          <p className="mhud-cabprompt__row">
            {v.prompt.quiet && (
              <>
                <span className="mhud-cabprompt__quiet"><HudIcon name="hush" />{CABINET_COPY.quiet}</span>
                <span className="mhud-cabprompt__div" aria-hidden="true" />
              </>
            )}
            <span className={`mhud-cabprompt__act${v.prompt.urgent ? ' is-urgent' : ''}`}>
              <KeyCap k="E" />
              {v.prompt.kind === 'hide' ? CABINET_COPY.hide : v.prompt.kind === 'close' ? CABINET_COPY.close : CABINET_COPY.exit}
            </span>
            {v.prompt.aside && <span className="mhud-cabprompt__aside">{v.prompt.aside}</span>}
          </p>
          {v.prompt.warn && <p className="mhud-prompt__warn" data-testid="hud-cabinet-warn">{v.prompt.warn}</p>}
        </div>
      )}
    </div>
  );
}
