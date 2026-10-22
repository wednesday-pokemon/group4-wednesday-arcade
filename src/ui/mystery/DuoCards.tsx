// Duo draft (UX_MYSTERY §2): three original gothic, Pokémon-card-INSPIRED cards side by side. Each card: duo name +
// cosmetic rarity, arch portrait + Pokémon medallion, role chip (icon + word), names, six absolute 1–5 stats with the
// best-of-three ▲, F power and Q real move (Game adaptation badge, LOUD tag), 2 advantages + 1–2 disadvantages, one
// "Select duo". Keyboard: focus starts on the H1; ← → and 1 2 3 move focus among the Select buttons (roving tabindex);
// Enter/Space select; Enter ignored for 600 ms after mount and on key repeat. Clicking a card body only focuses it.
//
// Slot-machine reveal (feature add-on, purely presentational): the 3 bundles are already fixed in `cards` before this
// component ever mounts (drawn upstream, unchanged here). The cards are dealt FACE-DOWN (the supplied card-back art,
// public/art/cards/card-back.webp), flip over left → right, then run a cycling "draw" before showing their real stats
// (~4.5 s in all). A `duo-card-N` / `btn-select-duo-N` pair exists and is clickable from the very
// first frame for every card: clicking (or Enter-selecting) one at any point during the spin instantly reveals all
// three and selects that one, so nothing that already depends on immediate card-screen interactivity breaks.
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { Duo } from '../../mystery/types.ts';
import { announce, announceSelection } from '../../app/announce.tsx';
import { audio } from '../../app/audio.ts';
import { useHotkeys, useScreenFocus } from '../../app/keyboard.ts';
import { getSettings } from '../../app/settings.ts';
import { NIGHTSHADES } from '../../mystery/data/nightshades.ts';
import { PARTNERS } from '../../mystery/data/partners.ts';
import { Button } from '../components/Button.tsx';
import { ThingSigil } from '../components/ThingSigil.tsx';
import { Icon } from '../Icon.tsx';
import { characterArt, pokemonArt, ROLE_ICON, ROLE_LABEL, STAT_MAX, STAT_ROWS, type AbilityView, type DuoCardView } from './duoView.ts';
import '../styles/duoReveal.css';

interface DuoCardsProps {
  cards: DuoCardView[];
  stepLabel: string;
  tools: ReactNode;
  onBack: () => void;
  onSelect: (duo: Duo) => void;
}

const ENTER_GUARD_MS = 600;
const COMMIT_MS = 600;

// ------------------------------------------------------------------------------------------- Slot-machine reveal
type SlotPhase = 'back' | 'flip' | 'spin' | 'settling' | 'settled';
type NightshadeIdKey = keyof typeof NIGHTSHADES;
type PokemonIdKey = keyof typeof PARTNERS;
interface SlotFace { characterId: NightshadeIdKey; pokemonId: PokemonIdKey }

const NIGHTSHADE_IDS = Object.keys(NIGHTSHADES) as NightshadeIdKey[];
const PARTNER_IDS = Object.keys(PARTNERS) as PokemonIdKey[];
/** Face-down until these times (ms from mount), left to right; each flip takes FLIP_MS (the back hides at its midpoint). */
const FLIP_AT_MS = [600, 850, 1100] as const;
const FLIP_MS = 520;
/** Left-to-right stop times (ms from mount); each gets SLOT_SETTLE_MS more to glow/settle before it counts as done. */
const SLOT_STOP_MS = [3000, 3500, 4000] as const;
const SLOT_SETTLE_MS = 500;
const CARD_BACK = `${import.meta.env.BASE_URL}art/cards/card-back.webp`;

