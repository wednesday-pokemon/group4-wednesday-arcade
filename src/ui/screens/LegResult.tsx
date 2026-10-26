// Leg result card (UX_SPEC): story lines (resolution + ability events + explainLeg + copy), additive
// time waterfall with an accessible table, and before → after stats. Everything comes from the backend.
import { useEffect, useRef, type ReactNode } from 'react';
import { OUTCOME_COPY } from '../../game/copy.ts';
import type { LegResolution } from '../../game/index.ts';
import { explainLeg } from '../../analytics/diagnostics.ts';
import { announce } from '../../app/announce.tsx';
import { useScreenFocus } from '../../app/keyboard.ts';
import { Button } from '../components/Button.tsx';
import { Waterfall } from '../components/Waterfall.tsx';
import { Icon, WEATHER_ICON, type IconName } from '../Icon.tsx';
import { EGG_LABEL, MINUS, fmtDS, fmtM, fmtPct, fmtPts, fmtS, routeName, weatherName } from '../format.ts';

interface LegResultProps {
  resolution: LegResolution;
  raceTimeCs: number;
  tools: ReactNode;
  onNext: () => void;
}

interface StoryLine { icon: IconName; text: string; tone?: 'danger' | 'good' }

const MAX_LINES = 7;

function flavour(r: LegResolution): string {
  if (r.outcome === 'dnf') return r.dnfReason === 'second_catch' ? OUTCOME_COPY.hydeCatchSecondDnf : OUTCOME_COPY.dnf;
  if (r.catchType === 'proximity') return OUTCOME_COPY.proximityCatch;
  if (r.hydeCatch) return OUTCOME_COPY.hydeCatchFirst;
  if (r.crashOccurred) return r.crashNegatedBy ? OUTCOME_COPY.crashNegated : OUTCOME_COPY.crash;
  if (r.outcome === 'finished') return OUTCOME_COPY.raceFinished;
  return OUTCOME_COPY.legSurvived;
}

export function storyLines(r: LegResolution): StoryLine[] {
  const lines: StoryLine[] = [];
  lines.push({ icon: 'boat', text: `${routeName(r.route)}, push ${r.pushLevel}: ${MINUS}${r.time.discountPct}% time` });
  if (r.time.weatherDelayCs > 0) lines.push({ icon: WEATHER_ICON[r.weather], text: `${weatherName(r.weather)}: ${fmtDS(r.time.weatherDelayCs)}` });
  if (r.crashOccurred) {
    lines.push(r.crashNegatedBy
      ? { icon: 'alert', text: 'Crash, but your ability took the hit' }
      : { icon: 'alert', text: `Crash: ${MINUS}${r.crashHpLoss} HP, ${fmtDS(r.time.crashDelayCs)}`, tone: 'danger' });
  }
  if (r.eggOffer === 'none') lines.push({ icon: 'egg', text: 'No egg on this route' });
  else if (!r.eggAttempted) lines.push({ icon: 'egg', text: `Skipped the ${EGG_LABEL[r.eggOffer].toLowerCase()}` });
  else if (r.eggFailed) lines.push({ icon: 'egg', text: 'The egg slipped away in the crash', tone: 'danger' });
  else if (r.outcome !== 'dnf') lines.push({ icon: 'egg', text: `${EGG_LABEL[r.eggOffer]} banked: +${fmtPts(r.eggPointsBanked)}`, tone: 'good' });
  if (r.eggPointsLostToCatch > 0) lines.push({ icon: 'ghost', text: `Hyde took ${fmtPts(r.eggPointsLostToCatch)}`, tone: 'danger' });
  if (r.catchType === 'proximity') lines.push({ icon: 'ghost', text: 'Lead hit 0 m: Hyde simply caught you', tone: 'danger' });
  else if (r.hydeProbability !== null) {
    lines.push({
      icon: 'ghost',
      text: `Hyde catch chance ${fmtPct(r.hydeProbability)}: ${r.hydeCatch ? `caught (${r.catchNumber} of 2)` : 'escaped'}`,
      tone: r.hydeCatch ? 'danger' : 'good',
    });
  }
  r.abilityEvents.forEach((e) => lines.push({ icon: 'sparkle', text: e.message }));
  const why = explainLeg(r)[0];
  if (why && lines.length < MAX_LINES) lines.push({ icon: 'timer', text: why });
  return lines.slice(0, MAX_LINES);
}

function heading(r: LegResolution): { title: string; badge: string; tone: string } {
  if (r.outcome === 'dnf') return { title: `Leg ${r.legIndex} · Out of the race`, badge: 'Out of the race', tone: 'danger' };
  if (r.outcome === 'finished') return { title: `Leg ${r.legIndex} complete · Final dock`, badge: 'Finished', tone: 'good' };
  return { title: `Leg ${r.legIndex} complete`, badge: 'Survived', tone: 'good' };
}

export function LegResult({ resolution: r, raceTimeCs, tools, onNext }: LegResultProps) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  useScreenFocus(h1, next);
  const head = heading(r);

  useEffect(() => {
    announce(
      `Leg ${r.legIndex} ${r.outcome === 'dnf' ? 'ended your race' : 'complete'}. Leg time ${(r.time.totalCs / 100).toFixed(2)} seconds. ` +
        `HP ${r.hpEnd}. Lead ${r.gapEndM} metres. Banked ${r.bankedAfter} egg points. Race time ${(raceTimeCs / 100).toFixed(2)} seconds.`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="screen screen--overlay" data-testid="screen-result">
      <div className="overlay-scrim" aria-hidden="true" />
      <header className="topline topline--overlay">
        <span />
        {tools}
      </header>
      <section className="panel result-card" aria-labelledby="result-title">
        <header className="result-card__head">
          <h1 ref={h1} id="result-title" tabIndex={-1} className="display result-card__title">
            {head.title} <span className="result-card__leg">· {r.legName}</span>
          </h1>
          <span className={`badge badge--${head.tone}`} data-testid="leg-outcome">{head.badge}</span>
        </header>
        <div className="result-card__body">
          <div>
            <h2 className="caps">What happened</h2>
            <p className="result-card__flavour">{flavour(r)}</p>
            <ul className="story" data-testid="story-lines">
              {storyLines(r).map((l) => (
                <li key={l.text} className={l.tone ? `story--${l.tone}` : undefined}>
                  <Icon name={l.icon} />
                  <span>{l.text}</span>
                </li>
              ))}
            </ul>
          </div>
          <Waterfall time={r.time} />
        </div>
        <footer className="result-card__foot">
          <dl className="result-stats">
            <Change label="HP" from={String(r.hpStart)} to={String(r.hpEnd)} />
            <Change label="Lead" from={fmtM(r.gapStartM)} to={fmtM(r.gapEndM)} />
            <Change label="Stamina" from={String(r.staminaStart)} to={String(r.staminaEnd)} />
            <Change label="Eggs banked" from={fmtPts(r.bankedBefore)} to={fmtPts(r.bankedAfter)} />
            <div><dt className="caps">Race time</dt><dd className="num">{fmtS(raceTimeCs)}</dd></div>
          </dl>
          <Button ref={next} variant="primary" size="lg" kbd="Enter" onClick={onNext} data-testid="btn-next-leg">
            {r.outcome === 'survived' ? 'Next leg' : 'See results'}
          </Button>
        </footer>
      </section>
    </main>
  );
}

function Change({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <div>
      <dt className="caps">{label}</dt>
      <dd className="num">{from} <span aria-hidden="true">→</span><span className="sr-only">to</span> {to}</dd>
    </div>
  );
}
