// Splash (UX_SPEC §3): left column over scrim, 3D backdrop on the right, single Start CTA. Final wave (UX_FINAL §5): an
// optional right-column `board` (home leaderboard panel) + a topline `boardButton` (shown < 1100 px instead of the
// panel). Start keeps the initial focus; Enter starts only when focus is neutral (never hijacks another control).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TUTORIAL_STEPS } from '../../game/copy.ts';
import type { BackendMode } from '../../lib/backend.ts';
import { focusIsNeutral, useHotkeys, useScreenFocus } from '../../app/keyboard.ts';
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
  /** Mystery v3.1: subtitle under the title (default: "A Nevermore Mystery"). */
  subtitle?: string;
  /** Mystery v3.1: one-line tagline under the subtitle. */
  tagline?: string;
  /** Mystery v3.1: emblem slot (Thing) shown above the title. */
  emblem?: ReactNode;
  /** Mystery v3.1: small caps line above the title (e.g. "Pokémon Day III · Halloween Arcade"). */
  kicker?: string;
  /** Accessible name for the steps list (mystery: the tagline verbatim). */
  stepsLabel?: string;
  /** The "Press F for fullscreen" toast (false in the mystery journey: F is the character power). */
  fullscreenHint?: boolean;
  /** Final wave: the home leaderboard panel (right column; never takes focus). */
  board?: ReactNode;
  /** Final wave: the topline trophy button that opens the full board on narrow screens. */
  boardButton?: ReactNode;
  /** Optional How to Play button slot, rendered next to the Start CTA. */
  howToPlay?: ReactNode;
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

export function Splash({
  stationName, mode, tools, notice, restoring, onStart, steps = TUTORIAL_STEPS, footnote, startLabel, subtitle, tagline, emblem,
  kicker, stepsLabel, fullscreenHint = true, board, boardButton, howToPlay,
}: SplashProps) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const needsFullscreen = useNeedsFullscreenHint();
  useScreenFocus(h1, start);
  useHotkeys((key) => {
    // Enter on another control (mute, the leaderboard button, …) belongs to that control.
    if (key === 'enter' && document.activeElement !== start.current && focusIsNeutral(null) && !restoring) {
      onStart();
      return true;
    }
  });

  return (
    <main className="screen screen--splash scrim-left" data-testid="screen-splash">
      <header className="topline">
        <span className="caps">{stationName}</span>
        {boardButton ? <div className="splash__tools">{boardButton}{tools}</div> : tools}
      </header>
      <div className="splash__col">
        <div className={emblem ? 'splash__brand' : undefined}>
          {emblem}
          {kicker && <p className="caps splash__kicker">{kicker}</p>}
          <h1 ref={h1} tabIndex={-1} className="title splash__title">
            Nevermore: <span className="splash__title-2">Deadly Secrets</span>
          </h1>
        </div>
        <p className="splash__subtitle">{subtitle ?? 'A Nevermore Mystery'}</p>
        {tagline && <p className="splash__tagline" data-testid="splash-tagline">{tagline}</p>}
        <ol className="splash__steps" aria-label={stepsLabel}>
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
          {howToPlay}
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
        {mode === 'local_demo' && !board && <p className="caps splash__demo">Local demo: scores aren’t verified or ranked live</p>}
      </div>
      {board}
      {fullscreenHint && needsFullscreen && (
        <div className="toast toast--info splash__toast" role="status">
          <Icon name="maximize" />
          Press <kbd>F</kbd> for fullscreen
        </div>
      )}
    </main>
  );
}
