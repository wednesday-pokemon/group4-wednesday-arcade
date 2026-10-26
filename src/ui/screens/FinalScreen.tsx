// Victory / Defeat (UX_SPEC §3): score formula + rank (or clear DNF reason, unranked), race autopsy,
// per-leg predicted vs actual. "Next visitor" ignores activation for 2 s.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LegIndex, SessionView } from '../../game/index.ts';
import { buildRaceAutopsy } from '../../analytics/diagnostics.ts';
import { announce } from '../../app/announce.tsx';
import { audio } from '../../app/audio.ts';
import { useScreenFocus } from '../../app/keyboard.ts';
import type { LegNotes } from '../../app/flow.ts';
import { Button } from '../components/Button.tsx';
import { VerifiedBadge } from '../components/Badge.tsx';
import { Icon } from '../Icon.tsx';
import { fmtM, fmtPts, fmtS, fmtScore, fmtSecs, routeName, weatherShort } from '../format.ts';
import { storyLines } from './LegResult.tsx';

const NEXT_GUARD_MS = 2000;

interface FinalScreenProps {
  view: SessionView;
  notes: Partial<Record<LegIndex, LegNotes>>;
  rank: { rank: number; total: number } | null;
  reducedMotion: boolean;
  tools: ReactNode;
  onNextVisitor: () => void;
}

function useCountUp(target: number, enabled: boolean): number {
  const [value, setValue] = useState(enabled ? 0 : target);
  useEffect(() => {
    if (!enabled) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1400);
      setValue(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled]);
  return value;
}

