// Dev-only preview for the murder cutscene. Open /tools/murder-cutscene.html
// Query: ?scene=archive|crypt|signal  &t=<seconds> freezes that moment (screenshots)  &low=1 (low graphics)
// Without t the cutscene plays once and holds the last frame. window.__murder = { triangles, calls, t, ready }.
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import '../src/ui/styles/tokens.css';
import '../src/ui/styles/murderCutscene.css';
import { MURDER_CAPTIONS } from '../src/ui/mystery/MurderCutscene.tsx';
import { MurderCutscene, MURDER_CUTSCENE_S, type MurderCaseScene } from '../src/three/mystery/murderCutscene.ts';

const q = new URLSearchParams(location.search);
const scene = (['archive', 'crypt', 'signal'].includes(q.get('scene') ?? '') ? q.get('scene') : 'archive') as MurderCaseScene;
const tParam = q.get('t');

function App() {
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const c = new MurderCutscene(el, scene, { reducedMotion: false, lowGraphics: q.get('low') === '1', onCaption: setIdx, onDone: () => { const m = (window as unknown as { __murder?: Record<string, unknown> }).__murder; if (m) m.doneAt = performance.now(); } });
    const w = window as unknown as { __murder?: unknown };
    if (tParam !== null) {
      const t = Number(tParam);
      c.seek(t);
      w.__murder = { ...c.stats(), t, ready: true };
    } else {
      c.play();
      w.__murder = { ready: true, duration: MURDER_CUTSCENE_S, startedAt: performance.now() };
    }
    return () => c.dispose();
  }, []);
  return (
    <main className="murder" data-testid="screen-murder">
      <div className="murder__stage" ref={ref} />
      <div className="murder__bar murder__bar--top" style={{ animation: 'none' }}><span className="murder__kicker">{scene} {tParam !== null ? `t=${tParam}` : ''}</span></div>
      <div className="murder__bar murder__bar--bottom" style={{ animation: 'none' }}>
        <p className="murder__caption display" style={{ animation: 'none' }}>{MURDER_CAPTIONS[scene][idx]}</p>
      </div>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
