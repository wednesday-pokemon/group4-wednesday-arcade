// How to Play — a multi-page gothic overlay teaching beginners the Nevermore: Deadly Secrets rules.
// Six slides: Mission → Duo Selection → Controls → Monsters & Hiding → Analytics & NPCs → Scoring.
// Reads controls from the ONE control reference (controls.tsx). Uses existing Modal patterns (keyboard.ts).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useModalPresence } from '../../app/keyboard.ts';
import { Icon, type IconName } from '../Icon.tsx';
import { Button } from '../components/Button.tsx';
import { controlRows, KeyCap, type ControlRow } from './controls.tsx';
import { SCORE_V4 } from '../../mystery/scoring.ts';
import '../styles/howToPlay.css';

const TOTAL_SLIDES = 6;

export function HowToPlay({ onClose }: { onClose: () => void }) {
  useModalPresence(true);
  const [page, setPage] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus the close button on mount, return focus on unmount.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => trigger?.focus?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard navigation: Esc closes, ← → pages.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setPage(p => Math.min(TOTAL_SLIDES - 1, p + 1)); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setPage(p => Math.max(0, p - 1)); return; }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Scroll the body to top when the page changes.
  useEffect(() => { panelRef.current?.querySelector('.htp__body')?.scrollTo(0, 0); }, [page]);

  const next = useCallback(() => setPage(p => Math.min(TOTAL_SLIDES - 1, p + 1)), []);
  const prev = useCallback(() => setPage(p => Math.max(0, p - 1)), []);

  // Focus trap.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])'));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div className="htp-scrim" onKeyDown={onKeyDown} data-testid="how-to-play-overlay">
      <div ref={panelRef} className="htp" role="dialog" aria-modal="true" aria-labelledby="htp-title">
        <header className="htp__header">
          <h2 id="htp-title" className="htp__htitle">How to Play</h2>
          <button ref={closeRef} type="button" className="htp__close" onClick={onClose} aria-label="Close" data-testid="htp-close">
            <Icon name="close" />
          </button>
        </header>
        <div className="htp__body">
          <div className="htp__slide" key={page}>
            {page === 0 && <SlideMission />}
            {page === 1 && <SlideDuo />}
            {page === 2 && <SlideControls />}
            {page === 3 && <SlideMonsters />}
            {page === 4 && <SlideAnalytics />}
            {page === 5 && <SlideScoring />}
          </div>
        </div>
        <footer className="htp__footer">
          <div className="htp__dots" role="tablist" aria-label="Guide pages">
            {Array.from({ length: TOTAL_SLIDES }, (_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                className={`htp__dot${i === page ? ' is-active' : ''}`}
                aria-selected={i === page}
                aria-label={`Page ${i + 1}`}
                onClick={() => setPage(i)}
              />
            ))}
          </div>
          <div className="htp__nav">
            {page > 0 && <Button variant="ghost" size="sm" onClick={prev} data-testid="htp-prev">← Back</Button>}
            {page < TOTAL_SLIDES - 1
              ? <Button variant="primary" size="sm" onClick={next} data-testid="htp-next">Next →</Button>
              : <Button variant="primary" size="sm" onClick={onClose} data-testid="htp-done">Got it!</Button>
            }
          </div>
        </footer>
      </div>
    </div>
  );
}

