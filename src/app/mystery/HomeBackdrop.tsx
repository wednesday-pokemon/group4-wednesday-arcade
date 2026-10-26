// Home / nickname / cards backdrop (UX_MYSTERY §1: "3D scene right — island + Iago Tower at night, Thing on the pier").
// Renders the real MysteryScene in its showcase mode (setShowcase: slow orbit over the pier, Thing waving, tower behind)
// from a throwaway run kept in status 'tutorial' (the Hyde is inactive; nothing is scored or logged). Lazy-loaded;
// falls back to the CSS backdrop if WebGL/modules fail. ~20 fps is plenty for a backdrop and keeps the kiosk GPU cool.
import { useEffect, useRef, useState } from 'react';
import type { Duo } from '../../mystery/types.ts';
import { getSettings } from '../settings.ts';
import { loadRunCtor, loadSceneCtor } from './integration.ts';
import { isWebGLAvailable } from './useMysteryLoop.ts';

const FRAME_MS = 50;

export default function HomeBackdrop({ duo, seed }: { duo: Duo; seed: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !isWebGLAvailable()) return;
    let disposed = false;
    let stop: (() => void) | null = null;
    void (async () => {
      try {
        const [Run, Scene] = await Promise.all([loadRunCtor(), loadSceneCtor()]);
        if (disposed) return;
        const run = new Run({ duo, seed: `backdrop:${seed}`, tutorial: true });
        const s = getSettings();
        const scene = new Scene(el, run.map, duo, { reducedMotion: s.reducedMotion, lowGraphics: true });
        scene.setShowcase?.(true);
        scene.render(run, [], 1 / 60);
        setReady(true);
        let raf = 0;
        let last = performance.now();
        let motion = s.reducedMotion;
        const loop = (now: number) => {
          raf = requestAnimationFrame(loop);
          if (now - last < FRAME_MS) return;
          const dt = Math.min(0.1, (now - last) / 1000);
          last = now;
          const rm = getSettings().reducedMotion;
          if (rm !== motion) {
            motion = rm;
            scene.setOptions?.({ reducedMotion: rm });
          }
          scene.render(run, [], dt);
        };
        raf = requestAnimationFrame(loop);
        stop = () => {
          cancelAnimationFrame(raf);
          scene.dispose();
        };
      } catch (err) {
        console.warn('[mystery] home backdrop unavailable', err);
      }
    })();
    return () => {
      disposed = true;
      stop?.();
    };
  }, [duo, seed]);

  return <div id="scene" ref={ref} className={`mys-home-scene${ready ? ' is-ready' : ''}`} aria-hidden="true" />;
}
