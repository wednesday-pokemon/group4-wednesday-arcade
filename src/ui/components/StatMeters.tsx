// StatMeters (UX_SPEC §4): caps label over value + icon, every state has a word. Values flash on change.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../Icon.tsx';
import { fmtM } from '../format.ts';

function useFlash(value: unknown): boolean {
  const prev = useRef(value);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 600);
    return () => clearTimeout(t);
  }, [value]);
  return flash;
}

interface StatProps {
  label: string;
  icon: IconName;
  value: ReactNode;
  flashKey: unknown;
  children?: ReactNode;
  tone?: 'ok' | 'warn' | 'danger';
  testId?: string;
  className?: string;
}

export function Stat({ label, icon, value, flashKey, children, tone, testId, className }: StatProps) {
  const flash = useFlash(flashKey);
  return (
    <div className={`stat${flash ? ' stat--flash' : ''}${tone ? ` stat--${tone}` : ''}${className ? ` ${className}` : ''}`} data-testid={testId}>
      <span className="caps stat__label">{label}</span>
      <span className="stat__value num">
        <Icon name={icon} />
        {value}
      </span>
      {children}
    </div>
  );
}

export function hpBand(hp: number): { tone: 'ok' | 'warn' | 'danger'; word: string | null } {
  if (hp > 50) return { tone: 'ok', word: null };
  if (hp > 25) return { tone: 'warn', word: 'Low' };
  return { tone: 'danger', word: 'Critical' };
}

export function leadBand(gapM: number): { tone: 'ok' | 'warn' | 'danger'; word: string } {
  if (gapM >= 70) return { tone: 'ok', word: 'Safe' };
  if (gapM >= 40) return { tone: 'warn', word: 'Closing' };
  return { tone: 'danger', word: 'Danger' };
}

export function HpMeter({ hp }: { hp: number }) {
  const band = hpBand(hp);
  return (
    <Stat label="HP" icon="heart" value={<>{hp}<span className="stat__unit">/100</span></>} flashKey={hp} tone={band.tone} testId="stat-hp">
      <span className="meter-bar" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(100, hp))}%` }} /></span>
      {band.word && <span className="stat__word">{band.word}</span>}
    </Stat>
  );
}

/** Pips: filled = available, hatched = reserved for later legs, lantern outline = cost of the previewed push. */
export function StaminaMeter({ stamina, reserve, previewCost }: { stamina: number; reserve: number; previewCost: number }) {
  const pips = Array.from({ length: stamina }, (_, i) => {
    const reserved = i >= stamina - reserve;
    const spend = i < previewCost;
    return <span key={i} className={`pip${reserved ? ' pip--reserved' : ''}${spend ? ' pip--spend' : ''}`} />;
  });
  return (
    <Stat label="Stamina" icon="zap" value={stamina} flashKey={stamina} testId="stat-stamina">
      <span className="pips" aria-hidden="true">{pips}</span>
      {reserve > 0 && <span className="stat__word">keep {reserve}</span>}
    </Stat>
  );
}

export function LeadMeter({ gapM }: { gapM: number }) {
  const band = leadBand(gapM);
  const pos = Math.max(0, Math.min(1, gapM / 120));
  return (
    <Stat label="Lead" icon="lead" value={fmtM(gapM)} flashKey={gapM} tone={band.tone} testId="stat-lead">
      <span className="mini-track" aria-hidden="true">
        <span className="mini-track__hyde" />
        <span className="mini-track__boat" style={{ left: `${pos * 100}%` }} />
      </span>
      <span className="stat__word">{band.word}</span>
    </Stat>
  );
}

export function CatchesMeter({ catches }: { catches: number }) {
  return (
    <Stat label="Catches" icon="ghost" value={`${catches}/2`} flashKey={catches} tone={catches >= 1 ? 'danger' : undefined} testId="stat-catches">
      <span className="ghost-slots" aria-hidden="true">
        <span className={catches >= 1 ? 'is-on' : ''} />
        <span className={catches >= 2 ? 'is-on' : ''} />
      </span>
      {catches === 1 && <span className="stat__word">Next catch ends it</span>}
    </Stat>
  );
}
