// Hyde proximity "boss bar" (UX_V3_ACTION §2), top-centre: state icon + word, 70 m → 0 m track with the claw marker
// sliding toward the boat glyph, permanently hatched 0–15 m zone, true gap (even in fog) and the catch pips.
import { useEffect, useRef } from 'react';
import { announce } from '../../app/announce.tsx';
import { DANGER_COPY, type DangerLevel } from '../../app/v3/danger.ts';
import { Icon } from '../Icon.tsx';

const TRACK_M = 70;
const HATCH_M = 15;

interface HydeMeterProps {
  active: boolean;
  gap: number;
  level: DangerLevel;
  surge: boolean;
  catches: number;
}

export function HydeMeter({ active, gap, level, surge, catches }: HydeMeterProps) {
  // A telegraphed surge reads as SURGE INCOMING at once (even before the 0.5 s level hold lets the meter step up).
  const surging = active && surge && level < 2;
  const word = !active ? 'Unseen' : surging ? 'Surge incoming' : DANGER_COPY[level].word;
  const icon = !active ? 'eyeClosed' : surging ? 'eye' : DANGER_COPY[level].icon;
  const pos = active ? 1 - Math.min(gap, TRACK_M) / TRACK_M : 0;
  const gapText = !active ? '—' : gap > TRACK_M ? '70+ m' : `${Math.max(0, Math.round(gap))} m`;
  useLevelAnnouncement(active ? level : 0, word);
  return (
    <section className="hyde-meter" data-level={active ? Math.max(level, surging ? 1 : 0) : 0} data-surge={surging || undefined} aria-label="Hyde proximity" data-testid="hud-hyde">
      <span className="hyde-meter__state">
        <Icon name={icon} />
        <span className="hyde-meter__word">{word}</span>
      </span>
      <span className="hyde-meter__track" aria-hidden="true">
        <span className="hyde-meter__hatch" style={{ width: `${(HATCH_M / TRACK_M) * 100}%` }} />
        {active && <span className="hyde-meter__marker" style={{ left: `${pos * 100}%` }}><Icon name="claw" /></span>}
        <span className="hyde-meter__boat"><Icon name="boat" /></span>
      </span>
      <span className="hyde-meter__gap num" data-testid="hud-hyde-gap">{gapText}</span>
      <span className="hyde-meter__pips" aria-label={`Catches ${catches} of 2`} data-testid="hud-catches">
        <span className="caps">Caught</span>
        <span className={`pip-claw${catches >= 1 ? ' is-on' : ''}`} aria-hidden="true" />
        <span className={`pip-claw${catches >= 2 ? ' is-on' : ''}`} aria-hidden="true" />
        <span className="num hyde-meter__count">{catches}/2</span>
      </span>
    </section>
  );
}

/** Screen-reader note on level changes, at most one per 3 s. */
function useLevelAnnouncement(level: DangerLevel, word: string): void {
  const last = useRef({ level, at: 0 });
  useEffect(() => {
    const now = performance.now();
    if (level === last.current.level || now - last.current.at < 3000) return;
    last.current = { level, at: now };
    announce(`Hyde: ${word}`);
  }, [level, word]);
}
