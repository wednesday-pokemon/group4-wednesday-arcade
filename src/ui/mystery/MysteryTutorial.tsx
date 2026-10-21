// ThingTutorial (UX_MYSTERY §3, ≤ 25 s, skippable): DuoIntro, then five short steps at the pier while the run is in
// status 'tutorial' (the Hyde is inactive, the clock is not running). Each step completes from REAL signals or times
// out; Enter (or the button) skips the whole tutorial at any time. Step 2 is the exact headline
// "Stay Silent: Move slowly and avoid making noise — Hydes are sensitive to sound." shown for at least 4 s.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from '../../app/keyboard.ts';
import { STAY_SILENT_LINE, thing } from '../../app/mystery/thingLines.ts';
import { THING } from '../../mystery/data/thing.ts';
import { Button } from '../components/Button.tsx';
import { ThingSigil, type ThingPose } from '../components/ThingSigil.tsx';
import { Icon } from '../Icon.tsx';
import { ROLE_ICON, ROLE_LABEL, type DuoCardView } from './duoView.ts';

export interface TutorialSignals {
  movedM: number;
  crouchS: number;
  practiceProgress: number;
  power: number;
  move: number;
}

export type TutorialStepId = 'intro' | 'walk' | 'silent' | 'search' | 'abilities' | 'go';

interface Step {
  id: TutorialStepId;
  text: string;
  pose: ThingPose;
  keys: string[];
  headline?: boolean;
  /** Seconds before auto-advance (timeout). */
  timeoutS: number;
  /** Minimum seconds on screen even when done early. */
  minS?: number;
  done?: (now: TutorialSignals, base: TutorialSignals) => boolean;
}

const line = (id: string) => THING.tutorial.find((l) => l.id === id)?.text ?? '';

export function buildSteps(vars: { character: string; pokemon: string; power: string; move: string }): Step[] {
  return [
    { id: 'intro', text: thing.duoIntro(vars).text, pose: 'wave', keys: [], timeoutS: 2.5 },
    {
      id: 'walk', text: `${line('tut_move').split('.')[0]}. ${line('tut_look')}`, pose: 'point', keys: ['W', 'A', 'S', 'D', 'Mouse', '←', '→'], timeoutS: 5,
      done: (n, b) => n.movedM - b.movedM >= 3,
    },
    {
      id: 'silent', text: STAY_SILENT_LINE, pose: 'shush', keys: ['C'], headline: true, timeoutS: 6, minS: 4,
      done: (n, b) => n.crouchS - b.crouchS >= 1,
    },
    {
      id: 'search', text: line('tut_interact') || 'E searches. Try the crate — and stand still.', pose: 'point', keys: ['E'], timeoutS: 5,
      done: (n) => n.practiceProgress >= 0.95,
    },
    {
      id: 'abilities', text: `F: ${vars.power} · Q: ${vars.move}. Watch for the LOUD tag.`, pose: 'tap', keys: ['F', 'Q'], timeoutS: 4,
      done: (n, b) => n.power > b.power || n.move > b.move,
    },
    { id: 'go', text: line('tut_go') || 'Sprinting is loud. Tab: evidence. V: ask me. Go.', pose: 'point', keys: ['Shift', 'Tab', 'V'], timeoutS: 2 },
  ];
}

interface MysteryTutorialProps {
  signals: TutorialSignals;
  vars: { character: string; pokemon: string; power: string; move: string };
  card: DuoCardView;
  paused: boolean;
  onStep?: (id: TutorialStepId) => void;
  onDone: () => void;
}

export function MysteryTutorial({ signals, vars, card, paused, onStep, onDone }: MysteryTutorialProps) {
  const steps = useMemo(() => buildSteps(vars), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const base = useRef<TutorialSignals>(signals);
  const sig = useRef(signals);
  sig.current = signals;
  const step = steps[index]!;
  const finished = useRef(false);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  };

  useEffect(() => onStep?.(step.id), [step.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Step clock (real time, frozen while paused).
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setElapsed((e) => e + 0.1), 100);
    return () => window.clearInterval(id);
  }, [paused, index]);

  const done = !!step.done && step.done(signals, base.current);
  useEffect(() => {
    const minOk = elapsed >= (step.minS ?? 0);
    const advance = (done && minOk && elapsed >= 0.6) || elapsed >= step.timeoutS;
    if (!advance) return;
    if (index === steps.length - 1) {
      finish();
      return;
    }
    base.current = sig.current;
    setElapsed(0);
    setIndex((i) => i + 1);
  }, [elapsed, done]); // eslint-disable-line react-hooks/exhaustive-deps

  useHotkeys((key) => {
    if (key === 'enter') {
      finish();
      return true;
    }
  }, !paused);

  return (
    <aside className={`mtut${step.headline ? ' mtut--headline' : ''}`} aria-label="Tutorial" data-testid="mystery-tutorial" data-step={step.id}>
      {step.id === 'intro' ? (
        <div className="duo-intro" data-testid="duo-intro">
          <img src={card.characterArt} alt="" width={64} height={64} />
          <img src={card.pokemonArt} alt="" width={64} height={64} />
          <span>
            <span className="duo-intro__name display">{card.duoName}</span>
            <span className="role-chip"><Icon name={ROLE_ICON[card.role]} /> {ROLE_LABEL[card.role]}</span>
          </span>
        </div>
      ) : null}
      <div className="mtut__line">
        <ThingSigil size={32} pose={step.pose} animated />
        <span className="thing-caption__who">Thing{step.id !== 'intro' && <span className="mtut__count"> · {index} of {steps.length - 1}</span>}</span>
        <p className={`mtut__text${step.headline ? ' mtut__text--headline' : ''}`} role="status" aria-live="polite" data-testid="tutorial-text">
          {step.text}{done && <span className="mtut__check" aria-label="done"> ✓</span>}
        </p>
      </div>
      <div className="mtut__foot">
        {step.keys.length > 0 && <p className="mtut__keys">{step.keys.map((k) => <kbd key={k} className="kcap">{k}</kbd>)}</p>}
        <Button variant="ghost" kbd="Enter" onClick={finish} data-testid="btn-skip-tutorial">Skip tutorial</Button>
      </div>
    </aside>
  );
}
