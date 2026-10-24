// Duo draft (UX_MYSTERY §2, UX_OVERHAUL §8, UX_DUO_CARDS): three original gothic trading cards side by side, in the
// anatomy of a Pokémon card (63:88, gold frame, type-coloured face). Each card, top to bottom: the duo name
// ("Bianca’s Alolan Marowak") with "100 HP" + the type symbol and the grab cost (vitals from the real tuning), the
// generated duo title on a silver ribbon, the art window (DuoCardArt — 3d-artist), identity · types + role chip, the
// character power (key Q) and the real Pokémon move (key R; caps from ABILITY_KEY_LABEL — never F) as attack rows with a
// one-line effect and a big cooldown, a strengths / weakness strip derived from the stats, rarity + set number, then
// [Select duo][Details]. Details (or D) opens the full stats, texts, adaptation notes and trade-offs on all three cards
// at once (comparison); Esc closes it before going Back. Keyboard: focus starts on the H1; ← → and 1 2 3 move focus
// among the Select buttons (roving tabindex); Enter/Space select; Enter ignored for 600 ms after mount and on key
// repeat. Clicking a card body only focuses it.
//
// Slot-machine reveal (feature add-on, purely presentational): the 3 bundles are already fixed in `cards` before this
// component ever mounts (drawn upstream, unchanged here). The cards are dealt FACE-DOWN (the supplied card-back art,
// public/art/cards/card-back.webp), flip over left → right, then run a cycling "draw" before showing their real stats
// (~4.5 s in all). A `duo-card-N` / `btn-select-duo-N` pair exists and is clickable from the very
// first frame for every card: clicking (or Enter-selecting) one at any point during the spin instantly reveals all
// three and selects that one, so nothing that already depends on immediate card-screen interactivity breaks.
import { Fragment, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
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
import { DuoCardArt } from './card/DuoCardArt.tsx';
import { PowerDisc, TypeDisc } from './card/TypeSymbol.tsx';
import {
  characterArt, pokemonArt, RARITY_GLYPH, RARITY_LABEL, ROLE_ICON, ROLE_LABEL, STAT_MAX, STAT_ROWS, TYPE_THEME, vitalsSpeech,
  type AbilityView, type DuoCardView, type NameFit, type ThemeType,
} from './duoView.ts';
import '../styles/duoCard.css';
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

/** Card-root custom properties read by the face and by DuoCardArt (UX_DUO_CARDS §3). */
function themeStyle(t: ThemeType): CSSProperties {
  const th = TYPE_THEME[t];
  return { '--type-face-top': th.top, '--type-face-bottom': th.bottom, '--type-accent': th.accent } as CSSProperties;
}

export function DuoCards({ cards, stepLabel, tools, onBack, onSelect }: DuoCardsProps) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [details, setDetails] = useState(false);
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

  // Preload every portrait + Pokémon (25 images) so the spin never shows a half-loaded frame.
  useEffect(() => {
    if (typeof Image === 'undefined') return;
    for (const id of NIGHTSHADE_IDS) new Image().src = characterArt(id);
    for (const id of PARTNER_IDS) new Image().src = pokemonArt(id);
  }, []);

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

  /** Details opens/closes on all three cards together (comparison). Only once the real cards are showing. */
  const toggleDetails = (open = !details) => {
    if (!allSettled || chosen !== null) return;
    setDetails(open);
    announce(open ? 'Details shown for all three duos. Press D or Escape to close.' : 'Details closed.');
  };

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
    if (key === 'd') {
      toggleDetails();
      return true;
    }
    if (key === 'escape' || key === 'backspace') {
      if (details) toggleDetails(false); // Esc closes Details before going Back
      else onBack();
      return true;
    }
  });

  return (
    <main
      className={`screen duo-draft${chosen !== null ? ' is-committing' : ''}${allSettled ? '' : ' is-revealing'}${details ? ' has-details' : ''}`}
      data-testid="screen-cards"
      data-reveal={allSettled ? 'settled' : 'spin'}
    >
      <header className="duo-draft__head">
        <div>
          <p className="caps">{stepLabel}</p>
          <h1 ref={h1} tabIndex={-1} className="display duo-draft__title">Choose your duo</h1>
        </div>
        <p className="duo-draft__legend text-2">
          {allSettled
            ? <>Three duos were drawn for you. <span aria-hidden="true">⧗</span><span className="sr-only">The hourglass number</span> = cooldown in seconds. <Icon name="barChart" className="duo-draft__stats-icon" />Stats compare duos: 1 low · 3 typical · 5 high (<kbd>D</kbd>). Frames are decoration only.</>
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
            detailsOpen={details && allSettled}
            detailsReady={allSettled && chosen === null}
            buttonRef={(el) => {
              buttons.current[i] = el;
            }}
            onFocusCard={() => setActive(i)}
            onBodyClick={() => focusCard(i)}
            onToggleDetails={() => toggleDetails()}
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
        <p className="text-2 duo-draft__keys"><kbd>←</kbd> <kbd>→</kbd> choose · <kbd>Enter</kbd> selects · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> jump · <kbd>D</kbd> details</p>
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
  detailsOpen: boolean;
  detailsReady: boolean;
  buttonRef: (el: HTMLButtonElement | null) => void;
  onFocusCard: () => void;
  onBodyClick: () => void;
  onToggleDetails: () => void;
  onSelect: (e: ReactMouseEvent<HTMLButtonElement>) => void;
}

const NEXT_FIT: Record<NameFit, NameFit> = { lg: 'md', md: 'sm', sm: 'sm' };

function DuoCardItem({
  view: c, index, active, chosen, phase, face, detailsOpen, detailsReady, buttonRef, onFocusCard, onBodyClick, onToggleDetails, onSelect,
}: DuoCardItemProps) {
  const titleId = `duo-${index}-title`;
  const detailsId = `duo-${index}-details`;
  const settled = phase === 'settled';
  // The face stays on the neutral Ghost palette while the slot spins (a type-colour flicker every 70 ms would be a
  // flash hazard); the real type face cross-fades in on settle (registered custom properties, 300 ms).
  const theme: ThemeType = settled ? c.themeType : 'ghost';
  return (
    <article
      className={`duo-card${active ? ' is-active' : ''}${chosen ? ' is-chosen' : ''}${settled ? '' : ' duo-card--spin'}`}
      data-type={theme}
      data-rarity={settled ? c.rarity : undefined}
      data-role={settled ? c.role : undefined}
      data-slot-phase={phase}
      aria-labelledby={titleId}
      data-testid={`duo-card-${index}`}
      data-duo={c.key}
      style={themeStyle(theme)}
      onMouseEnter={onFocusCard}
      onFocus={onFocusCard}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('button')) onBodyClick();
      }}
    >
      {chosen && <span className="duo-card__ribbon">Chosen</span>}
      {(phase === 'back' || phase === 'flip') && (
        <div className="duo-card__back" aria-hidden="true">
          <img src={CARD_BACK} alt="" width={412} height={576} draggable={false} decoding="async" />
        </div>
      )}
      <div className="duo-card__face">
        {settled ? (
          <SettledFace view={c} titleId={titleId} />
        ) : (
          <SlotSpinFace titleId={titleId} face={phase === 'settling' ? { characterId: c.duo.characterId, pokemonId: c.duo.pokemonId } : face} />
        )}

        {settled && <DetailsPanel view={c} id={detailsId} open={detailsOpen} />}

        <div className="duo-card__actions">
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
          <Button
            variant="ghost"
            className="duo-card__details-btn"
            tabIndex={active ? 0 : -1}
            inactive={!detailsReady}
            aria-expanded={detailsOpen}
            aria-controls={settled ? detailsId : undefined}
            onClick={onToggleDetails}
            data-testid={`btn-duo-details-${index}`}
          >
            Details
          </Button>
        </div>
      </div>
    </article>
  );
}

