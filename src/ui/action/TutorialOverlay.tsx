// Learn-by-doing tutorial (UX_V3_ACTION §6), ≤ 30 s on a throwaway practice run at the start dock:
// step 0 chooses tap vs hold-to-row, then six prompts that complete when the player actually does them (or time out).
// Enter skips at any time. Nothing here counts toward the race clock or the real run's ability cooldown.
import { useEffect, useRef, useState } from 'react';
import type { HudV3, PracticeSignals } from '../../app/v3/useStageLoop.ts';
import { audio } from '../../app/audio.ts';
import { announce } from '../../app/announce.tsx';
import { Icon } from '../Icon.tsx';
import { RescuePrompt } from './RescuePrompt.tsx';

interface Step {
  id: string;
  prompt: (ctx: { abilityName: string; holdToRow: boolean }) => React.ReactNode;
  timeoutS: number;
  done: (s: PracticeSignals, base: PracticeSignals, hud: HudV3) => boolean;
}

const STEPS: Step[] = [
  {
    id: 'row',
    prompt: ({ holdToRow }) => holdToRow ? <><kbd>Space</kbd> Hold SPACE to row</> : <><kbd>Space</kbd> Tap SPACE steadily to row</>,
    timeoutS: 8,
    done: (s, b, h) => (h.holdToRow ? s.holdRowS - b.holdRowS >= 2 : s.strokes - b.strokes >= 6 && h.speed >= 5),
  },
  {
    id: 'steer',
    prompt: () => <><kbd>A</kbd><kbd>D</kbd> Steer left and right</>,
    timeoutS: 7,
    done: (s, b) => s.headingDeltaDeg >= 25 || (s.leftS - b.leftS >= 0.35 && s.rightS - b.rightS >= 0.35),
  },
  { id: 'glide', prompt: () => <><kbd>W</kbd> Hold W to glide and rest</>, timeoutS: 4, done: (s, b) => s.glideS - b.glideS >= 1 },
  { id: 'brake', prompt: () => <><kbd>S</kbd> Hold S to brake</>, timeoutS: 4, done: (s, b) => s.brakeSlowS - b.brakeSlowS > 0 },
  {
    id: 'ability',
    prompt: ({ abilityName }) => <><kbd>Q</kbd> Press Q: {abilityName}</>,
    timeoutS: 4,
    done: (s, b) => s.abilityUsed - b.abilityUsed >= 1 || s.qPresses - b.qPresses >= 1,
  },
  {
    id: 'rescue',
    prompt: () => <>Caught? Press <kbd>Q</kbd> to escape</>,
    timeoutS: 3,
    done: (s, b) => s.qPresses - b.qPresses >= 1 || s.spacePresses - b.spacePresses >= 1,
  },
];
export const TUTORIAL_MAX_S = 30;
const CHECK_MS = 400;
/** Hard stop once the steps have started: every step timing out + its ✓ beat, plus a little slack (slow machines). */
const HARD_STOP_MS = STEPS.reduce((acc, s) => acc + s.timeoutS * 1000 + CHECK_MS, 0) + 1500;

interface TutorialOverlayProps {
  hud: HudV3 | null;
  pokemonName: string;
  abilityName: string;
  holdToRow: boolean;
  paused: boolean;
  onHoldToRow: (on: boolean) => void;
  onDone: () => void;
}

