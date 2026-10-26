// 2D fallback cinematic used when WebGL / the 3D scene is unavailable: a CSS lake strip with the boat,
// Hyde and the leg's events in order. Purely presentational: it replays the backend's LegResolution.
import { useEffect, useMemo, useState } from 'react';
import type { LegResolution } from '../../game/index.ts';
import type { RaceBeat } from '../../app/sceneHost.ts';
import { Icon } from '../Icon.tsx';
import { captionFor } from './captions.ts';

interface FallbackRaceProps {
  resolution: LegResolution;
  reducedMotion: boolean;
  durationMs: number;
  onBeat: (beat: RaceBeat) => void;
  onDone: () => void;
}

export const fallbackDurationMs = (reducedMotion: boolean) => (reducedMotion ? 2600 : 4800);

function beatsFor(r: LegResolution): { t: number; beat: RaceBeat }[] {
  const beats: { t: number; beat: RaceBeat }[] = [{ t: 0, beat: 'start' }, { t: 0.08, beat: 'route' }];
  if (r.eggAttempted) beats.push({ t: 0.3, beat: 'egg' });
  if (r.crashOccurred) beats.push({ t: 0.45, beat: 'crash' });
  if (r.route === 'shortcut' || r.hydeCatch) beats.push({ t: 0.58, beat: 'hyde' });
  if (r.hydeCatch) beats.push({ t: 0.7, beat: 'catch' });
  else if (r.route === 'shortcut') beats.push({ t: 0.7, beat: 'escape' });
  if (r.outcome === 'dnf') beats.push({ t: 0.85, beat: 'dnf' });
  else beats.push({ t: 0.88, beat: 'dock' }, ...(r.outcome === 'finished' ? [{ t: 0.95, beat: 'finish' as const }] : []));
  return beats;
}

export function FallbackRace({ resolution, reducedMotion, durationMs, onBeat, onDone }: FallbackRaceProps) {
  const beats = useMemo(() => beatsFor(resolution), [resolution]);
  const [seen, setSeen] = useState<RaceBeat[]>([]);

  useEffect(() => {
    const timers = beats.map(({ t, beat }) =>
      setTimeout(() => {
        setSeen((s) => [...s, beat]);
        onBeat(beat);
      }, t * durationMs),
    );
    timers.push(setTimeout(onDone, durationMs + 400));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lines = seen.map((b) => captionFor(b, resolution)).filter((x): x is string => Boolean(x));
  const dnf = resolution.outcome === 'dnf';

  return (
    <section className="panel fallback-race" aria-label="Race replay (2D)" data-testid="fallback-race">
      <p className="caps">3D view unavailable · 2D replay</p>
      <div className={`fallback-lake${reducedMotion ? ' is-static' : ''}`} style={{ ['--race-ms' as string]: `${durationMs}ms` }}>
        <span className={`fallback-lake__boat${dnf ? ' is-wrecked' : ''}`}><Icon name="boat" /></span>
        <span className="fallback-lake__hyde"><Icon name="ghost" /></span>
        <span className="fallback-lake__dock"><Icon name="flag" /></span>
      </div>
      <ol className="fallback-events">
        {lines.map((l) => <li key={l}>{l}</li>)}
      </ol>
    </section>
  );
}
