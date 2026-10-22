// Results (UX_MYSTERY §6): left column VerdictHeader · ScoreBreakdown · DuoBadge · board note · CTA; right column the four
// game-wide analytics LayerPanels from src/mystery/analytics (never placeholder numbers); below, "What really happened"
// (the case resolution + why each innocent is excluded). Mystery accuracy is a separate verdict, never part of the score.
// The answer key (CaseSolution) arrives as a PROP: the app loads it only after the accusation was committed — this
// module never imports data/solutions.ts. IdleReturn: after 45 s idle, a 20 s countdown back to Home (any key stays).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ResultsAnalytics } from '../../mystery/analytics/index.ts';
import { solutionMatches } from '../../mystery/caseLogic.ts';
import type { CaseDef, CaseSolution, RunResult, SuspectId } from '../../mystery/types.ts';
import { focusIsNeutral, useHotkeys, useScreenFocus } from '../../app/keyboard.ts';
import { thing as thingScript } from '../../app/mystery/thingLines.ts';
import { Button } from '../components/Button.tsx';
import { Icon } from '../Icon.tsx';
import { ROLE_ICON, ROLE_LABEL, type DuoCardView } from './duoView.ts';
import { LayerPanels } from './LayerPanels.tsx';
import { ThingNarrator } from './ThingNarrator.tsx';

interface MysteryResultsProps {
  result: RunResult;
  /** The four analytics panels (Phase 4); null → "Analytics unavailable for this run". */
  analytics: ResultsAnalytics | null;
  nickname: string;
  card: DuoCardView;
  /** The session's case (CASES[session.caseId]). */
  caseDef: CaseDef;
  /** The case's answer key, loaded after the accusation; null while loading / unavailable. */
  solution: CaseSolution | null;
  tools: ReactNode;
  onPlayAgain: () => void;
}

const TIER_TEXT = { common: 'Common', rare: 'Rare', legendary: 'Legendary' } as const;
const IDLE_S = 45;
const RETURN_S = 20;

export interface VerdictView { title: string; tone: 'solved' | 'unsolved' | 'dnf'; sub: string; extra: string | null }

/**
 * Verdict copy (pure; unit-tested). Post-accusation, so it is honest: a solved case names the culprit; the right
 * suspect with the wrong evidence is told so. `solution` (null while loading) decides "right suspect" when it matches
 * the case; otherwise `r.correct` (the run's / server's verdict on the accused) does.
 */
export function verdictView(r: RunResult, caseDef: CaseDef, solution: CaseSolution | null = null): VerdictView {
  const n = r.cluesFound.length;
  const total = caseDef.clues.length;
  const name = (id: string | null) => (id ? caseDef.suspects.find((s) => s.id === id)?.name ?? id : null);
  if (r.outcome === 'dnf') {
    return {
      title: 'Dragged into the fog', tone: 'dnf',
      sub: r.dnfReason === 'hp_depleted' ? 'HP ran out.' : 'Caught twice.',
      extra: 'Unranked — every finisher ranks above a DNF.',
    };
  }
  if (r.verdict === 'case_solved') {
    return { title: 'Case Solved', tone: 'solved', sub: `${name(r.accused ?? solution?.culprit ?? null)} did it. Every clue held.`, extra: null };
  }
  if (r.verdict === 'not_accused' || r.accused === null) {
    return { title: 'Egg Secured, Mystery Unsolved', tone: 'unsolved', sub: `You left the case unsolved — ${n} of ${total} clues found.`, extra: null };
  }
  const key = solution && solutionMatches(caseDef, solution) ? solution : null;
  const rightSuspect = key ? key.culprit === r.accused : r.correct;
  if (rightSuspect) {
    return {
      title: 'Egg Secured, Mystery Unsolved', tone: 'unsolved',
      sub: `Right suspect — but the evidence you cited doesn’t prove it. ${n} of ${total} clues found.`,
      extra: n < total ? `Proving it takes all ${total} clues.` : null,
    };
  }
  return { title: 'Egg Secured, Mystery Unsolved', tone: 'unsolved', sub: `You accused ${name(r.accused)}. The case didn’t hold — ${n} of ${total} clues found.`, extra: null };
}

