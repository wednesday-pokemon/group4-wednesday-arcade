// Results (UX_MYSTERY §6 + UX_FINAL §6): left column VerdictHeader · v4 score box (2×4 breakdown + total + rank chip;
// DNF → "Defeated by {Name}" + DEFEAT LOG box) · DuoBadge · CTA; right column the four game-wide analytics LayerPanels
// from src/mystery/analytics (never placeholder numbers); below, "What really happened" (the case resolution + why each
// innocent is excluded). mystery-v4: the right culprit is part of the score (+300).
// The answer key (CaseSolution) arrives as a PROP: the app loads it only after the accusation was committed — this
// module never imports data/solutions.ts. IdleReturn: after 45 s idle, a 20 s countdown back to Home (any key stays).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ResultsAnalytics } from '../../mystery/analytics/index.ts';
import { solutionMatches } from '../../mystery/caseLogic.ts';
import { ENEMY_NAMES, type CaseDef, type CaseSolution, type RunResult, type SuspectId } from '../../mystery/types.ts';
import { focusIsNeutral, useHotkeys, useScreenFocus } from '../../app/keyboard.ts';
import { thing as thingScript } from '../../app/mystery/thingLines.ts';
import { Button } from '../components/Button.tsx';
import { Icon } from '../Icon.tsx';
import { ROLE_ICON, ROLE_LABEL, type DuoCardView } from './duoView.ts';
import { LayerPanels } from './LayerPanels.tsx';
import { ThingNarrator } from './ThingNarrator.tsx';
import { ENEMY_FLAVOUR, EnemyMedallion } from './leaderboard/EnemyGlyph.tsx';
import { dnfBoxView, scoreBoxView, type RankChipView, type ScoreRowView } from './leaderboard/scoreView.ts';
import '../styles/leaderboard.css';

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
  /** Finishers: LIVE "#3 tonight" / LOCAL "#2 on this laptop" / "Verifying…" / "Not ranked" (null → "Not ranked"). */
  rankChip?: RankChipView | null;
  onPlayAgain: () => void;
}

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
  if (r.outcome === 'dnf' && r.defeatedBy) {
    // mystery-v4 (UX_FINAL §6): the monster that ended the run is the title; the flavour line is the sub.
    return { title: `Defeated by ${ENEMY_NAMES[r.defeatedBy]}`, tone: 'dnf', sub: ENEMY_FLAVOUR[r.defeatedBy], extra: null };
  }
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

