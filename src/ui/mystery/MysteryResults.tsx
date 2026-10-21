// Results (UX_MYSTERY §6, no scroll): left column VerdictHeader · ScoreBreakdown · DuoBadge · board note · CTA;
// right column the four game-wide analytics LayerPanels from src/mystery/analytics (never placeholder numbers). Mystery accuracy is a separate verdict, never part of the score. A wrong / unsolved verdict
// never reveals the culprit. IdleReturn: after 45 s idle, a 20 s countdown back to Home (any key stays).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ResultsAnalytics } from '../../mystery/analytics/index.ts';
import type { CaseDef, RunResult } from '../../mystery/types.ts';
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
  caseDef: CaseDef;
  tools: ReactNode;
  onPlayAgain: () => void;
}

const TIER_TEXT = { common: 'Common', rare: 'Rare', legendary: 'Legendary' } as const;
const IDLE_S = 45;
const RETURN_S = 20;

export interface VerdictView { title: string; tone: 'solved' | 'unsolved' | 'dnf'; sub: string; extra: string | null }

/** Verdict copy (pure; unit-tested). Never names the culprit unless the case was solved. */
export function verdictView(r: RunResult, caseDef: CaseDef): VerdictView {
  const n = r.cluesFound.length;
  const name = (id: string | null) => (id ? caseDef.suspects.find((s) => s.id === id)?.name ?? id : null);
  if (r.outcome === 'dnf') {
    return {
      title: 'Dragged into the fog', tone: 'dnf',
      sub: r.dnfReason === 'hp_depleted' ? 'HP ran out.' : 'Caught twice.',
      extra: 'Unranked — every finisher ranks above a DNF.',
    };
  }
  if (r.verdict === 'case_solved') {
    return { title: 'Case Solved', tone: 'solved', sub: `${name(caseDef.culprit)} released the Hyde. All three clues held.`, extra: null };
  }
  if (r.verdict === 'not_accused' || r.accused === null) {
    return { title: 'Egg Secured, Mystery Unsolved', tone: 'unsolved', sub: `You left the case unsolved — ${n} of 3 clues found.`, extra: null };
  }
  // Wrong suspect OR right suspect without all three clues: the same neutral sentence, so nothing leaks.
  return { title: 'Egg Secured, Mystery Unsolved', tone: 'unsolved', sub: `You accused ${name(r.accused)}. The case didn’t hold — ${n} of 3 clues found.`, extra: null };
}

/** One decimal with a true minus sign (U+2212) for negatives. */
export function fmtScore(v: number): string {
  const s = (Math.round(Math.abs(v) * 10) / 10).toFixed(1);
  return v < 0 ? `−${s}` : s;
}

export function MysteryResults({ result: r, analytics, nickname, card, caseDef, tools, onPlayAgain }: MysteryResultsProps) {
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
  const v = verdictView(r, caseDef);
  const finished = r.outcome === 'finished' && r.score !== null;
  const thing = r.outcome === 'dnf' ? thingScript.dnf(r.dnfReason ?? 'second_catch') : thingScript.result(r.verdict);

  return (
    <main className="screen mys-results scrim-full" data-testid="screen-results" data-verdict={r.outcome === 'dnf' ? 'dnf' : r.verdict}>
      <header className="topline">
        <span className="caps">{nickname || 'Guest'} · The Silent Evidence</span>
        {tools}
      </header>

      <div className="mys-results__grid">
        <section className="mys-results__left">
          <div className={`mys-verdict mys-verdict--${v.tone}${v.title.length > 16 ? ' mys-verdict--long' : ''}`}>
            <p className="caps">Verdict</p>
            <h1 id="verdict-title" ref={h1} tabIndex={-1} className="mys-verdict__title display" data-testid="verdict-title">
              <Icon name={v.tone === 'dnf' ? 'claw' : v.tone === 'solved' ? 'shieldCheck' : 'egg'} />
              {v.title}
            </h1>
            <p className="mys-verdict__sub" data-testid="verdict-sub">{v.sub}</p>
            {v.extra && <p className="text-2">{v.extra}</p>}
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
        <ThingNarrator text={thing.text} pose={thing.pose} inline />
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
