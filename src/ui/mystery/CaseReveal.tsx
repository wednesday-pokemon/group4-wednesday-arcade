// Case-file reveal (docs/MYSTERY_CASES.md, Journey): after the duo card and before Thing's prologue. PRESENTATION
// ONLY — the case was assigned when the session was created; this screen never picks anything.
// ≈ 4.3 s: deal (three folders land, overlapping) → spread (fanned out, titles readable) → shuffle (riffled into one
// stack) → assign (the session's file comes forward, glows and gets the ASSIGNED stamp; Thing points) → ready (case
// number, title, tagline, setting and "Begin Investigation"). Esc / Skip jumps to ready; Esc or Enter on ready
// continues. Reduced motion: the ready state at once with a short fade. Never names a suspect or a culprit.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { audio, type Sfx } from '../../app/audio.ts';
import { focusIsNeutral, markScreenMounted, useHotkeys, useScreenFocus } from '../../app/keyboard.ts';
import { CASES } from '../../mystery/data/cases.ts';
import type { CaseDef } from '../../mystery/types.ts';
import { Button } from '../components/Button.tsx';
import { ThingSigil } from '../components/ThingSigil.tsx';
import '../styles/caseReveal.css';

export type RevealPhase = 'deal' | 'spread' | 'shuffle' | 'assign' | 'ready';

/** Phase start times (ms after mount). */
export const REVEAL_PHASES: readonly { phase: RevealPhase; atMs: number }[] = [
  { phase: 'deal', atMs: 0 },
  { phase: 'spread', atMs: 850 },
  { phase: 'shuffle', atMs: 1700 },
  { phase: 'assign', atMs: 2950 },
  { phase: 'ready', atMs: 4300 },
];
export const REVEAL_TOTAL_MS = REVEAL_PHASES[REVEAL_PHASES.length - 1]!.atMs;

/** Sound cues: paper as the files land and fan out, a riffle while shuffling, the stamp as ASSIGNED lands. */
export const REVEAL_SOUNDS: readonly { sfx: Sfx; atMs: number }[] = [
  { sfx: 'paper', atMs: 40 },
  { sfx: 'paper', atMs: 850 },
  { sfx: 'shuffle', atMs: 1700 },
  { sfx: 'shuffle', atMs: 2250 },
  { sfx: 'stamp', atMs: 3420 }, // the stamp keyframe lands 470 ms into 'assign'
];

export function revealPhaseAt(ms: number): RevealPhase {
  let out: RevealPhase = 'deal';
  for (const p of REVEAL_PHASES) if (ms >= p.atMs) out = p.phase;
  return out;
}

/** The three case files in number order (01, 02, 03). */
export function caseFiles(): CaseDef[] {
  return Object.values(CASES).sort((a, b) => a.number.localeCompare(b.number));
}

export interface FilePose {
  /** Horizontal offset in file widths. */
  x: number;
  /** Vertical offset in rem. */
  y: number;
  rot: number; // deg
  scale: number;
  z: number;
  dim: boolean;
}

/** Where file `slot` (0..2) rests in `phase` (pure; the CSS transitions between poses). */
export function filePose(phase: RevealPhase, slot: number, assignedSlot: number): FilePose {
  const d = slot - 1; // −1, 0, 1
  switch (phase) {
    case 'deal':
      return { x: d * 0.05, y: Math.abs(d) * 0.4, rot: d * 5 + (slot === 1 ? 1.5 : 0), scale: 1, z: slot, dim: false };
    case 'spread':
      return { x: d * 1.08, y: Math.abs(d) * 0.9, rot: d * 4, scale: 1, z: slot, dim: false };
    case 'shuffle':
      return { x: 0, y: 0, rot: d * 1.5, scale: 1, z: slot, dim: false };
    case 'assign':
    case 'ready': {
      if (slot === assignedSlot) return { x: 0, y: -0.4, rot: 0, scale: 1.1, z: 10, dim: false };
      // The two others tuck in behind, one peeking out on each side (left = the lower slot).
      const side = slot === Math.min(...[0, 1, 2].filter((s) => s !== assignedSlot)) ? -1 : 1;
      return { x: side * 0.2, y: 0.7, rot: side * 7, scale: 0.92, z: 1, dim: true };
    }
  }
}

const ROMAN = { '01': 'I', '02': 'II', '03': 'III' } as const;