export interface CaseTruthView {
  culprit: string;
  resolution: string;
  innocents: { id: SuspectId; name: string; why: string }[];
  /** Titles of the evidence that proves the case (method, opportunity, broken alibi). */
  proof: string[];
}

/** "What really happened" (pure; unit-tested). null when the answer key is missing or belongs to another case/version. */
export function caseTruthView(caseDef: CaseDef, solution: CaseSolution | null): CaseTruthView | null {
  if (!solution || !solutionMatches(caseDef, solution)) return null;
  const nameOf = (id: SuspectId) => caseDef.suspects.find((s) => s.id === id)?.name ?? id;
  return {
    culprit: nameOf(solution.culprit),
    resolution: solution.resolution,
    innocents: caseDef.suspects
      .filter((s) => s.id !== solution.culprit && solution.innocents[s.id])
      .map((s) => ({ id: s.id, name: s.name, why: solution.innocents[s.id]! })),
    proof: solution.supportingEvidence.map((id) => caseDef.clues.find((c) => c.id === id)?.title ?? id),
  };
}

/** One decimal with a true minus sign (U+2212) for negatives. */
export function fmtScore(v: number): string {
  const s = (Math.round(Math.abs(v) * 10) / 10).toFixed(1);
  return v < 0 ? `−${s}` : s;
}

