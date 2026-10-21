// Duo draft (UX_MYSTERY §2): three original gothic, Pokémon-card-INSPIRED cards side by side. Each card: duo name +
// cosmetic rarity, arch portrait + Pokémon medallion, role chip (icon + word), names, six absolute 1–5 stats with the
// best-of-three ▲, F power and Q real move (Game adaptation badge, LOUD tag), 2 advantages + 1–2 disadvantages, one
// "Select duo". Keyboard: focus starts on the H1; ← → and 1 2 3 move focus among the Select buttons (roving tabindex);
// Enter/Space select; Enter ignored for 600 ms after mount and on key repeat. Clicking a card body only focuses it.
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { Duo } from '../../mystery/types.ts';
import { announceSelection } from '../../app/announce.tsx';
import { useHotkeys, useScreenFocus } from '../../app/keyboard.ts';
import { Button } from '../components/Button.tsx';
import { ThingSigil } from '../components/ThingSigil.tsx';
import { Icon } from '../Icon.tsx';
import { ROLE_ICON, ROLE_LABEL, STAT_MAX, STAT_ROWS, type AbilityView, type DuoCardView } from './duoView.ts';

interface DuoCardsProps {
  cards: DuoCardView[];
  stepLabel: string;
  tools: ReactNode;
  onBack: () => void;
  onSelect: (duo: Duo) => void;
}

const ENTER_GUARD_MS = 600;
const COMMIT_MS = 600;

export function DuoCards({ cards, stepLabel, tools, onBack, onSelect }: DuoCardsProps) {
  const h1 = useRef<HTMLHeadingElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const mountedAt = useRef(performance.now());
  useScreenFocus(h1);
  const preview = cards.some((c) => c.preview);

  const focusCard = (i: number) => {
    const next = (i + cards.length) % cards.length;
    setActive(next);
    buttons.current[next]?.focus({ preventScroll: true });
    const c = cards[next];
    if (c) announceSelection(`${c.duoName}: ${c.characterName} and ${c.pokemonName}. ${ROLE_LABEL[c.role]}.`);
  };

  const commit = (i: number) => {
    if (chosen !== null) return;
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
    <main className={`screen duo-draft${chosen !== null ? ' is-committing' : ''}`} data-testid="screen-cards">
      <header className="duo-draft__head">
        <div>
          <p className="caps">{stepLabel}</p>
          <h1 ref={h1} tabIndex={-1} className="display duo-draft__title">Choose your duo</h1>
        </div>
        <p className="duo-draft__legend text-2">
          Three duos were drawn for you. Stats compare duos: 1 low · 3 typical · 5 high. Frames are decoration only.
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
        {preview && (
          <p className="duo-draft__preview" data-testid="cards-preview-note"><Icon name="alert" /> Preview cards: stats pending the duo registry.</p>
        )}
        <p className="duo-draft__thing"><ThingSigil size={32} pose="point" /> Pick the pair you like.</p>
      </footer>
    </main>
  );
}

interface DuoCardItemProps {
  view: DuoCardView;
  index: number;
  active: boolean;
  chosen: boolean;
  buttonRef: (el: HTMLButtonElement | null) => void;
  onFocusCard: () => void;
  onBodyClick: () => void;
  onSelect: (e: ReactMouseEvent<HTMLButtonElement>) => void;
}

function DuoCardItem({ view: c, index, active, chosen, buttonRef, onFocusCard, onBodyClick, onSelect }: DuoCardItemProps) {
  const titleId = `duo-${index}-title`;
  return (
    <article
      className={`duo-card${active ? ' is-active' : ''}${chosen ? ' is-chosen' : ''}`}
      data-rarity={c.rarity}
      data-role={c.role}
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