function randomFace(prev: SlotFace | null): SlotFace {
  let f: SlotFace;
  do {
    f = {
      characterId: NIGHTSHADE_IDS[Math.floor(Math.random() * NIGHTSHADE_IDS.length)]!,
      pokemonId: PARTNER_IDS[Math.floor(Math.random() * PARTNER_IDS.length)]!,
    };
  } while (prev && f.characterId === prev.characterId && f.pokemonId === prev.pokemonId && NIGHTSHADE_IDS.length > 1);
  return f;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function phaseAt(elapsedMs: number, flipAtMs: number, stopMs: number): SlotPhase {
  if (elapsedMs < flipAtMs) return 'back';
  if (elapsedMs < flipAtMs + FLIP_MS) return 'flip';
  if (elapsedMs >= stopMs + SLOT_SETTLE_MS) return 'settled';
  if (elapsedMs >= stopMs) return 'settling';
  return 'spin';
}

/** Lightweight synthesized blips (self-contained; does not touch the shared app/audio.ts module). Muted-aware. */
let revealAudioCtx: AudioContext | null = null;
function beep(freq: number, delayS: number, durS: number, gain: number): void {
  if (getSettings().muted) return;
  try {
    revealAudioCtx ??= new AudioContext();
    const ctx = revealAudioCtx;
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + delayS;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + durS);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + durS + 0.02);
  } catch {
    // Audio unavailable (blocked autoplay, no WebAudio, …) — the visual reveal still works.
  }
}
const playSlotClick = () => beep(620, 0, 0.08, 0.05);
const playRevealChime = () => { beep(660, 0, 0.12, 0.045); beep(880, 0.09, 0.16, 0.045); beep(988, 0.18, 0.22, 0.04); };