// ─── Slide 1: Mission ───────────────────────────────────────────────
function SlideMission() {
  const steps: { icon: IconName; label: string }[] = [
    { icon: 'search', label: 'Investigate the murder' },
    { icon: 'key', label: 'Collect 3 important clues' },
    { icon: 'egg', label: 'Find and secure the Pokémon egg' },
    { icon: 'skull', label: 'Identify the correct murderer' },
    { icon: 'flag', label: 'Escape Nevermore Academy alive' },
  ];
  return (
    <>
      <h3 className="htp__section-title"><Icon name="flag" /> Your Mission</h3>
      <p className="htp__text">Professor Orloff is dead. His rare Pokémon egg is missing. Solve the mystery before the monsters find you.</p>
      <div className="htp__mission">
        {steps.map((s, i) => (
          <div key={s.label} className="htp__mission-step">
            <span className="htp__mission-num">{i + 1}</span>
            <span className="htp__mission-label"><Icon name={s.icon} /> {s.label}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Slide 2: Duo Selection ─────────────────────────────────────────
function SlideDuo() {
  return (
    <>
      <h3 className="htp__section-title"><Icon name="handHeart" /> Choose Your Duo</h3>
      <p className="htp__text">
        Choose one of <strong>three mystery duo cards</strong>. Each gives you a Nightshade character
        and a Pokémon partner with special abilities.
      </p>
      <div className="htp__duo-explain">
        <div className="htp__duo-point"><KeyCap k="Q" /> <span><strong>Character power</strong> — your character's special ability</span></div>
        <div className="htp__duo-point"><KeyCap k="R" /> <span><strong>Pokémon move</strong> — your partner's ability</span></div>
        <div className="htp__duo-point"><Icon name="sparkle" /> <span>Each duo has <strong>unique strengths</strong></span></div>
        <div className="htp__duo-point"><Icon name="timer" /> <span>Powers have <strong>cooldowns</strong> — use them wisely</span></div>
      </div>
      <p className="htp__text">Pick the duo that matches your play style. Investigation duos find clues faster. Stealth duos avoid monsters. Mobility duos escape danger.</p>
    </>
  );
}

// ─── Slide 3: Controls ──────────────────────────────────────────────
function SlideControls() {
  // Use the ONE control reference to ensure we show real bindings.
  const rows: ControlRow[] = controlRows('full', { power: 'Character Power', move: 'Pokémon Move' });

  return (
    <>
      <h3 className="htp__section-title"><Icon name="settings" /> Keyboard Controls</h3>
      <div className="htp__controls">
        {rows.map(r => (
          <div key={r.id} className="htp__control-row">
            <span className="htp__control-keys">
              {r.keys.map(k => <KeyCap key={k} k={k} />)}
            </span>
            <span className="htp__control-label">
              {r.label}
              {r.loud && <span style={{ color: 'var(--c-danger)', marginLeft: '0.3rem', fontSize: '0.7em', fontWeight: 700 }}>LOUD</span>}
            </span>
          </div>
        ))}
      </div>
      <p className="htp__text" style={{ fontSize: 'var(--fs-sm)' }}>
        Tip: Click on the game window to lock the mouse for camera control. Press <KeyCap k="Esc" /> to pause.
      </p>
    </>
  );
}

// ─── Slide 4: Monsters & Hiding ─────────────────────────────────────
function SlideMonsters() {
  return (
    <>
      <h3 className="htp__section-title"><Icon name="skull" /> Stay Quiet. Stay Alive.</h3>
      <div className="htp__enemies">
        <div className="htp__enemy htp__enemy--hyde">
          <Icon name="ghost" className="htp__enemy-icon" />
          <div>
            <div className="htp__enemy-name">Hyde</div>
            <div className="htp__enemy-desc">Hunts by <strong>sound</strong>. Sprint and loud movements attract him. Move slowly and crouch.</div>
          </div>
        </div>
        <div className="htp__enemy htp__enemy--crack">
          <Icon name="scanEye" className="htp__enemy-icon" />
          <div>
            <div className="htp__enemy-name">Crackstone</div>
            <div className="htp__enemy-desc">Detects by <strong>sight</strong> and supernatural scans. Stay out of his line of vision.</div>
          </div>
        </div>
        <div className="htp__enemy htp__enemy--slurp">
          <Icon name="ear" className="htp__enemy-icon" />
          <div>
            <div className="htp__enemy-name">Slurp</div>
            <div className="htp__enemy-desc">Patrols the academy and <strong>hunts nearby players</strong>. Keep your distance.</div>
          </div>
        </div>
      </div>
      <h4 className="htp__section-subtitle">Survival Tips</h4>
      <div className="htp__tips">
        <div className="htp__tip">Sprint only when necessary — it makes noise.</div>
        <div className="htp__tip">Press <strong>E</strong> to hide inside cabinets.</div>
        <div className="htp__tip">Close cabinet doors and wait for danger to pass.</div>
        <div className="htp__tip">Use character (<strong>Q</strong>) and Pokémon (<strong>R</strong>) abilities to escape.</div>
        <div className="htp__tip">Watch the noise meter — stay silent to stay alive.</div>
      </div>
    </>
  );
}

// ─── Slide 5: Analytics + NPCs (Weems & Thing) ─────────────────────
function SlideAnalytics() {
  const analytics: { id: string; title: string; subtitle: string; desc: string; icon: IconName }[] = [
    { id: 'desc', title: 'Status', subtitle: 'Descriptive', desc: 'See health, noise, clues, and progress.', icon: 'barChart' },
    { id: 'diag', title: 'Explanation', subtitle: 'Diagnostic', desc: 'Understand why something happened.', icon: 'link' },
    { id: 'pred', title: 'Danger Forecast', subtitle: 'Predictive', desc: 'See where danger might appear.', icon: 'gauge' },
    { id: 'presc', title: "Thing's Advice", subtitle: 'Prescriptive', desc: 'Get suggestions for your next move.', icon: 'signpost' },
  ];
  return (
    <>
      <h3 className="htp__section-title"><Icon name="barChart" /> Your Survival Tools</h3>
      <p className="htp__text">Four analytics layers help you make smarter decisions during gameplay:</p>
      <div className="htp__analytics">
        {analytics.map(a => (
          <div key={a.id} className={`htp__analytic htp__analytic--${a.id}`}>
            <Icon name={a.icon} />
            <div>
              <div className="htp__analytic-title">{a.title}</div>
              <div className="htp__analytic-subtitle">{a.subtitle}</div>
              <div className="htp__analytic-desc">{a.desc}</div>
            </div>
          </div>
        ))}
      </div>
      <h4 className="htp__section-subtitle">Your Allies</h4>
      <div className="htp__npcs">
        <div className="htp__npc htp__npc--weems">
          <div className="htp__npc-name">Principal Weems</div>
          <div className="htp__npc-role">Optional mystery hints</div>
          <div className="htp__npc-detail">Stuck on a clue? Press <strong>V</strong> to ask Weems for help</div>
          <div className="htp__npc-detail">Using hints reduces your score (−{SCORE_V4.perHint} each)</div>
        </div>
        <div className="htp__npc htp__npc--thing">
          <div className="htp__npc-name">Thing</div>
          <div className="htp__npc-role">Free survival advice</div>
          <div className="htp__npc-detail">Recommends helpful actions based on the situation</div>
          <div className="htp__npc-detail">Does not reduce your score</div>
        </div>
      </div>
    </>
  );
}

// ─── Slide 6: Scoring ───────────────────────────────────────────────
function SlideScoring() {
  const S = SCORE_V4;
  return (
    <>
      <h3 className="htp__section-title"><Icon name="trophy" /> How to Earn a High Score</h3>
      <div className="htp__score-list">
        <div className="htp__score-item"><Icon name="egg" /> Deliver the Pokémon egg to Iago Tower</div>
        <div className="htp__score-item"><Icon name="search" /> Collect evidence — find all 3 clues</div>
        <div className="htp__score-item"><Icon name="skull" /> Identify the correct murderer</div>
        <div className="htp__score-item"><Icon name="timer" /> Finish faster for time bonus</div>
        <div className="htp__score-item"><Icon name="eyeClosed" /> Avoid being detected by monsters</div>
        <div className="htp__score-item"><Icon name="sparkle" /> Use fewer optional hints</div>
      </div>
      <details className="htp__score-detail">
        <summary>Scoring Details</summary>
        <dl className="htp__score-detail-grid">
          <dt>Egg delivered</dt><dd>+{S.delivery}</dd>
          <dt>Correct accusation</dt><dd>+{S.accusation}</dd>
          <dt>Per clue (max {S.maxClues})</dt><dd>+{S.perClue}</dd>
          <dt>No detections bonus</dt><dd>+{S.noDetection}</dd>
          <dt>No hints bonus</dt><dd>+{S.noHints}</dd>
          <dt>Time bonus (under {S.timeBonusS}s)</dt><dd>+{S.timeBonusS}−time</dd>
          <dt className="htp__penalty">Per hint used</dt><dd className="htp__penalty">−{S.perHint}</dd>
          <dt className="htp__penalty">Per hit taken</dt><dd className="htp__penalty">−{S.perHit}</dd>
        </dl>
      </details>
      <p className="htp__text" style={{ marginTop: 'var(--sp-4)' }}>
        <strong>Ready?</strong> Deliver the egg, name the culprit, stay unseen. Good luck, detective.
      </p>
    </>
  );
}
