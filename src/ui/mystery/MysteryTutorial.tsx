// Onboarding (UX_OVERHAUL §9, ruling R1): at the pier, Hyde dormant, clock stopped, ≤ 3 steps, done by 20 s, "Skip
// (Enter)" always visible. Each step completes from REAL signals or times out.
//   0–2 s   DuoIntro
//   step 1  "Find 3 clues. Save the egg."  — the banner shrinks into the ObjectivePanel after 2 s; WASD Move · Mouse Look;
//           done when moved 3 m or 6 s
//   step 2  "Stay quiet. The Hyde hunts by sound." + the exact owner line as its detail (`tutorial-text` starts with it);
//           C Crouch · Shift Sprint (LOUD); the noise meter is outlined; done when crouched 1 s or 6 s
//   step 3  "Search with E. Powers: Q and R." — E · Q {power} · R {move} · Tab Evidence; done when the crate is searched
//           or 6 s. Then the loop logs "Go. Tab shows your evidence." and the pill starts the Hyde countdown.
// Every key cap comes from the one control reference (controls.tsx).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from '../../app/keyboard.ts';
import { STAY_SILENT_LINE } from '../../app/mystery/thingLines.ts';
import { Button } from '../components/Button.tsx';
import { ThingSigil, type ThingPose } from '../components/ThingSigil.tsx';
import { Icon } from '../Icon.tsx';
import { abilityKey, KeyLegend, type ControlId } from './controls.tsx';
import { ROLE_ICON, ROLE_LABEL, type DuoCardView } from './duoView.ts';

export interface TutorialSignals {
  movedM: number;
  crouchS: number;
  practiceProgress: number;
  power: number;
  move: number;
}

export type TutorialStepId = 'intro' | 'walk' | 'silent' | 'search';

interface Step {
  id: TutorialStepId;
  headline: string;
  /** One-line detail (`tutorial-text`). */
  text: string;
  pose: ThingPose;
  highlight: ControlId[];
  /** Seconds before auto-advance (timeout). */
  timeoutS: number;
  /** Minimum seconds on screen even when done early (readability). */
  minS?: number;
  done?: (now: TutorialSignals, base: TutorialSignals) => boolean;
}

export const TUTORIAL_HEADLINES = {
  walk: (clues: number) => `Find ${clues} clues. Save the egg.`,
  silent: 'Stay quiet. The Hyde hunts by sound.',
  search: `Search with E. Powers: ${abilityKey('F')} and ${abilityKey('Q')}.`,
} as const;

export function buildSteps(vars: { character: string; pokemon: string; power: string; move: string; clues?: number }): Step[] {
  const clues = vars.clues ?? 3;
  return [
    { id: 'intro', headline: `${vars.character} and ${vars.pokemon}`, text: `${vars.character} and ${vars.pokemon}. Follow me — quietly.`, pose: 'wave', highlight: [], timeoutS: 2 },
    {
      id: 'walk', headline: TUTORIAL_HEADLINES.walk(clues), text: 'Walk with W A S D. Look with the mouse or the arrow keys.', pose: 'point',
      highlight: ['move', 'look'], timeoutS: 6, done: (n, b) => n.movedM - b.movedM >= 3,
    },
    {
      id: 'silent', headline: TUTORIAL_HEADLINES.silent, text: STAY_SILENT_LINE, pose: 'shush',
      highlight: ['crouch', 'sprint'], timeoutS: 6, minS: 2.5, done: (n, b) => n.crouchS - b.crouchS >= 1,
    },
    {
      id: 'search', headline: TUTORIAL_HEADLINES.search,
      text: `Hold E on the crate. ${abilityKey('F')}: ${vars.power} · ${abilityKey('Q')}: ${vars.move}.`, pose: 'point',
      highlight: ['interact', 'power', 'ability_move', 'board'], timeoutS: 6, done: (n) => n.practiceProgress >= 0.95,
    },
  ];
}

interface MysteryTutorialProps {
  signals: TutorialSignals;
  vars: { character: string; pokemon: string; power: string; move: string; clues?: number };
  card: DuoCardView;
  paused: boolean;
  /** Kiosk keyboard lock active (Ctrl cap next to C). */
  ctrlCrouch?: boolean;
  onStep?: (id: TutorialStepId) => void;
  onDone: () => void;
}

export function MysteryTutorial({ signals, vars, card, paused, ctrlCrouch = false, onStep, onDone }: MysteryTutorialProps) {
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

  const real = steps.length - 1;
  const shrinking = step.id === 'walk' && elapsed >= 2;
  return (
    <aside className="mtut" aria-label="Tutorial" data-testid="mystery-tutorial" data-step={step.id}>
      {step.id === 'intro' ? (
        <div className="duo-intro" data-testid="duo-intro">
          <img src={card.characterArt} alt="" width={64} height={64} />
          <img src={card.pokemonArt} alt="" width={64} height={64} />
          <span>
            <span className="duo-intro__name display">{card.duoName}</span>
            <span className="role-chip"><Icon name={ROLE_ICON[card.role]} /> {ROLE_LABEL[card.role]}</span>
          </span>
        </div>
      ) : (
        <div className={`mtut__banner${shrinking ? ' is-shrinking' : ''}`} key={step.id}>
          <p className="mtut__headline" data-testid="tutorial-headline">{step.headline}</p>
          {step.id === 'silent' && (
            <p className="mtut__detail" role="status" aria-live="polite" data-testid="tutorial-text">
              {step.text}{done && <span className="mtut__check" aria-label="done"> ✓</span>}
            </p>
          )}
        </div>
      )}
      <div className="mtut__card">
        <p className="mtut__who">
          <ThingSigil size={24} pose={step.pose} animated />
          <span>Thing</span>
          {step.id !== 'intro' && <span className="mtut__count">{index} of {real}</span>}
        </p>
        {step.id !== 'silent' && (
          <p className="mtut__line" role="status" aria-live="polite" data-testid="tutorial-text">
            {step.text}{done && <span className="mtut__check" aria-label="done"> ✓</span>}
          </p>
        )}
        <KeyLegend variant="card" power={vars.power} move={vars.move} ctrlCrouch={ctrlCrouch} highlight={step.highlight} data-testid="tutorial-keys" />
        <Button variant="ghost" kbd="Enter" onClick={finish} className="mtut__skip" data-testid="btn-skip-tutorial">Skip</Button>
      </div>
    </aside>
  );
}