export function DuoCards({ cards, stepLabel, tools, onBack, onSelect }: DuoCardsProps) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const mountedAt = useRef(performance.now());
  useScreenFocus(h1);
  const preview = cards.some((c) => c.preview);

  // ----------------------------------------------------------------------------------------- Slot-machine reveal
  // Driven by setTimeout, not requestAnimationFrame: rAF can go unserviced for a long time (or indefinitely) on a
  // backgrounded/occluded/headless tab, which would leave the reveal stuck mid-spin with no visible cause. A plain
  // timer always keeps firing, which is what this purely-decorative ~4 s cycle actually needs.
  const reducedMotionAtMount = useRef(getSettings().reducedMotion);
  const [slotPhase, setSlotPhase] = useState<SlotPhase[]>(() =>
    cards.map(() => (reducedMotionAtMount.current ? 'settled' : 'back')));
  const [slotFace, setSlotFace] = useState<SlotFace[]>(() => cards.map((c) => randomFace({ characterId: c.duo.characterId, pokemonId: c.duo.pokemonId })));
  const timerId = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef<number | null>(null);
  const nextTickAt = useRef<number[]>(cards.map(() => 0));
  const prevPhase = useRef<SlotPhase[]>(slotPhase);
  const chimePlayed = useRef(false);
  const allSettled = slotPhase.every((p) => p === 'settled');

  const forceReveal = () => {
    if (timerId.current !== null) clearTimeout(timerId.current);
    timerId.current = null;
    startedAt.current = null;
    setSlotPhase((prev) => (prev.every((p) => p === 'settled') ? prev : cards.map(() => 'settled')));
  };

  const TICK_MS = 50;
  useEffect(() => {
    if (reducedMotionAtMount.current) return;
    announce('Dealing three duos…');
    startedAt.current = performance.now();
    const tick = () => {
      if (startedAt.current === null) return; // cancelled (forceReveal / skip / select)
      if (getSettings().reducedMotion) {
        forceReveal();
        return;
      }
      const elapsed = performance.now() - startedAt.current;
      const phases = SLOT_STOP_MS.map((stop, i) => phaseAt(elapsed, FLIP_AT_MS[i]!, stop));
      setSlotPhase((prev) => (prev.every((p, i) => p === phases[i]) ? prev : phases));
      setSlotFace((prevFaces) => {
        let changed = false;
        const next = prevFaces.map((f, i) => {
          if (phases[i] !== 'spin') return f;
          if (elapsed < nextTickAt.current[i]!) return f;
          const t = Math.min(1, elapsed / SLOT_STOP_MS[i]!);
          nextTickAt.current[i] = elapsed + lerp(70, 260, t * t);
          changed = true;
          return randomFace(f);
        });
        return changed ? next : prevFaces;
      });
      const doneByMs = SLOT_STOP_MS[SLOT_STOP_MS.length - 1]! + SLOT_SETTLE_MS;
      timerId.current = elapsed < doneByMs ? setTimeout(tick, TICK_MS) : null;
    };
    timerId.current = setTimeout(tick, TICK_MS);
    return () => {
      if (timerId.current !== null) clearTimeout(timerId.current);
      timerId.current = null;
      startedAt.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Click/chime on phase transitions (edge-detected; never replays for a phase already reported).
  useEffect(() => {
    slotPhase.forEach((p, i) => {
      const was = prevPhase.current[i];
      if (p === 'flip' && was === 'back') audio.play('paper');
      if (p !== 'settling' || was === 'settling' || was === 'settled') return;
      playSlotClick();
    });
    if (allSettled && !chimePlayed.current) {
      chimePlayed.current = true;
      playRevealChime();
      announce('Your three duos are ready.');
    }
    prevPhase.current = slotPhase;
  }, [slotPhase]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusCard = (i: number) => {
    const next = (i + cards.length) % cards.length;
    setActive(next);
    buttons.current[next]?.focus({ preventScroll: true });
    if (!allSettled) return; // names/stats aren't real yet — nothing useful to announce
    const c = cards[next];
    if (c) announceSelection(`${c.duoName}: ${c.characterName} and ${c.pokemonName}. ${ROLE_LABEL[c.role]}.`);
  };

  const commit = (i: number) => {
    if (chosen !== null) return;
    if (!allSettled) forceReveal(); // a click/Enter mid-spin skips straight to the real cards, then selects
    setChosen(i);
    setActive(i);
  };
  useEffect(() => {
    if (chosen === null) return;
    const c = cards[chosen];
    const t = setTimeout(() => c && onSelect(c.duo), COMMIT_MS);
    return () => clearTimeout(t);
  }, [chosen]); // eslint-disable-line react-hooks/exhaustive-deps

  useHotkeys((key) => {
    if (chosen !== null) return true;
    if (key === 'arrowleft') {
      focusCard(active - 1);
      return true;
    }
    if (key === 'arrowright') {
      focusCard(active + 1);
      return true;
    }
    if (key === '1' || key === '2' || key === '3') {
      focusCard(Number(key) - 1);
      return true;
    }
    if (key === 'escape' || key === 'backspace') {
      onBack();
      return true;
    }
  });

  return (
    <main className={`screen duo-draft${chosen !== null ? ' is-committing' : ''}${allSettled ? '' : ' is-revealing'}`} data-testid="screen-cards" data-reveal={allSettled ? 'settled' : 'spin'}>
      <header className="duo-draft__head">
        <div>
          <p className="caps">{stepLabel}</p>
          <h1 ref={h1} tabIndex={-1} className="display duo-draft__title">Choose your duo</h1>
        </div>
        <p className="duo-draft__legend text-2">
          {allSettled
            ? 'Three duos were drawn for you. Stats compare duos: 1 low · 3 typical · 5 high. Frames are decoration only.'
            : 'Dealing three duos…'}
        </p>
        {tools}
      </header>

      <div className="duo-row">
        {cards.map((c, i) => (
          <DuoCardItem
            key={c.key}
            view={c}
            index={i}
            active={i === active}
            chosen={chosen === i}
            phase={slotPhase[i]!}
            face={slotFace[i]!}
            buttonRef={(el) => {
              buttons.current[i] = el;
            }}
            onFocusCard={() => setActive(i)}
            onBodyClick={() => focusCard(i)}
            onSelect={(e) => {
              // Enter guard: ignore Enter for 600 ms after mount and on auto-repeat.
              if (e.detail === 0 && performance.now() - mountedAt.current < ENTER_GUARD_MS) return;
              commit(i);
            }}
          />
        ))}
      </div>

      <footer className="duo-draft__foot">
        <Button variant="ghost" onClick={onBack} data-testid="btn-back">Back</Button>
        <p className="text-2 duo-draft__keys"><kbd>←</kbd> <kbd>→</kbd> choose · <kbd>Enter</kbd> selects · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> jump</p>
        {!allSettled && (
          <Button variant="ghost" size="sm" className="duo-draft__skip" onClick={forceReveal} data-testid="btn-skip-reveal">
            Skip animation
          </Button>
        )}
        {preview && (
          <p className="duo-draft__preview" data-testid="cards-preview-note"><Icon name="alert" /> Preview cards: stats pending the duo registry.</p>
        )}
        <p className="duo-draft__thing"><ThingSigil size={32} pose={allSettled ? 'point' : 'tap'} /> {allSettled ? 'Pick the pair you like.' : 'Thing deals your cards…'}</p>
      </footer>
    </main>
  );
}

interface DuoCardItemProps {
  view: DuoCardView;
  index: number;
  active: boolean;
  chosen: boolean;
  phase: SlotPhase;
  face: SlotFace;
  buttonRef: (el: HTMLButtonElement | null) => void;
  onFocusCard: () => void;
  onBodyClick: () => void;
  onSelect: (e: ReactMouseEvent<HTMLButtonElement>) => void;
}

function DuoCardItem({ view: c, index, active, chosen, phase, face, buttonRef, onFocusCard, onBodyClick, onSelect }: DuoCardItemProps) {
  const titleId = `duo-${index}-title`;
  const settled = phase === 'settled';
  return (
    <article
      className={`duo-card${active ? ' is-active' : ''}${chosen ? ' is-chosen' : ''}${settled ? '' : ' duo-card--spin'}`}
      data-rarity={settled ? c.rarity : undefined}
      data-role={settled ? c.role : undefined}
      data-slot-phase={phase}
      aria-labelledby={titleId}
      data-testid={`duo-card-${index}`}
      data-duo={c.key}
      onMouseEnter={onFocusCard}
      onFocus={onFocusCard}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('button')) onBodyClick();
      }}
    >
      {chosen && <span className="duo-card__ribbon">Chosen</span>}
      {(phase === 'back' || phase === 'flip') && (
        <div className="duo-card__back" aria-hidden="true">
          <img src={CARD_BACK} alt="" draggable={false} decoding="async" />
        </div>
      )}
      {settled ? (
        <>
          <div className="duo-card__title">
            <h2 id={titleId} className="duo-card__duo">{c.duoName}</h2>
            <span className="duo-card__rarity"><span className={`rarity-gem rarity-gem--${c.rarity}`} aria-hidden="true" />{c.rarity}</span>
          </div>

          <div className="duo-card__art" aria-hidden="true">
            <Portrait src={c.characterArt} name={c.characterShort} className="duo-card__portrait" />
            <span className="duo-card__amp">&amp;</span>
            <Portrait src={c.pokemonArt} name={c.pokemonName} className="duo-card__medallion" />
            <span className="role-chip duo-card__role"><Icon name={ROLE_ICON[c.role]} /> {ROLE_LABEL[c.role]}</span>
          </div>

          <p className="duo-card__names">{c.characterName} · {c.pokemonName}</p>

          <StatGrid view={c} />

          <AbilityBox a={c.power} preview={c.preview} />
          <AbilityBox a={c.move} preview={c.preview} />

          <ul className="duo-card__trade" aria-label="Advantages and disadvantages" data-testid="trade-list">
            {c.preview && <li className="duo-card__pending">Trade-offs pending the duo registry</li>}
            {c.advantages.map((t, i) => (
              <li key={`a${i}`} className="trade trade--pro"><span className="trade__mark" aria-hidden="true">+</span><span className="sr-only">Advantage: </span>{t}</li>
            ))}
            {c.disadvantages.map((t, i) => (
              <li key={`d${i}`} className="trade trade--con"><span className="trade__mark" aria-hidden="true">−</span><span className="sr-only">Disadvantage: </span>{t}</li>
            ))}
          </ul>
        </>
      ) : (
        <SlotSpinFace titleId={titleId} face={face} />
      )}

      <Button
        ref={buttonRef}
        variant={active ? 'primary' : 'secondary'}
        className="duo-card__select"
        tabIndex={active ? 0 : -1}
        onClick={onSelect}
        aria-label={`Select ${c.duoName}: ${c.characterName} and ${c.pokemonName}, ${ROLE_LABEL[c.role]}`}
        data-testid={`btn-select-duo-${index}`}
      >
        Select duo
      </Button>
    </article>
  );
}