export function MysteryResults({ result: r, analytics, nickname, card, caseDef, solution, tools, onPlayAgain }: MysteryResultsProps) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const again = useRef<HTMLButtonElement>(null);
  useScreenFocus(h1, again);
  useHotkeys((key) => {
    if (key === 'enter' && focusIsNeutral(again.current)) {
      onPlayAgain();
      return true;
    }
  });
  const returning = useIdleReturn(onPlayAgain);
  const v = verdictView(r, caseDef, solution);
  const truth = caseTruthView(caseDef, solution);
  const finished = r.outcome === 'finished' && r.score !== null;
  const thing = r.outcome === 'dnf' ? thingScript.dnf(r.dnfReason ?? 'second_catch') : thingScript.result(r.verdict);

  return (
    <main className="screen mys-results scrim-full" data-testid="screen-results" data-verdict={r.outcome === 'dnf' ? 'dnf' : r.verdict} data-case={caseDef.id}>
      <header className="topline">
        <span className="caps">{nickname || 'Guest'} · Nevermore: Deadly Secrets</span>
        {tools}
      </header>

      <div className="mys-results__grid">
        <section className="mys-results__left">
          <div className={`mys-verdict mys-verdict--${v.tone}${v.title.length > 16 ? ' mys-verdict--long' : ''}`}>
            <p className="caps">Verdict · Case {caseDef.number} · {caseDef.title}</p>
            <h1 id="verdict-title" ref={h1} tabIndex={-1} className="mys-verdict__title display" data-testid="verdict-title">
              <Icon name={v.tone === 'dnf' ? 'claw' : v.tone === 'solved' ? 'shieldCheck' : 'egg'} />
              {v.title}
            </h1>
            <p className="mys-verdict__sub" data-testid="verdict-sub">{v.sub}</p>
            {v.extra && <p className="mys-verdict__extra text-2">{v.extra}</p>}
          </div>

          {finished ? (
            <div className="mys-score" data-testid="score-breakdown">
              <dl>
                <div><dt>Egg points</dt><dd className="num">{r.eggPoints} × 100 = {r.eggPoints * 100}</dd></div>
                <div><dt>Active time</dt><dd className="num">{'−'} {r.activeTimeS.toFixed(1)} s</dd></div>
                <div className="mys-score__total"><dt>Score</dt><dd className="num" data-testid="score-total">{fmtScore(r.score!)}</dd></div>
              </dl>
              <p className="mys-score__note">
                Mystery: {r.verdict === 'case_solved' ? 'Solved' : 'Unsolved'} — tracked separately, not part of the score.
                {r.score! < 0 && ' Negative scores still rank above every DNF.'}
              </p>
              <p className="mys-score__facts text-2">
                <Icon name="egg" /> {TIER_TEXT[r.eggTier]} egg · security {Math.round(r.eggSecurity)} · caught {r.catches}/2
              </p>
            </div>
          ) : (
            <p className="mys-score mys-score--dnf" data-testid="score-breakdown">No score. Active time {r.activeTimeS.toFixed(1)} s.</p>
          )}

          <div className="mys-duo">
            <img src={card.characterArt} alt="" width={48} height={48} />
            <img src={card.pokemonArt} alt="" width={48} height={48} />
            <span>
              <span className="mys-duo__name display">{card.duoName}</span>
              <span className="mys-duo__sub text-2"><Icon name={ROLE_ICON[card.role]} /> {ROLE_LABEL[card.role]} · {card.characterShort} &amp; {card.pokemonName}</span>
            </span>
          </div>

          <p className="mys-board-note text-2"><Icon name="trophy" /> Today’s board (mystery-v3.1) appears when this station is connected to the leaderboard service.</p>

          <div className="mys-results__cta">
            <Button ref={again} variant="primary" size="lg" kbd="Enter" onClick={onPlayAgain} data-testid="btn-play-again">New investigation</Button>
          </div>
        </section>

        <LayerPanels report={analytics} />
      </div>

      <footer className="mys-results__foot">
        <section className="mys-truth" aria-labelledby="truth-title" data-testid="case-truth" data-state={truth ? 'open' : 'loading'}>
          <div className="mys-truth__head">
            <h2 id="truth-title" className="mys-truth__title display">What really happened</h2>
            <ThingNarrator text={thing.text} pose={thing.pose} inline />
          </div>
          {truth ? (
            <div className="mys-truth__body">
              <div className="mys-truth__main">
                <p className="mys-truth__resolution" data-testid="case-resolution">{truth.resolution}</p>
                <p className="mys-truth__proof"><Icon name="link" /> The proof: {truth.proof.join(' · ')}</p>
              </div>
              <ul className="mys-truth__innocents" aria-label="Why the others are cleared">
                {truth.innocents.map((i) => (
                  <li key={i.id} data-testid={`innocent-${i.id}`}><span className="mys-truth__name">{i.name}</span> {i.why}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mys-truth__loading text-2" role="status">Opening the case file…</p>
          )}
        </section>
      </footer>

      {returning !== null && (
        <p className="idle-return" role="status" data-testid="idle-return">Returning home in {returning} s — press any key to stay</p>
      )}
    </main>
  );
}

/** After 45 s without input, count down 20 s and return home; any key / pointer input cancels. */
function useIdleReturn(onReturn: () => void): number | null {
  const [left, setLeft] = useState<number | null>(null);
  const idleSince = useRef(performance.now());
  const cb = useRef(onReturn);
  cb.current = onReturn;
  useEffect(() => {
    const bump = () => {
      idleSince.current = performance.now();
      setLeft(null);
    };
    window.addEventListener('keydown', bump);
    window.addEventListener('pointerdown', bump);
    window.addEventListener('pointermove', bump);
    const timer = window.setInterval(() => {
      const idle = (performance.now() - idleSince.current) / 1000;
      if (idle < IDLE_S) return;
      const remaining = Math.ceil(IDLE_S + RETURN_S - idle);
      if (remaining <= 0) cb.current();
      else setLeft(remaining);
    }, 250);
    return () => {
      window.removeEventListener('keydown', bump);
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('pointermove', bump);
      window.clearInterval(timer);
    };
  }, []);
  return left;
}