export function MysteryResults({ result: r, analytics, nickname, card, caseDef, solution, tools, rankChip = null, onPlayAgain }: MysteryResultsProps) {
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
  const box = scoreBoxView(r);
  const dnf = r.outcome === 'dnf' ? dnfBoxView(r, analytics, caseDef.clues.length) : null;
  const enemy = r.outcome === 'dnf' ? r.defeatedBy ?? null : null;
  const thing = r.outcome === 'dnf' ? thingScript.dnf(r.dnfReason ?? 'second_catch') : thingScript.result(r.verdict);

  return (
    <main className="screen mys-results scrim-full" data-testid="screen-results" data-verdict={r.outcome === 'dnf' ? 'dnf' : r.verdict} data-case={caseDef.id}>
      <header className="topline">
        <span className="caps">{nickname || 'Guest'} · Nevermore: Deadly Secrets</span>
        {tools}
      </header>

      <div className="mys-results__grid">
        <section className="mys-results__left">
          <div className={`mys-verdict mys-verdict--${v.tone}${enemy ? ' mys-verdict--enemy' : ''}${v.title.length > 16 ? ' mys-verdict--long' : ''}`} data-enemy={enemy ?? undefined}>
            <p className="caps">{enemy ? 'Run over' : 'Verdict'} · Case {caseDef.number} · {caseDef.title}</p>
            <h1 id="verdict-title" ref={h1} tabIndex={-1} className="mys-verdict__title display" data-testid="verdict-title">
              {enemy ? <EnemyMedallion enemy={enemy} /> : <Icon name={v.tone === 'dnf' ? 'claw' : v.tone === 'solved' ? 'shieldCheck' : 'egg'} />}
              {enemy ? <span>Defeated by <span className={`mys-verdict__enemy--${enemy}`}>{ENEMY_NAMES[enemy]}</span></span> : v.title}
            </h1>
            <p className="mys-verdict__sub" data-testid="verdict-sub">{v.sub}</p>
            {v.extra && <p className="mys-verdict__extra text-2">{v.extra}</p>}
          </div>

          {box ? <ScoreBox box={box} chip={rankChip ?? { kind: 'none', text: 'Not ranked' }} /> : dnf ? <DefeatBox d={dnf} /> : null}

          <div className="mys-duo">
            <img src={card.characterArt} alt="" width={48} height={48} />
            <img src={card.pokemonArt} alt="" width={48} height={48} />
            <span>
              <span className="mys-duo__name display">{card.duoName}</span>
              <span className="mys-duo__sub text-2"><Icon name={ROLE_ICON[card.role]} /> {ROLE_LABEL[card.role]} · {card.characterShort} &amp; {card.pokemonName}</span>
            </span>
          </div>

          <div className="mys-results__cta">
            <Button ref={again} variant="primary" size="lg" kbd="Enter" onClick={onPlayAgain} data-testid="btn-play-again">New investigation</Button>
          </div>
        </section>

        <LayerPanels report={analytics} result={r} />
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

/** The v4 score box: header SCORE + rank chip + total; 2 columns × 4 rows of signed parts (UX_FINAL §6). */
function ScoreBox({ box, chip }: { box: NonNullable<ReturnType<typeof scoreBoxView>>; chip: RankChipView }) {
  return (
    <section className="mys-score4" data-testid="score-breakdown" aria-label={`Score ${box.totalText}`}>
      <div className="mys-score4__head">
        <span className="mys-score4__label">SCORE</span>
        <span className={`rank-chip rank-chip--${chip.kind}`} data-testid="rank-chip" data-kind={chip.kind}>
          {chip.kind === 'live' || chip.kind === 'local' ? <Icon name="trophy" /> : chip.kind === 'pending' ? <Icon name="wifi" /> : null}
          {chip.text}
        </span>
        <span className="mys-score4__total num" data-testid="score-total">{box.totalText}</span>
      </div>
      {box.rows ? (
        <dl className="mys-score4__grid" data-testid="score-rows">
          <div className="mys-score4__col">{box.rows.left.map((row) => <ScoreRow key={row.key} row={row} />)}</div>
          <div className="mys-score4__col">{box.rows.right.map((row) => <ScoreRow key={row.key} row={row} />)}</div>
        </dl>
      ) : (
        <p className="mys-score4__note">Score breakdown unavailable for this run.</p>
      )}
      {box.clamped && <p className="mys-score4__note" data-testid="score-clamped">Penalties went below zero, so the score stops at 0.</p>}
    </section>
  );
}

function ScoreRow({ row }: { row: ScoreRowView }) {
  return (
    <div className={`mys-score4__row is-${row.tone}`} data-testid={`score-row-${row.key}`}>
      <dt>{row.label}</dt>
      <dd className="num">
        {row.value}
        {row.reason && <span className="mys-score4__why"> ({row.reason})</span>}
      </dd>
    </div>
  );
}

/** DNF variant: DEFEAT LOG · "No score · not ranked" · Lasted / Clues / Egg / tally · WHY · "Saved to tonight's defeat log." */
function DefeatBox({ d }: { d: ReturnType<typeof dnfBoxView> }) {
  return (
    <section className="mys-score4 mys-score4--dnf" data-testid="score-breakdown" data-variant="dnf">
      <div className="mys-score4__head">
        <span className="mys-score4__label">DEFEAT LOG</span>
        <span className="rank-chip rank-chip--dnf" data-testid="rank-chip" data-kind="dnf">No score · not ranked</span>
      </div>
      <ul className="mys-dnf__list" data-testid="dnf-facts">
        <li><Icon name="timer" />{d.lasted}</li>
        <li><Icon name="search" />{d.clues}</li>
        {d.egg && <li><Icon name="egg" />{d.egg}</li>}
        <li><Icon name="eye" />{d.tally}</li>
      </ul>
      {d.why && (
        <p className="mys-why" data-testid="dnf-why"><span className="mys-why__k"><Icon name="link" />WHY</span><span>{d.why}</span></p>
      )}
      <p className="mys-dnf__saved">Saved to tonight’s defeat log.</p>
    </section>
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