/**
 * Fills the exact same 7 grid rows `settled` content occupies (title/art/names/stats/power/move/trade — row 8, the
 * Select button, is rendered unconditionally by the caller) so settling never shifts the card's size. Portraits cycle
 * through the real roster via `face`; everything else is a non-reactive shimmer placeholder.
 */
function SlotSpinFace({ titleId, face }: { titleId: string; face: SlotFace }) {
  return (
    <>
      <div className="duo-card__title">
        <h2 id={titleId} className="duo-card__duo duo-card__duo--spin">Drawing…</h2>
        <span className="duo-card__rarity duo-card__rarity--spin" aria-hidden="true" />
      </div>

      <div className="duo-card__art" aria-hidden="true">
        <Portrait key={face.characterId} src={characterArt(face.characterId)} name="" className="duo-card__portrait duo-card__portrait--spin" />
        <span className="duo-card__amp">&amp;</span>
        <Portrait key={face.pokemonId} src={pokemonArt(face.pokemonId)} name="" className="duo-card__medallion duo-card__medallion--spin" />
      </div>

      <p className="duo-card__names duo-card__names--spin" aria-hidden="true">&nbsp;</p>

      <div className="duo-shimmer duo-shimmer--stats" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => <span key={i} />)}
      </div>
      <div className="duo-shimmer duo-shimmer--ability" aria-hidden="true" />
      <div className="duo-shimmer duo-shimmer--ability" aria-hidden="true" />
      <div className="duo-shimmer duo-shimmer--trade" aria-hidden="true" />
    </>
  );
}

