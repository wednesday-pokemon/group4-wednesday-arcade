// Splash (UX_SPEC §3): left column over scrim, 3D boat idling on the right, single Start CTA.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TUTORIAL_STEPS } from '../../game/copy.ts';
import type { BackendMode } from '../../lib/backend.ts';
import { useHotkeys, useScreenFocus } from '../../app/keyboard.ts';
import { Button } from '../components/Button.tsx';
import { Icon } from '../Icon.tsx';

interface SplashProps {
  stationName: string;
  mode: BackendMode;
  tools: ReactNode;
  notice: string | null;
  restoring: boolean;
  onStart: () => void;
  /** v3 overrides the v2.5 tutorial steps and the time/score footnote. */
  steps?: { title: string; body: string }[];
  footnote?: string;
  startLabel?: string;
}

function useNeedsFullscreenHint(): boolean {
  const check = () => !document.fullscreenElement && window.innerHeight < window.screen.height - 40;
  const [needs, setNeeds] = useState(check);
  useEffect(() => {
    const update = () => setNeeds(check());
    window.addEventListener('resize', update);
    document.addEventListener('fullscreenchange', update);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('fullscreenchange', update);
    };
  }, []);
  return needs;
}

export function Splash({ stationName, mode, tools, notice, restoring, onStart, steps = TUTORIAL_STEPS, footnote, startLabel }: SplashProps) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const needsFullscreen = useNeedsFullscreenHint();
  useScreenFocus(h1, start);
  useHotkeys((key) => {
    if (key === 'enter' && document.activeElement !== start.current && !restoring) {
      onStart();
      return true;
    }
  });

  return (
    <main className="screen screen--splash scrim-left" data-testid="screen-splash">
      <header className="topline">
        <span className="caps">{stationName}</span>
        {tools}
      </header>
      <div className="splash__col">
        <h1 ref={h1} tabIndex={-1} className="title splash__title">
          Escape from <span className="splash__title-2">Raven Island</span>
        </h1>
        <p className="splash__subtitle">The Hyde’s Regatta</p>
        <ol className="splash__steps">
          {steps.map((step, i) => (
            <li key={step.title} className="splash__step" style={{ animationDelay: `calc(var(--stagger) * ${i + 2})` }}>
              <span className="splash__step-num" aria-hidden="true">{i + 1}</span>
              <span>
                <span className="splash__step-title">{step.title}</span>
                <span className="splash__step-body">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>
        {notice && (
          <p className="notice" role="status" data-testid="notice">
            <Icon name="alert" />
            {notice}
          </p>
        )}
        <div className="splash__cta">
          <Button
            ref={start}
            variant="primary"
            size="lg"
            kbd="Enter"
            onClick={onStart}
            busy={restoring}
            busyLabel="Checking for a race…"
            data-testid="btn-start"
          >
            {startLabel ?? 'Start'}
          </Button>
          <p className="text-2">{footnote ?? 'Most egg points in the least time wins. About 6 minutes.'}</p>
        </div>
        {mode === 'local_demo' && <p className="caps splash__demo">Local demo: scores aren’t verified or ranked live</p>}
      </div>
      {needsFullscreen && (
        <div className="toast toast--info splash__toast" role="status">
          <Icon name="maximize" />
          Press <kbd>F</kbd> for fullscreen
        </div>
      )}
    </main>
  );
}
