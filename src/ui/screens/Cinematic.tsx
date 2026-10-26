// Cinematic (UX_SPEC): minimal HUD — top-left pill, bottom-left event caption, Skip after 2 s.
// Plays the 3D scene when available, otherwise a readable 2D fallback. Skipping never changes data.
import { useEffect, useRef, useState } from 'react';
import type { LegResolution } from '../../game/index.ts';
import { announce } from '../../app/announce.tsx';
import { audio } from '../../app/audio.ts';
import { useHotkeys } from '../../app/keyboard.ts';
import type { RaceBeat, RaceSceneLike } from '../../app/sceneHost.ts';
import { Button } from '../components/Button.tsx';
import { FallbackRace, fallbackDurationMs } from './FallbackRace.tsx';
import { fmtM } from '../format.ts';
import { alertFor, captionFor } from './captions.ts';

const SKIP_DELAY_MS = 2000;
const CAPTION_MS = 1500;
const WATCHDOG_MS = 25000;

interface CinematicProps {
  resolution: LegResolution;
  scene: RaceSceneLike | null;
  reducedMotion: boolean;
  onDone: () => void;
}

const BEAT_SOUND: Partial<Record<RaceBeat, Parameters<typeof audio.play>[0]>> = { crash: 'thud', hyde: 'growl', catch: 'sting' };

export function Cinematic({ resolution, scene, reducedMotion, onDone }: CinematicProps) {
  const [caption, setCaption] = useState<string | null>(null);
  const [canSkip, setCanSkip] = useState(false);
  const [settled, setSettled] = useState(false);
  const doneRef = useRef(false);
  const skippingRef = useRef(false);
  const startedRef = useRef(false);
  const captionTimer = useRef<ReturnType<typeof setTimeout>>();
  const r = resolution;

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  };

  const onBeat = (beat: RaceBeat) => {
    if (beat === 'crash' && !r.crashOccurred) return;
    if (beat === 'catch' && !r.hydeCatch) return;
    const alert = alertFor(beat, r);
    if (alert) announce(alert, 'alert');
    if (beat === 'dock' || beat === 'finish' || beat === 'dnf') setSettled(true);
    // Beats flushed by skip() update state but stay silent and caption-free.
    if (skippingRef.current) return;
    const text = captionFor(beat, r);
    if (text) {
      setCaption(text);
      clearTimeout(captionTimer.current);
      captionTimer.current = setTimeout(() => setCaption(null), CAPTION_MS);
    }
    const sound = BEAT_SOUND[beat];
    if (sound) audio.play(sound);
  };

  useEffect(() => {
    const skipTimer = setTimeout(() => setCanSkip(true), SKIP_DELAY_MS);
    const watchdog = setTimeout(finish, WATCHDOG_MS);
    // Start exactly once per mount (StrictMode re-runs effects; a second playLeg would skip the first).
    if (scene && !startedRef.current) {
      startedRef.current = true;
      scene.playLeg(r, onBeat).then(finish, finish);
    }
    return () => {
      clearTimeout(skipTimer);
      clearTimeout(watchdog);
      clearTimeout(captionTimer.current);
    };
    // Plays once per resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skip = () => {
    if (!canSkip) return;
    skippingRef.current = true;
    if (scene) scene.skip();
    else finish();
  };

  useHotkeys((key) => {
    if ((key === ' ' || key === 'enter') && canSkip) {
      skip();
      return true;
    }
    return key === ' ' || key === 'enter';
  });

  const hp = settled ? r.hpEnd : r.hpStart;
  const lead = settled ? r.gapEndM : r.gapStartM;

  return (
    <main className="screen screen--cinematic" data-testid="screen-cinematic">
      <h1 className="sr-only">Leg {r.legIndex} in progress</h1>
      <p className="cine-pill" data-testid="cine-pill">
        Leg {r.legIndex} · {r.legName} · HP {hp} · Lead {fmtM(lead)}
      </p>
      {!scene && (
        <FallbackRace resolution={r} reducedMotion={reducedMotion} onBeat={onBeat} onDone={finish} durationMs={fallbackDurationMs(reducedMotion)} />
      )}
      <p className="cine-caption display" aria-hidden="true" data-testid="cine-caption">{caption}</p>
      {canSkip && (
        <div className="cine-skip">
          <Button variant="secondary" kbd="Space" onClick={skip} data-testid="btn-skip-animation">Skip animation</Button>
        </div>
      )}
    </main>
  );
}
