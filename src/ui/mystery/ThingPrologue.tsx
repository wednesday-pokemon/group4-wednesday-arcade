// Thing's prologue (story script v3.2): after the duo card is chosen and before the tutorial. Six ~5 s panels
// (scene + title + Thing's translated message revealed word by word + gesture + audio cue) then the mission card.
// Auto-advance stops on any manual navigation; Next / Back / Pause / Skip / Replay; captions always on; reduced
// motion drops the drift, word reveal and gestures. Skip and "Enter Raven Island" both call onDone exactly once.
import { useEffect, useMemo, useReducer, useRef, type CSSProperties, type ReactNode } from 'react';
import { audio } from '../../app/audio.ts';
import { focusIsNeutral, useHotkeys, useScreenFocus } from '../../app/keyboard.ts';
import {
  HEARTBEAT_EVERY_S, initialPrologue, MISSION_INDEX, PROLOGUE_MISSION, prologuePanels, prologueReducer, segmentFill,
} from '../../app/mystery/prologue.ts';
import { Button } from '../components/Button.tsx';
import { ThingSigil, type ThingPose } from '../components/ThingSigil.tsx';
import type { DuoCardView } from './duoView.ts';
import type { CaseDef } from '../../mystery/types.ts';
import { PrologueScene } from './PrologueScenes.tsx';
import { THING_ART } from './thingArt.ts';
import '../styles/prologue.css';

const TICK_MS = 100;

interface ThingPrologueProps {
  card: DuoCardView;
  /** The session's assigned case: panels 2–3 tell its story, panel 4 frames its suspects. */
  caseDef: CaseDef;
  tools?: ReactNode;
  onDone: () => void;
}