function prefersStill(): boolean {
  if (typeof document === 'undefined') return false;
  // settings.ts mirrors useSettings().reducedMotion as the `reduced-motion` class on <html> (importing settings.ts here
  // would touch the DOM at module load, which breaks the node unit tests), plus the system preference.
  return document.documentElement.classList.contains('reduced-motion')
    || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

interface CaseRevealProps {
  caseDef: CaseDef;
  tools?: ReactNode;
  onDone: () => void;
  /** Tests/preview only: render a given phase without running the timeline. */
  initialPhase?: RevealPhase;
}

export function CaseReveal({ caseDef, tools, onDone, initialPhase }: CaseRevealProps) {
  const [still] = useState(prefersStill);
  const [phase, setPhase] = useState<RevealPhase>(initialPhase ?? (still ? 'ready' : 'deal'));
  const heading = useRef<HTMLHeadingElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const beginRef = useRef<HTMLButtonElement>(null);
  const timers = useRef<number[]>([]);
  const finished = useRef(false);
  const ready = phase === 'ready';
  useScreenFocus(heading, ready ? beginRef : skipRef);

  const files = caseFiles();
  const assignedSlot = Math.max(0, files.findIndex((f) => f.id === caseDef.id));

  // The timeline (scheduled once; StrictMode's double effect clears the first schedule, so no cue plays twice).
  useEffect(() => {
    if (phase !== 'deal') {
      if (still) timers.current = [window.setTimeout(() => audio.play('paper'), 40)];
      return () => timers.current.forEach((id) => window.clearTimeout(id));
    }
    timers.current = [
      ...REVEAL_PHASES.slice(1).map((p) => window.setTimeout(() => setPhase(p.phase), p.atMs)),
      ...REVEAL_SOUNDS.map((s) => window.setTimeout(() => audio.play(s.sfx), s.atMs)),
    ];
    return () => timers.current.forEach((id) => window.clearTimeout(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On ready, hand focus to "Begin Investigation" unless the visitor is on another control (e.g. the mute toggle).
  useEffect(() => {
    if (ready && (focusIsNeutral() || document.activeElement === skipRef.current)) beginRef.current?.focus({ preventScroll: true });
  }, [ready]);

  const skip = () => {
    if (ready) return;
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    markScreenMounted(); // re-arm the 500 ms Enter guard so a held key never also begins the investigation
    setPhase('ready');
  };
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  };

  useHotkeys((key) => {
    if (key === 'escape') {
      if (ready) finish();
      else skip();
      return true;
    }
    if (key === 'enter') {
      if (ready && focusIsNeutral(beginRef.current)) {
        finish();
        return true;
      }
      if (!ready && focusIsNeutral(skipRef.current)) {
        skip();
        return true;
      }
    }
  });

  const thingPose = phase === 'assign' ? 'point' : 'thumbsUp';
  return (
    <main
      className={`case-reveal${still ? ' case-reveal--still' : ''}`}
      data-testid="screen-case-reveal"
      data-case={caseDef.id}
      data-phase={phase}
      aria-roledescription="case file reveal"
    >
      <h1 className="sr-only" ref={heading} tabIndex={-1}>Your case file</h1>

      <header className="case-reveal__top">
        <span className="case-reveal__kicker">Nevermore Academy · Case Files</span>
        <span className="case-reveal__tools">
          {!ready && (
            <Button ref={skipRef} variant="secondary" size="sm" kbd="Esc" onClick={skip} data-testid="btn-case-skip">Skip</Button>
          )}
          {tools}
        </span>
      </header>

      <div className="case-reveal__stage" aria-hidden={!ready || undefined}>
        <ol className="case-reveal__files" aria-label="Case files">
          {files.map((f, slot) => {
            const pose = filePose(phase, slot, assignedSlot);
            const assigned = slot === assignedSlot;
            return (
              <li
                key={f.id}
                className={`cfile cfile--${f.number}${assigned ? ' cfile--assigned' : ''}${pose.dim ? ' cfile--dim' : ''}`}
                data-slot={slot}
                data-number={f.number}
                data-testid={assigned ? 'case-file-assigned' : `case-file-${f.number}`}
                style={{ '--x': pose.x, '--y': `${pose.y}rem`, '--rot': `${pose.rot}deg`, '--scale': pose.scale, zIndex: pose.z } as CSSProperties}
              >
                <div className="cfile__body">
                  <span className="cfile__tab">Case {f.number}</span>
                  <span className="cfile__sheet" aria-hidden="true" />
                  <div className="cfile__face">
                    <p className="cfile__kicker">Case file · No. {f.number}</p>
                    <p className="cfile__title">{f.title}</p>
                    <p className="cfile__rule" aria-hidden="true" />
                    <span className="cfile__seal" aria-hidden="true">{ROMAN[f.number]}</span>
                  </div>
                  {assigned && <span className="cfile__stamp" aria-hidden="true">Assigned</span>}
                </div>
              </li>
            );
          })}
        </ol>

        {(phase === 'assign' || ready) && (
          <figure className="case-reveal__thing" data-pose={thingPose} data-testid="case-reveal-thing">
            <ThingSigil size={96} pose={thingPose} label="Thing" />
          </figure>
        )}
      </div>

      <section
        className={`case-reveal__brief${ready ? ' is-ready' : ''}`}
        aria-labelledby="case-brief-title"
        aria-hidden={!ready || undefined}
        data-testid="case-brief"
      >
        <p className="case-reveal__assigned caps">Your assigned case</p>
        <h2 id="case-brief-title" className="case-reveal__title display">
          <span className="case-reveal__no">Case {caseDef.number}</span>
          <span className="case-reveal__name">{caseDef.title}</span>
        </h2>
        <p className="case-reveal__tagline">{caseDef.tagline}</p>
        <p className="case-reveal__setting"><span className="caps">Setting</span> {caseDef.setting}</p>
        <div className="case-reveal__actions">
          <Button
            ref={beginRef}
            variant="primary"
            size="lg"
            kbd="Enter"
            onClick={finish}
            data-testid="btn-case-begin"
          >
            Begin Investigation
          </Button>
          <p className="case-reveal__thing-line">Thing taps the file: this one is yours.</p>
        </div>
      </section>
    </main>
  );
}
