// Death sequence overlay (docs/final/UX_FINAL.md §3): letterbox bars (0→48 px over 300 ms; instant in reduced motion),
// the bottom-left caption, Skip (112×32, "Skip" + KeyCap Enter, aria-label "Skip cutscene") from t0 + 0.5 s, then the
// GAME-OVER card: scrim .94, 560×≈380 card (fade 300 ms), medallion in the monster's chip silhouette, "RUN OVER · CASE
// 02", "Defeated by Slurp" (name in the enemy colour), flavour, violet WHY box, tally, "See results" (Enter, focused) and
// the muted "Results in 12 s" countdown. Rendered OUTSIDE the faded HUD.
import { useEffect, useRef } from 'react';
import type { DeathView } from '../../../app/mystery/hudModel.ts';
import { ENEMY_NAMES } from '../../../mystery/types.ts';
import { Button } from '../../components/Button.tsx';
import { Icon } from '../../Icon.tsx';
import { KeyCap } from '../controls.tsx';
import { HudIcon, type HudIconName } from './HudIcon.tsx';

const ICON: Record<DeathView['enemy'], HudIconName> = { hyde: 'claw', crackstone: 'hat', slurp: 'slurp' };

export function DeathOverlay({ d, onSkip, onContinue }: { d: DeathView; onSkip: () => void; onContinue: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  const card = d.card;
  useEffect(() => {
    if (card) btn.current?.focus();
  }, [!!card]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`mdeath${d.reduced ? ' is-reduced' : ''}`} data-testid="death-overlay" data-phase={d.phase} data-enemy={d.enemy}>
      <div className="mdeath__bar mdeath__bar--top" aria-hidden="true" />
      <div className="mdeath__bar mdeath__bar--bottom" aria-hidden="true">
        {d.phase === 'cutscene' && <p className="mdeath__caption" data-testid="death-caption">{d.caption}</p>}
        {d.skip && (
          <button type="button" className="mdeath__skip" onClick={onSkip} aria-label="Skip cutscene" data-testid="death-skip">
            Skip <KeyCap k="Enter" />
          </button>
        )}
      </div>
      {card && (
        <div className="mdeath__scrim">
          <section className="mdeath__card" role="dialog" aria-modal="true" aria-labelledby="mdeath-title" data-testid="game-over-card">
            <span className={`mdeath__medal mdeath__medal--${d.enemy}`} aria-hidden="true"><HudIcon name={ICON[d.enemy]} /></span>
            <p className="mdeath__kicker">{card.kicker}</p>
            <h1 id="mdeath-title" className="mdeath__title display">
              Defeated by <strong className={`mdeath__name mdeath__name--${d.enemy}`}>{ENEMY_NAMES[d.enemy]}</strong>
            </h1>
            <p className="mdeath__flavour">{card.flavour}</p>
            {card.why.length > 0 && (
              <div className="mdeath__why" data-testid="game-over-why">
                <p className="mdeath__why-head"><Icon name="link" /> WHY</p>
                {card.why.map((l) => <p key={l} className="mdeath__why-line">{l}</p>)}
              </div>
            )}
            <p className="mdeath__tally num" data-testid="game-over-tally">{card.tally}</p>
            <Button ref={btn} variant="primary" className="mdeath__cta" onClick={onContinue} data-testid="btn-see-results">
              See results <KeyCap k="Enter" />
            </Button>
            <p className="mdeath__count num" data-testid="game-over-countdown">Results in {card.countdownS} s</p>
          </section>
        </div>
      )}
    </div>
  );
}
