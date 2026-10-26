// Egg reveal overlay (UX_SPEC): tier from view.leg.visibleOffers after prepare; Collect disabled with a
// visible reason when there is no egg; egg advice from requestAdvice('egg'). Keys: C collect, K skip.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { EggDecision, SessionView } from '../../game/index.ts';
import { requestAdvice } from '../../analytics/adviceClient.ts';
import type { Advice } from '../../game/index.ts';
import { announce } from '../../app/announce.tsx';
import { audio } from '../../app/audio.ts';
import { useHotkeys, useScreenFocus } from '../../app/keyboard.ts';
import { Button, Reason } from '../components/Button.tsx';
import { EggSvg } from '../components/EggSvg.tsx';
import { Icon } from '../Icon.tsx';
import { EGG_LABEL, eggPointsFor, fmtPts } from '../format.ts';

interface EggRevealProps {
  view: SessionView;
  busy: boolean;
  tools: ReactNode;
  onDecide: (decision: EggDecision) => void;
  onAdvice: (advice: Advice | null) => void;
}

export function EggReveal({ view, busy, tools, onDecide, onAdvice }: EggRevealProps) {
  const { state } = view;
  const prepared = state.prepared;
  const route = prepared?.route ?? 'safe';
  const tier = view.leg?.visibleOffers[route] ?? prepared?.selectedOffer ?? 'none';
  const hasEgg = tier !== 'none';
  const points = eggPointsFor(tier, state.pokemonId);
  const h1 = useRef<HTMLHeadingElement>(null);
  const collectRef = useRef<HTMLButtonElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const reasonId = useId();
  const [advice, setAdvice] = useState<Advice | null | 'loading'>('loading');
  useScreenFocus(h1, hasEgg ? collectRef : skipRef);

  useEffect(() => {
    announce(hasEgg ? `${EGG_LABEL[tier]}, ${points} point${points === 1 ? '' : 's'}. Collecting adds 5 seconds.` : 'No egg on this route.');
    if (hasEgg) audio.play('chime');
    let alive = true;
    if (view.leg) {
      requestAdvice('egg', state, view.leg)
        .then((a) => alive && setAdvice(a))
        .catch(() => alive && setAdvice(null));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.sessionId, state.revision]);

  useEffect(() => onAdvice(advice === 'loading' ? null : advice), [advice, onAdvice]);

  useHotkeys((key) => {
    if (busy) return;
    if (key === 'c') {
      if (hasEgg) onDecide('collect');
      else announce('No egg on this route, nothing to collect.');
      return true;
    }
    if (key === 'k') {
      onDecide('skip');
      return true;
    }
  });

  const protectedBy = state.pokemonId === 'dhelmise' ? 'Dhelmise'
    : state.pokemonId === 'aegislash' && !state.flags.firstCatchResolved ? 'Aegislash' : null;

  return (
    <main className="screen screen--overlay" data-testid="screen-egg">
      <div className="overlay-scrim" aria-hidden="true" />
      <header className="topline topline--overlay">
        <span className="caps">Leg {state.legIndex} · {route === 'safe' ? 'Safe' : 'Shortcut'} · Push {prepared?.pushLevel}</span>
        {tools}
      </header>
      <section className={`panel egg-card egg-card--${tier}`} aria-labelledby="egg-title">
        <p className="caps egg-card__tier">{EGG_LABEL[tier]}</p>
        <EggSvg tier={tier} size={140} className="egg-card__egg" />
        <h1 ref={h1} id="egg-title" tabIndex={-1} className="egg-card__points display num" data-testid="egg-tier" data-tier={tier}>
          {hasEgg ? `+${fmtPts(points)}` : 'Empty nest'}
        </h1>
        {hasEgg ? (
          <ul className="egg-card__trade">
            <li><Icon name="timer" />+5.00&nbsp;s to collect</li>
            {route === 'shortcut' && <li><Icon name="alert" />25% chance to drop it if you crash</li>}
            <li>
              <Icon name="ghost" />
              {protectedBy ? `Hyde catch: protected by ${protectedBy}` : 'Hyde catch: lose half your unbanked eggs'}
            </li>
            {state.pokemonId === 'sableye' && (tier === 'rare' || tier === 'legendary') && <li><Icon name="sparkle" />+1 pt from Sableye</li>}
          </ul>
        ) : (
          <p className="text-2">Nothing to grab on this route. Keep rowing.</p>
        )}
        <p className="egg-card__advice" data-testid="egg-advice">
          <Icon name="ghost" />
          {advice === 'loading' && 'Wednesday is weighing the egg…'}
          {advice === null && 'Advice unavailable. Your call.'}
          {advice && advice !== 'loading' && <span><strong>Wednesday:</strong> {advice.headline}. {advice.reasons[0]}</span>}
        </p>
        <div className="egg-card__actions">
          <Button
            ref={collectRef}
            variant={hasEgg ? 'primary' : 'secondary'}
            size="lg"
            kbd="C"
            inactive={!hasEgg}
            inactiveReason="No egg on this route, nothing to collect."
            aria-describedby={!hasEgg ? reasonId : undefined}
            busy={busy && hasEgg}
            busyLabel="Rowing on…"
            onClick={() => onDecide('collect')}
            data-testid="btn-collect"
          >
            Collect egg
          </Button>
          <Button
            ref={skipRef}
            variant={hasEgg ? 'secondary' : 'primary'}
            size="lg"
            kbd="K"
            busy={busy && !hasEgg}
            busyLabel="Rowing on…"
            onClick={() => onDecide('skip')}
            data-testid="btn-skip"
          >
            {hasEgg ? 'Skip' : 'Continue without egg'}
          </Button>
        </div>
        {!hasEgg && <Reason id={reasonId}>No egg on this route, nothing to collect.</Reason>}
      </section>
    </main>
  );
}