export function TutorialOverlay({ hud, pokemonName, abilityName, holdToRow, paused, onHoldToRow, onDone }: TutorialOverlayProps) {
  const [step, setStep] = useState(-1); // -1 = choose tap / hold
  const [ticked, setTicked] = useState(false);
  const base = useRef<PracticeSignals | null>(null);
  const stepStart = useRef(performance.now());
  const startedAt = useRef(performance.now());
  const doneRef = useRef(false);
  const [now, setNow] = useState(performance.now());

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  };

  // Plain listener (not useHotkeys): the rowing input already preventDefaults SPACE, which useHotkeys would ignore.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (e: KeyboardEvent) => {
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || paused) return;
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      finish();
    } else if (step === -1 && e.code === 'Space') begin(); // the stroke still reaches the practice boat
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const begin = () => {
    stepStart.current = performance.now();
    startedAt.current = performance.now();
    base.current = hud?.practice ?? null;
    setStep(0);
    announce(holdToRow ? 'Hold SPACE to row.' : 'Tap SPACE steadily to row.');
  };

  // Clock for timeouts + the staged rescue ring.
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, []);

  // Pausing freezes step timers.
  const pausedAt = useRef<number | null>(null);
  useEffect(() => {
    if (paused) pausedAt.current = performance.now();
    else if (pausedAt.current !== null) {
      const d = performance.now() - pausedAt.current;
      stepStart.current += d;
      startedAt.current += d;
      pausedAt.current = null;
    }
  }, [paused]);

  useEffect(() => {
    if (paused || !hud || ticked || doneRef.current) return;
    if (step < 0) {
      // An unattended choice card still ends: the race starts with the default tap-to-row.
      if (now - startedAt.current > TUTORIAL_MAX_S * 1000) finish();
      return;
    }
    if (now - startedAt.current > HARD_STOP_MS) {
      finish();
      return;
    }
    const s = STEPS[step]!;
    if (!base.current) base.current = hud.practice;
    const elapsed = (now - stepStart.current) / 1000;
    const completed = s.done(hud.practice, base.current, hud);
    if (completed || elapsed >= s.timeoutS) {
      if (completed) audio.play('chime');
      setTicked(true);
    }
  }, [hud, now, step, ticked, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  // The ✓ shows for CHECK_MS, then the next step starts. Its own effect: the check effect above re-runs on every HUD
  // update, and a timer owned by it would be cleared before it fires.
  const hudRef = useRef(hud);
  hudRef.current = hud;
  useEffect(() => {
    if (!ticked) return;
    const t = setTimeout(() => {
      setTicked(false);
      if (step + 1 >= STEPS.length) finish();
      else {
        stepStart.current = performance.now();
        base.current = hudRef.current?.practice ?? null;
        setStep(step + 1);
      }
    }, CHECK_MS);
    return () => clearTimeout(t);
  }, [ticked, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = step >= 0 ? STEPS[step] : null;
  const rescueElapsed = current?.id === 'rescue' ? (now - stepStart.current) / 1000 : 0;

  return (
    <>
      <section className="tut" aria-label="Tutorial" data-testid="tutorial" data-step={current?.id ?? 'choose'}>
        <p className="tut__kicker caps">Practice · the race clock isn’t running</p>
        {step < 0 ? (
          <div className="tut__choose">
            <p className="tut__title display">How do you like to row?</p>
            <div className="tut__options" role="radiogroup" aria-label="Rowing style">
              <button
                type="button" role="radio" aria-checked={!holdToRow} className={`tut__option${!holdToRow ? ' is-on' : ''}`}
                onClick={() => { onHoldToRow(false); begin(); }} data-testid="tut-tap"
              >
                <kbd>Space</kbd> Tap SPACE <small>Default · fastest with rhythm</small>
              </button>
              <button
                type="button" role="radio" aria-checked={holdToRow} className={`tut__option${holdToRow ? ' is-on' : ''}`}
                onClick={() => { onHoldToRow(true); begin(); }} data-testid="tut-hold"
              >
                <kbd>H</kbd> Hold SPACE <small>Easier on hands</small>
              </button>
            </div>
            <p className="tut__hint"><kbd>H</kbd> switches anytime · press <kbd>Space</kbd> to start</p>
          </div>
        ) : (
          <p className={`tut__prompt${ticked ? ' is-done' : ''}`} data-testid="tutorial-prompt">
            {ticked && <Icon name="check" />}
            {current!.prompt({ abilityName, holdToRow })}
          </p>
        )}
        <div className="tut__foot">
          <span className="tut__dots" aria-label={`Step ${Math.max(0, step + 1)} of ${STEPS.length}`}>
            {STEPS.map((s, i) => <span key={s.id} className={i < step || (i === step && ticked) ? 'is-done' : i === step ? 'is-on' : ''} />)}
          </span>
          <button type="button" className="tut__skip" onClick={finish} data-testid="btn-skip-tutorial">Skip tutorial <kbd>Enter</kbd></button>
        </div>
      </section>
      {current?.id === 'rescue' && !ticked && (
        <RescuePrompt
          rescue={{ abilityAvailable: true, windowS: 3, remainingS: Math.max(0, 3 - rescueElapsed), cleanWindowS: 0, kicks: 0, lastChance: false, qPressed: false }}
          pokemonName={pokemonName}
          abilityName={abilityName}
          cooldownLeftS={0}
          noCharges={false}
        />
      )}
    </>
  );
}