export function ThingPrologue({ card, caseDef, tools, onDone }: ThingPrologueProps) {
  const [s, dispatch] = useReducer(prologueReducer, undefined, initialPrologue);
  const heading = useRef<HTMLHeadingElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const beginRef = useRef<HTMLButtonElement>(null);
  const finished = useRef(false);
  const panels = useMemo(() => prologuePanels(caseDef), [caseDef]);
  const panel = panels[s.index] ?? null;
  const mission = s.index === MISSION_INDEX;
  useScreenFocus(heading, nextRef);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  };

  // Gothic pad under the theme for the whole prologue; it fades into the island on the way out.
  useEffect(() => {
    audio.setPrologueMood(true);
    return () => audio.setPrologueMood(false);
  }, []);

  // Panel clock (real time). The reducer ignores ticks while paused or on the mission card.
  useEffect(() => {
    if (!s.autoplay || mission) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      dispatch({ type: 'tick', dt: (now - last) / 1000 });
      last = now;
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [s.autoplay, mission]);

  // Per-panel audio cue (+ repeating heartbeat) and the optional translation voiceover.
  useEffect(() => {
    if (!panel) {
      audio.play('toll');
      return;
    }
    if (panel.cue) audio.play(panel.cue);
    const beat = panel.cue === 'heartbeat' ? window.setInterval(() => audio.play('heartbeat'), HEARTBEAT_EVERY_S * 1000) : null;
    let voice: ReturnType<typeof audio.playVoice> | null = null;
    if (panel.voice) {
      dispatch({ type: 'voice', pending: true });
      voice = audio.playVoice(`${import.meta.env.BASE_URL}${panel.voice}`);
      voice.done.then(() => dispatch({ type: 'voice', pending: false }));
    }
    return () => {
      if (beat) window.clearInterval(beat);
      voice?.stop();
    };
  }, [s.index]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mission) beginRef.current?.focus({ preventScroll: true });
  }, [mission]);

  useHotkeys((key) => {
    if (key === 'escape') {
      finish();
      return true;
    }
    if (mission) {
      if (key === 'r') {
        dispatch({ type: 'replay' });
        return true;
      }
      if (key === 'enter' && focusIsNeutral(beginRef.current)) {
        finish();
        return true;
      }
      return;
    }
    if (key === 'arrowright' || (key === 'enter' && focusIsNeutral(nextRef.current))) {
      dispatch({ type: 'next' });
      return true;
    }
    if (key === 'arrowleft') {
      dispatch({ type: 'back' });
      return true;
    }
    if (key === ' ' && focusIsNeutral()) {
      dispatch({ type: 'toggleAutoplay' });
      return true;
    }
  });

  const pose: ThingPose = panel?.pose ?? 'thumbsUp';
  return (
    <main
      className="prologue"
      data-testid="screen-prologue"
      data-panel={panel?.id ?? 'mission'}
      data-case={caseDef.id}
      data-index={s.index}
      data-autoplay={s.autoplay}
      aria-roledescription="story introduction"
    >
      <h1 className="sr-only" ref={heading} tabIndex={-1}>Thing’s story introduction</h1>

      <div className={`prologue__stage${mission ? ' prologue__stage--dim' : ''}`} key={s.index} style={{ '--panel-s': `${panel?.durationS ?? 6}s` } as CSSProperties}>
        <PrologueScene id={panel?.id ?? 'assignment'} card={card} suspects={caseDef.suspects} variant={caseDef.prologue.scene} />
      </div>

      <header className="prologue__top">
        <span className="prologue__guide">
          <ThingPortrait size="sm" pose="stand" />
          <span>Thing’s story</span>
        </span>
        <ol className="prologue__progress" aria-label={mission ? 'Story complete' : `Panel ${s.index + 1} of ${panels.length}`}>
          {panels.map((p, i) => (
            <li key={p.id} className="prologue__seg" aria-current={i === s.index ? 'step' : undefined}>
              <span style={{ transform: `scaleX(${segmentFill(s, i)})` }} />
            </li>
          ))}
        </ol>
        {tools}
      </header>

      {panel?.warning && (
        <p className="prologue__warning" key={`w${s.index}`} data-testid="prologue-warning">{panel.warning}</p>
      )}

      {panel ? (
        <footer className="prologue__bar">
          <figure className="prologue__portrait" data-pose={pose} key={`p${s.index}`}>
            <ThingPortrait size="lg" pose={pose} label="Thing, your guide" />
          </figure>
          <div className="prologue__dialogue">
            <h2 className="prologue__title display" key={`t${s.index}`} data-testid="prologue-title">{panel.title}</h2>
            <p className="prologue__who">
              <ThingPortrait size="xs" pose={pose} />
              Thing’s message (translated)
            </p>
            <p className="prologue__text" aria-hidden="true" key={`n${s.index}`}>
              {panel.narration.split(' ').map((w, i) => (
                <span key={i} style={{ '--i': i } as CSSProperties}>{w} </span>
              ))}
            </p>
            <p className="sr-only" role="status" aria-live="polite" data-testid="prologue-text">{panel.narration}</p>
          </div>
          <div className="prologue__controls">
            <Button variant="ghost" size="sm" kbd="←" onClick={() => dispatch({ type: 'back' })} inactive={s.index === 0} data-testid="btn-prologue-back">Back</Button>
            <Button variant="ghost" size="sm" kbd="Space" onClick={() => dispatch({ type: 'toggleAutoplay' })} aria-pressed={!s.autoplay} data-testid="btn-prologue-autoplay">
              {s.autoplay ? 'Pause' : 'Play'}
            </Button>
            <Button ref={nextRef} variant="primary" kbd="→" onClick={() => dispatch({ type: 'next' })} data-testid="btn-prologue-next">Next</Button>
            <Button variant="secondary" size="sm" kbd="Esc" onClick={finish} data-testid="btn-prologue-skip">Skip intro</Button>
          </div>
        </footer>
      ) : (
        <section className="prologue__mission" aria-labelledby="prologue-mission-title" data-testid="prologue-mission">
          <ThingPortrait size="lg" pose="thumbsUp" />
          <h2 id="prologue-mission-title" className="prologue__mission-lines display">
            {PROLOGUE_MISSION.map((l, i) => <span key={l} style={{ '--i': i } as CSSProperties}>{l}</span>)}
          </h2>
          <p className="prologue__mission-duo">{card.characterShort} and {card.pokemonName} are with you.</p>
          <div className="button-row">
            <Button ref={beginRef} variant="primary" size="lg" kbd="Enter" onClick={finish} data-testid="btn-begin-investigation">Enter Raven Island</Button>
            <Button variant="ghost" kbd="R" onClick={() => dispatch({ type: 'replay' })} data-testid="btn-prologue-replay">Replay story</Button>
          </div>
        </section>
      )}
    </main>
  );
}

const SIGIL_SIZE = { xs: 24, sm: 32, lg: 96 } as const;

/** Thing in a lantern ring: the supplied image when present (src/assets/thing/), otherwise the line-art sigil. */
function ThingPortrait({ size, pose, label }: { size: keyof typeof SIGIL_SIZE; pose: ThingPose; label?: string }) {
  return (
    <span className={`thing-portrait thing-portrait--${size}`} data-pose={pose} data-art={THING_ART ? 'image' : 'sigil'}>
      {THING_ART
        ? <img src={THING_ART} alt={label ?? ''} draggable={false} data-testid="thing-portrait-img" />
        : <ThingSigil size={SIGIL_SIZE[size]} pose={pose} label={label} />}
    </span>
  );
}