function SettledFace({ view: c, titleId }: { view: DuoCardView; titleId: string }) {
  const nameRef = useRef<HTMLHeadingElement>(null);
  const [fit, setFit] = useState<NameFit>(c.nameFit);
  // Safety net over the measured width table: once the webfont is in, step the name down if it still overflows.
  useEffect(() => {
    let live = true;
    const check = () => {
      const el = nameRef.current;
      if (live && el && fit !== 'sm' && el.scrollWidth > el.clientWidth + 1) setFit(NEXT_FIT[fit]);
    };
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts || fonts.status === 'loaded') check();
    else void fonts.ready.then(check);
    return () => {
      live = false;
    };
  }, [fit]);

  return (
    <>
      <div className="duo-card__names">
        <h2 id={titleId} ref={nameRef} className="duo-card__duo duo-card__who" data-fit={fit}>{c.displayName}</h2>
        <p className="duo-card__title-ribbon"><span>{c.duoName}</span></p>
        <div className="duo-card__vitals" data-testid={c.vitals ? 'duo-vitals' : undefined}>
          {c.vitals ? (
            <span className="duo-card__vt" aria-hidden="true">
              <span className="duo-card__hp"><span className="duo-card__hp-num">{c.vitals.maxHp}</span><span className="duo-card__hp-label">{' HP'}</span></span>
              <span className="duo-card__vsep">{' · '}</span>
              <span className="duo-card__grab">{`grab −${c.vitals.grabHp}`}</span>
            </span>
          ) : (
            <span className="duo-card__vt duo-card__vt--pending" aria-hidden="true"><span className="duo-card__hp">HP —</span></span>
          )}
          <TypeDisc type={c.themeType} size="lg" className="duo-card__type" />
          {c.ghostSecondary && <TypeDisc type="ghost" size="sm" className="duo-card__type2" />}
          {c.vitals && <span className="sr-only">{vitalsSpeech(c.vitals)}</span>}
        </div>
      </div>

      <div className="duo-card__art">
        <DuoCardArt
          characterArt={c.characterArt}
          characterName={c.characterName}
          pokemonArt={c.pokemonArt}
          pokemonId={c.duo.pokemonId}
          pokemonName={c.pokemonName}
        />
      </div>

      <p className="duo-card__caption">
        <span className="duo-card__ident">{c.identityShort} · {c.typesLabel}</span>
        <span className="role-chip duo-card__role"><Icon name={ROLE_ICON[c.role]} /> {ROLE_LABEL[c.role]}</span>
      </p>

      <AbilityRow a={c.power} glyph={<PowerDisc />} preview={c.preview} />
      <AbilityRow a={c.move} glyph={<TypeDisc type={c.themeType} size="md" />} preview={c.preview} />

      <div className="duo-card__strip">
        {c.stats ? (
          <>
            <p className="strip__line strip__line--pro">
              <span className="strip__mark" aria-hidden="true">+</span>
              <span className="strip__label">Advantages:</span>
              <span className="strip__value">
                {c.strengths.map((s, i) => (
                  <Fragment key={s.key}>
                    {i > 0 && ', '}
                    {s.label}
                    {s.best && <><span className="strip__best" aria-hidden="true" title="Best of the three">▲</span><span className="sr-only"> (best of the three)</span></>}
                  </Fragment>
                ))}
              </span>
            </p>
            <p className="strip__line strip__line--con">
              <span className="strip__mark" aria-hidden="true">−</span>
              <span className="strip__label">Disadvantage:</span>
              <span className="strip__value">{c.weakness ? `Low ${c.weakness.label}` : 'Balanced — no stat below 3'}</span>
            </p>
          </>
        ) : (
          <p className="strip__line strip__line--pending">Stats pending the duo registry</p>
        )}
      </div>

      <p className="duo-card__flavour">
        <span className="duo-card__rarity"><span className="duo-card__rarity-glyph" aria-hidden="true">{RARITY_GLYPH[c.rarity]}</span> {RARITY_LABEL[c.rarity]}</span>
        <span className="duo-card__set" aria-hidden="true">Nevermore · {c.setNumber}</span>
      </p>
    </>
  );
}

