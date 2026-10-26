// Threats strip (docs/final/UX_FINAL.md §1a): three fixed 200×40 chips at y56, gap 8, centred (x375–991 with all three),
// fixed order Hyde · Crackstone · Slurp, an absent monster omitted. Each chip = caps kicker + state word + icon + a 3 px
// meter inside the bottom edge. Silhouettes differ in greyscale: Hyde full pill + solid meter · Crackstone square +
// segmented meter + double alarm border · Slurp "drooping coffin" (4 4 18 18 radius) + dotted meter + 3–4 px alarm
// border with glow. Director states (Arrives in 0:20 / Arriving soon / Away): opacity .6, 1.5 px dotted border, no meter.
// aria-live assertive only on CHASE / ATTACK.
import { memo } from 'react';
import type { ThreatChipView } from '../../../app/mystery/hud/enemies.ts';
import { HudIcon } from './HudIcon.tsx';

const ARIA: Record<ThreatChipView['enemy'], string> = { hyde: 'The Hyde', crackstone: 'Joseph Crackstone', slurp: 'Slurp' };
const TESTID: Record<ThreatChipView['enemy'], string> = { hyde: 'hud-hyde', crackstone: 'hud-crack', slurp: 'hud-slurp' };

export const ThreatsStrip = memo(function ThreatsStrip({ chips }: { chips: readonly ThreatChipView[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="mhud-threats mhud-threats--v3" data-testid="hud-threats" data-count={chips.length}>
      {chips.map((c) => <ThreatChip key={c.enemy} c={c} />)}
    </div>
  );
});

function ThreatChip({ c }: { c: ThreatChipView }) {
  const pct = c.meter === null ? null : Math.round(c.meter * 100);
  return (
    <section
      className={`mhud-chip mhud-chip--${c.enemy}${c.director ? ' is-director' : ''}`}
      data-enemy={c.enemy}
      data-state={c.state}
      aria-label={ARIA[c.enemy]}
      data-testid={TESTID[c.enemy]}
    >
      <p className="mhud-chip__state" aria-live={c.assertive ? 'assertive' : 'polite'}>
        <HudIcon name={c.icon} />
        <span className="mhud-chip__stack">
          <span className="mhud-chip__kicker" aria-hidden="true">{c.kicker}</span>
          <span className="mhud-chip__word num" data-testid={`${TESTID[c.enemy]}-word`}>{c.word}</span>
        </span>
      </p>
      {pct !== null && (
        <span className="mhud-chip__meter" role="meter" aria-label={`${ARIA[c.enemy]} suspicion`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
      {c.effect && (
        <span className="mhud-chip__effect" data-testid={`${TESTID[c.enemy]}-effect`}>
          {c.effect.word}{c.effect.leftS !== null && <span className="num"> {c.effect.leftS.toFixed(1)} s</span>}
        </span>
      )}
    </section>
  );
}