export function FinalScreen({ view, notes, rank, reducedMotion, tools, onNextVisitor }: FinalScreenProps) {
  const { state } = view;
  const won = state.status === 'completed';
  const h1 = useRef<HTMLHeadingElement>(null);
  const [nextReady, setNextReady] = useState(false);
  useScreenFocus(h1);
  const score = state.finalScore ?? 0;
  const shown = useCountUp(score, won && !reducedMotion);

  useEffect(() => {
    const t = setTimeout(() => setNextReady(true), NEXT_GUARD_MS);
    audio.play(won ? 'fanfare' : 'toll');
    announce(won
      ? `Race complete. Score ${fmtScore(score)}.${rank ? ` Rank ${rank.rank} of ${rank.total}.` : ''}`
      : `Race over. ${state.dnfReason === 'second_catch' ? 'Hyde caught you twice.' : 'Your boat ran out of HP.'} Unranked.`);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastLeg = state.legResults.at(-1);
  const title = won ? 'You escaped Raven Island' : state.dnfReason === 'second_catch' ? 'Caught by Hyde' : 'Your boat is wrecked';

  return (
    <main className="screen screen--final scrim-full" data-testid="screen-final" data-outcome={won ? 'victory' : 'defeat'}>
      <header className="topline">
        <span className="caps">{state.nickname} · Final</span>
        {tools}
      </header>
      <div className="final">
        <section className="final__left">
          <h1 ref={h1} tabIndex={-1} className={`title final__title${won ? '' : ' final__title--defeat'}`}>
            {!won && <Icon name={state.dnfReason === 'second_catch' ? 'ghost' : 'skull'} className="danger-text" />}
            {title}
          </h1>
          {won ? (
            <>
              <p className="caps">Final score</p>
              <p className="final__score num" aria-hidden="true" data-testid="final-score">{fmtScore(Math.round(shown * 100) / 100)}</p>
              <p className="sr-only">Final score {fmtScore(score)}</p>
              <p className="final__formula num">
                {fmtPts(state.finalEggPoints ?? 0)} × 100 − {fmtS(state.totalSimulatedTimeCs)}
              </p>
              <p className="final__rank">
                {rank ? <span data-testid="final-rank">Rank #{rank.rank} of {rank.total} on the board</span> : <span className="text-2">Rank appears once the board updates</span>}
                <VerifiedBadge verified={view.verified} label={view.verified ? 'Verified' : 'Demo / Unverified'} />
              </p>
            </>
          ) : (
            <>
              <p className="final__reason danger-text" data-testid="dnf-reason">
                Leg {lastLeg?.legIndex ?? state.legIndex} · {state.dnfReason === 'second_catch' ? 'second Hyde catch' : 'HP reached 0'}
              </p>
              <p className="final__unranked">Unranked: runs that don’t finish score 0 and stay off the board.</p>
              {lastLeg && (
                <ul className="story final__story">
                  {storyLines(lastLeg).slice(0, 3).map((l) => (
                    <li key={l.text}><Icon name={l.icon} /><span>{l.text}</span></li>
                  ))}
                </ul>
              )}
              <VerifiedBadge verified={view.verified} label={view.verified ? 'Verified' : 'Demo / Unverified'} />
            </>
          )}
          <div className="final__cta">
            <Button
              variant="primary"
              size="lg"
              kbd="Enter"
              aria-busy={!nextReady || undefined}
              onClick={() => nextReady && onNextVisitor()}
              data-testid="btn-next-visitor"
            >
              Next visitor
            </Button>
          </div>
        </section>
        <RaceAnalytics view={view} notes={notes} />
      </div>
    </main>
  );
}

function RaceAnalytics({ view, notes }: { view: SessionView; notes: Partial<Record<LegIndex, LegNotes>> }) {
  const results = view.state.legResults;
  const autopsy = buildRaceAutopsy(results);
  const advised = results.map((r) => notes[r.legIndex]?.followedAdvice).filter((x): x is boolean => x !== null && x !== undefined);
  const predicted = results.map((r) => notes[r.legIndex]?.prediction?.legTimeS);
  const allPredicted = predicted.every((p) => p !== undefined);
  const predictedTotal = predicted.reduce<number>((s, p) => s + (p ?? 0), 0);

  return (
    <section className="panel final__right" aria-labelledby="race-title">
      <h2 id="race-title" className="caps">Your race</h2>
      <table className="race-table" data-testid="race-table">
        <thead>
          <tr><th scope="col">Leg</th><th scope="col">Route</th><th scope="col">Push</th><th scope="col">Weather</th><th scope="col">Predicted</th><th scope="col">Actual</th><th scope="col">Lead</th></tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.legIndex}>
              <th scope="row">{r.legIndex}</th>
              <td>{routeName(r.route)}</td>
              <td>{r.pushLevel}</td>
              <td>{weatherShort(r.weather)}</td>
              <td className="num">{notes[r.legIndex]?.prediction ? fmtSecs(notes[r.legIndex]!.prediction!.legTimeS) : '—'}</td>
              <td className="num">{fmtS(r.time.totalCs)}</td>
              <td className="num">{fmtM(r.gapEndM)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="race-badges">
        {results.map((r) => (
          <li key={r.legIndex}>
            <span className="caps">Leg {r.legIndex}</span>
            {r.crashOccurred && <span className="mini-badge mini-badge--danger">Crash</span>}
            {r.hydeCatch && <span className="mini-badge mini-badge--danger">Caught</span>}
            {r.eggPointsBanked > 0 && <span className="mini-badge mini-badge--egg">+{fmtPts(r.eggPointsBanked)}</span>}
            {!r.crashOccurred && !r.hydeCatch && r.eggPointsBanked === 0 && <span className="mini-badge">Quiet leg</span>}
          </li>
        ))}
      </ul>
      <dl className="autopsy">
        <div><dt>Advice followed</dt><dd>{advised.length ? `${advised.filter(Boolean).length} of ${advised.length} legs` : '—'}</dd></div>
        <div>
          <dt>Raven Vision</dt>
          <dd className="num">{allPredicted && results.length ? `${fmtSecs(predictedTotal)} predicted, ${fmtS(autopsy.totalCs)} actual` : `${fmtS(autopsy.totalCs)} actual`}</dd>
        </div>
        <div><dt>Speed saved</dt><dd className="num">{fmtS(autopsy.totalSavingsCs)}</dd></div>
        <div><dt>Biggest delay</dt><dd className="num">{autopsy.biggestDelay ? `${autopsy.biggestDelay.label}: ${fmtS(autopsy.biggestDelay.cs)}` : 'None'}</dd></div>
      </dl>
      {view.revealedSeed && <p className="final__seed muted">Seed: {view.revealedSeed.slice(0, 12)}…</p>}
    </section>
  );
}