/**
 * Fills the exact same face rows the settled content occupies (names ×2 / art / caption / power / move / strip /
 * flavour — row 9, the buttons, is rendered by the caller) so settling never shifts the card's size. The art window
 * cycles through the real roster via `face`; everything else is a non-reactive shimmer placeholder.
 */
function SlotSpinFace({ titleId, face }: { titleId: string; face: SlotFace }) {
  const n = NIGHTSHADES[face.characterId];
  const p = PARTNERS[face.pokemonId];
  return (
    <>
      <div className="duo-card__names duo-card__names--spin">
        <h2 id={titleId} className="duo-card__duo duo-card__who duo-card__duo--spin">Drawing…</h2>
        <span className="duo-shimmer duo-shimmer--ribbon" aria-hidden="true" />
        <span className="duo-shimmer duo-shimmer--hp" aria-hidden="true" />
      </div>

      <div className="duo-card__art" aria-hidden="true">
        <DuoCardArt
          characterArt={characterArt(face.characterId)}
          characterName={n.name}
          pokemonArt={pokemonArt(face.pokemonId)}
          pokemonId={face.pokemonId}
          pokemonName={p.name}
          spinning
        />
      </div>

      <div className="duo-shimmer duo-shimmer--caption" aria-hidden="true" />
      <div className="duo-shimmer duo-shimmer--ability" aria-hidden="true" />
      <div className="duo-shimmer duo-shimmer--ability" aria-hidden="true" />
      <div className="duo-shimmer duo-shimmer--strip" aria-hidden="true" />
      <div className="duo-shimmer duo-shimmer--flavour" aria-hidden="true" />
    </>
  );
}

