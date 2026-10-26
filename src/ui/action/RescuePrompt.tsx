// Rescue window prompt + outcome toasts (UX_V3_ACTION §3). Centred above the boat (top 7rem), never over the boat,
// the stern or the Hyde meter. The ring depletes clockwise from the remaining real time; the clean-escape arc is drawn
// only while a clean escape is still possible this run.
import type { HudRescue, HudToast } from '../../app/v3/useStageLoop.ts';
import { Icon } from '../Icon.tsx';

const R = 45;
const C = 2 * Math.PI * R;

interface RescuePromptProps {
  rescue: HudRescue;
  pokemonName: string;
  abilityName: string;
  cooldownLeftS: number;
  noCharges: boolean;
}

export function RescuePrompt({ rescue, pokemonName, abilityName, cooldownLeftS, noCharges }: RescuePromptProps) {
  const frac = rescue.windowS > 0 ? rescue.remainingS / rescue.windowS : 0;
  const elapsed = rescue.windowS - rescue.remainingS;
  const cleanFrac = rescue.windowS > 0 ? Math.min(1, rescue.cleanWindowS / rescue.windowS) : 0;
  const cleanPassed = elapsed > rescue.cleanWindowS;
  const ok = rescue.abilityAvailable;
  return (
    <section className={`rescue${ok ? '' : ' rescue--denied'}`} role="alertdialog" aria-label="The Hyde has caught you" data-testid="hud-rescue">
      <p className="rescue__title">The Hyde has caught you!</p>
      <div className="rescue__body">
        <div className="rescue__ring">
          <svg viewBox="0 0 120 120" width="112" height="112" aria-hidden="true">
            <circle cx="60" cy="60" r={R} className="rescue__ring-bg" />
            <circle
              cx="60" cy="60" r={R} className="rescue__ring-fg"
              strokeDasharray={C} strokeDashoffset={C * (1 - frac)} transform="rotate(90 60 60) translate(120 0) scale(-1 1)"
            />
            {cleanFrac > 0 && (
              <circle
                cx="60" cy="60" r={R + 9} className={`rescue__clean${cleanPassed ? ' is-passed' : ''}`}
                strokeDasharray={`${2 * Math.PI * (R + 9) * cleanFrac} ${2 * Math.PI * (R + 9)}`} transform="rotate(-90 60 60)"
              />
            )}
          </svg>
          {ok ? (
            <kbd className="kcap kcap--hero" data-pressed={rescue.qPressed || undefined}>Q</kbd>
          ) : (
            <kbd className="kcap kcap--hero kcap--denied">
              <Icon name="lock" />
              <span className="kcap__secs num">{noCharges ? '0 left' : `${Math.ceil(cooldownLeftS)} s`}</span>
            </kbd>
          )}
          <span className="rescue__count num">{rescue.remainingS.toFixed(1)}</span>
          {cleanFrac > 0 && <span className={`rescue__clean-tag${cleanPassed ? ' is-passed' : ''}`}><Icon name="check" />Clean</span>}
        </div>
        <div className="rescue__copy">
          {ok ? (
            <>
              <p className="rescue__cta">PRESS Q</p>
              <p className="rescue__sub"><strong>{abilityName}</strong> · {pokemonName} can break his grip.</p>
            </>
          ) : (
            <>
              <p className="rescue__cta rescue__cta--space">{pokemonName} not ready — MASH SPACE!</p>
              <p className="rescue__sub num">{noCharges ? 'No charges left' : `${abilityName} back in ${Math.ceil(cooldownLeftS)} s`}</p>
            </>
          )}
          <p className="rescue__kick">
            <kbd className={`kcap ${ok ? 'kcap--space' : 'kcap--space kcap--space-hero'}`}>Space</kbd>
            <span>{ok ? 'Mash SPACE to kick free' : 'Row! Every kick cuts damage'}</span>
            <span className="rescue__kicks" aria-label={`${rescue.kicks} of 8 kicks`}>
              {Array.from({ length: 8 }, (_, i) => <span key={i} className={i < rescue.kicks ? 'is-on' : ''} />)}
            </span>
          </p>
          {rescue.lastChance && <p className="rescue__last">This catch ends the run.</p>}
        </div>
      </div>
    </section>
  );
}

export function RescueToast({ toast }: { toast: HudToast }) {
  return (
    <section key={toast.id} className={`rescue-toast rescue-toast--${toast.tone}`} role="status" data-testid="hud-toast">
      <Icon name={toast.icon} />
      <span>
        <span className="rescue-toast__head">{toast.headline}</span>
        {toast.sub && <span className="rescue-toast__sub">{toast.sub}</span>}
      </span>
    </section>
  );
}