function StatGrid({ view: c }: { view: DuoCardView }) {
  return (
    <div className="duo-stats" data-testid={c.stats ? 'stats' : 'stats-pending'}>
      {STAT_ROWS.map((r) => {
        if (!c.stats) {
          return (
            <div key={r.key} className="stat-row">
              <span className="stat-row__label">{r.label}</span>
              <span className="stat-pips stat-pips--pending" aria-label={`${r.label}: pending`} />
              <span />
            </div>
          );
        }
        const v = Math.max(1, Math.min(STAT_MAX, Math.round(c.stats[r.key])));
        const best = c.best.includes(r.key);
        return (
          <div key={r.key} className="stat-row">
            <span className="stat-row__label">{r.label}</span>
            <span className="stat-pips" role="meter" aria-label={r.label} aria-valuemin={1} aria-valuemax={STAT_MAX} aria-valuenow={v}
              aria-valuetext={`${v} of ${STAT_MAX}${best ? ', best of the three' : ''}`}>
              {Array.from({ length: STAT_MAX }, (_, i) => <span key={i} className={`stat-pip${i < v ? ' is-on' : ''}`} />)}
            </span>
            <span className="stat-row__num num" aria-hidden="true">{v}{best && <span className="stat-row__best" title="Best of the three">▲</span>}</span>
          </div>
        );
      })}
    </div>
  );
}

function AbilityBox({ a, preview }: { a: AbilityView; preview: boolean }) {
  return (
    <div className={`ability-box ability-box--${a.key === 'F' ? 'power' : 'move'}`}>
      <p className="ability-box__head">
        <kbd className="kcap">{a.key}</kbd>
        <span className="ability-box__name">{a.name}</span>
        {a.key === 'Q' && a.adaptationNote
          ? <span className="ability-box__adapt" title={a.adaptationNote}>Game adaptation</span>
          : <span className="ability-box__kind">{a.kind}</span>}
        {a.loud && <span className="loud-tag">LOUD</span>}
        {a.cooldownS !== null && <span className="ability-box__cd num" aria-label={`cooldown ${Math.round(a.cooldownS)} seconds`}>{Math.round(a.cooldownS)} s</span>}
      </p>
      <p className="ability-box__text">{a.text ?? (preview ? 'Effect details pending the registry.' : '')}</p>
    </div>
  );
}

/** Portrait with explicit size (no layout shift) and a Cinzel-initial crest fallback when the image is missing. */
function Portrait({ src, name, className }: { src: string; name: string; className: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed) {
    return <span className={`${className} portrait-fallback`}><span>{name.slice(0, 1)}</span></span>;
  }
  return <img className={className} src={src} alt="" width={120} height={120} loading="eager" decoding="async" onError={() => setFailed(true)} />;
}