function AbilityRow({ a, glyph, preview }: { a: AbilityView; glyph: ReactNode; preview: boolean }) {
  const cd = a.cooldownS !== null ? Math.round(a.cooldownS) : null;
  return (
    <div className={`ability-box ability-box--${a.key === 'F' ? 'power' : 'move'}`}>
      <span className="ability-box__icons">{glyph}<kbd className="kcap">{a.cap}</kbd></span>
      <p className="ability-box__head">
        <span className="sr-only">{a.kind}: </span>
        <span className="ability-box__name">{a.name}</span>
        {a.adaptationNote && <span className="ability-box__adapt" title={a.adaptationNote}>Game adaptation</span>}
      </p>
      <p className="ability-box__text">
        {a.loud && <span className="loud-tag">LOUD</span>}
        <span className="ability-box__short">{a.short ?? (preview ? 'Effect details pending the registry.' : '')}</span>
      </p>
      {cd !== null && (
        <span className="ability-box__cd" role="img" aria-label={`cooldown ${cd} seconds`}>
          <Icon name="hourglass" />
          <span className="ability-box__cd-num">{cd}</span>
          <span className="ability-box__cd-unit">s</span>
        </span>
      )}
    </div>
  );
}

/** Details overlay (§1): covers the face from the art top to the button row; the header stays visible. */
function DetailsPanel({ view: c, id, open }: { view: DuoCardView; id: string; open: boolean }) {
  return (
    <section id={id} className="duo-card__details" hidden={!open} aria-label={`${c.displayName}: full details`}>
      {c.vitals && <p className="dd__vitals">{vitalsSpeech(c.vitals)}</p>}
      <StatGrid view={c} />
      <DetailAbility a={c.power} />
      <DetailAbility a={c.move} />
      <ul className="dd__trade" aria-label="Advantages and disadvantages" data-testid="trade-list">
        {c.preview && <li className="duo-card__pending">Trade-offs pending the duo registry</li>}
        {c.advantages.map((t, i) => (
          <li key={`a${i}`} className="trade trade--pro"><span className="trade__mark" aria-hidden="true">+</span><span className="sr-only">Advantage: </span>{t}</li>
        ))}
        {c.disadvantages.map((t, i) => (
          <li key={`d${i}`} className="trade trade--con"><span className="trade__mark" aria-hidden="true">−</span><span className="sr-only">Disadvantage: </span>{t}</li>
        ))}
      </ul>
    </section>
  );
}

function DetailAbility({ a }: { a: AbilityView }) {
  const cd = a.cooldownS !== null ? Math.round(a.cooldownS) : null;
  return (
    <div className="dd__ability">
      <p className="dd__ability-head">
        <span className="dd__key" aria-label={`key ${a.cap}`}>{a.cap}</span>
        <span className="dd__ability-name">{a.name}</span>
        <span className="dd__ability-kind">{a.kind}{a.loud ? ' · loud' : ''}</span>
        {cd !== null && <span className="dd__ability-cd">{cd} s cooldown</span>}
      </p>
      {a.text && <p className="dd__ability-text">{a.text}</p>}
      {a.adaptationNote && <p className="dd__ability-note">{a.adaptationNote}</p>}
    </div>
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
