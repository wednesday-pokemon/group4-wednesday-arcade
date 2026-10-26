// "How it happened": a short 3D cutscene between the case-file reveal and Thing's prologue (plays once).
// The killer is ONE faceless hooded silhouette whoever the culprit is, so these captions never name or gender anyone but the victim.
// Reduced motion / no WebGL: no animation. The captions run over one still frame (or a dark gradient) and advance with the button.
// three.js is loaded with a dynamic import() so it stays out of the menu bundle. Skip, Enter, Esc and Space all call onDone once.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useHotkeys, useScreenFocus } from '../../app/keyboard.ts';
import { getSettings } from '../../app/settings.ts';
import { isWebGLAvailable } from '../../app/mystery/useMysteryLoop.ts';
import { Button } from '../components/Button.tsx';
import type { CaseDef } from '../../mystery/types.ts';
import type { MurderCaseScene } from '../../three/mystery/murderCutscene.ts';
import '../styles/murderCutscene.css';

export const MURDER_CAPTIONS: Record<MurderCaseScene, readonly [string, string, string, string]> = {
  archive: [
    'Midnight. Professor Orloff works late in the archive.',
    'A hooded figure slips in while his back is turned.',
    'One sip of tea. The professor never wakes.',
    'And the rare egg he guarded is gone.',
  ],
  crypt: [
    'Night at the old crypt. Professor Orloff peers down the steps.',
    'A hooded figure waits above the gate, out of sight.',
    'The pin comes free. The heavy gate crashes down.',
    'The hooded figure walks down toward the glowing egg.',
  ],
  signal: [
    'Midnight. One by one, the alarm lights go dark.',
    'A signal lamp blinks in the dark. The professor turns.',
    'A hooded figure steps out of the shadows. The lantern falls.',
    'The rare egg is carried past the silent tower.',
  ],
};

interface MurderCutsceneProps {
  caseDef: CaseDef;
  tools?: ReactNode;
  onDone: () => void;
}

export function MurderCutscene({ caseDef, tools, onDone }: MurderCutsceneProps) {
  const sceneId = caseDef.prologue.scene;
  const captions = MURDER_CAPTIONS[sceneId];
  const heading = useRef<HTMLHeadingElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const finished = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const cutRef = useRef<{ skip(): void } | null>(null);
  const [reduced] = useState(() => getSettings().reducedMotion);
  const [webgl, setWebgl] = useState(() => isWebGLAvailable());
  const [idx, setIdx] = useState(0);
  const animated = !reduced && webgl;
  useScreenFocus(heading, skipRef);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    cutRef.current?.skip();
    doneRef.current();
  };

  useEffect(() => {
    const el = stage.current;
    if (!webgl || !el) return;
    let cancelled = false;
    let inst: { dispose(): void; play(): void; skip(): void } | null = null;
    import('../../three/mystery/murderCutscene.ts')
      .then(({ MurderCutscene: Cut }) => {
        if (cancelled) return;
        const s = getSettings();
        try {
          inst = new Cut(el, sceneId, {
            reducedMotion: s.reducedMotion,
            lowGraphics: s.lowGraphics,
            onCaption: (i) => { if (!cancelled) setIdx(i); },
            onDone: () => {
              if (finished.current) return;
              finished.current = true;
              doneRef.current();
            },
          });
          cutRef.current = inst;
          inst.play();
        } catch {
          inst?.dispose();
          inst = null;
          cutRef.current = null;
          if (!cancelled) setWebgl(false);
        }
      })
      .catch(() => { if (!cancelled) setWebgl(false); });
    return () => {
      cancelled = true;
      cutRef.current = null;
      inst?.dispose();
    };
  }, [sceneId, webgl]);

  useHotkeys((key) => {
    if (key === 'escape' || key === 'enter' || key === ' ') {
      finish();
      return true;
    }
  });

  const last = idx >= captions.length - 1;
  return (
    <main
      className={`murder${animated ? '' : ' murder--still'}${webgl ? '' : ' murder--nogl'}`}
      data-testid="screen-murder"
      data-case={caseDef.id}
      data-scene={sceneId}
      data-index={idx}
      aria-roledescription="story cutscene"
    >
      <h1 className="sr-only" ref={heading} tabIndex={-1}>How it happened</h1>
      <div className="murder__stage" ref={stage} />
      <div className="murder__bar murder__bar--top">
        <span className="murder__kicker">Case {caseDef.number} · {caseDef.title}</span>
        <span className="murder__tools">
          {tools}
          {!animated && !last && (
            <Button variant="primary" size="sm" onClick={() => setIdx((i) => Math.min(i + 1, captions.length - 1))} data-testid="btn-murder-next">Next</Button>
          )}
          <Button ref={skipRef} variant={animated || last ? 'secondary' : 'ghost'} size="sm" kbd="Esc" onClick={finish} data-testid="btn-murder-skip">Skip</Button>
        </span>
      </div>
      <div className="murder__bar murder__bar--bottom">
        <p className="murder__caption display" key={idx} data-testid="murder-caption" role="status" aria-live="polite">{captions[idx]}</p>
        <ol className="murder__dots" aria-hidden="true">
          {captions.map((_, i) => <li key={i} className={i === idx ? 'is-on' : i < idx ? 'is-past' : ''} />)}
        </ol>
      </div>
    </main>
  );
}
