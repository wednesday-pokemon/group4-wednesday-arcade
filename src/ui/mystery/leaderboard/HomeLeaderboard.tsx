// Home-page leaderboard (docs/final/UX_FINAL.md §5): a compact "Top Detectives" panel on the RIGHT of the existing home
// (top 5 verified v4 finishers: rank, duo portraits, nickname, score; #1 highlighted), a LIVE / LOCAL DEMO /
// "Reconnecting…" chip, live-update animations (new row slides in + lantern flash, FLIP reorder, "New #1!" for 4 s;
// reduced motion = flash only), skeleton while loading, a readable empty state and "View Full Leaderboard" → modal.
// Below 1100 CSS px the panel hides and a trophy button in the topline opens the same modal. Never takes focus: the
// home's Start button keeps the initial focus (Splash).
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useSettings } from '../../../app/settings.ts';
import { Icon } from '../../Icon.tsx';
import { characterArt, pokemonArt } from '../duoView.ts';
import { LeaderboardModal } from './LeaderboardModal.tsx';
import { fmtPoints, HOME_TOP_N, type BoardEntry, type HomeBoardFeed, type HomeBoardSnapshot } from './model.ts';
import '../../styles/leaderboard.css';

const FLASH_MS = 1200;
const NEW_FIRST_MS = 4000;
const FLIP_MS = 300;

/** Subscribe to a board feed (null until the first snapshot). */
export function useHomeBoard(feed: HomeBoardFeed): HomeBoardSnapshot | null {
  const [snap, setSnap] = useState<HomeBoardSnapshot | null>(null);
  useEffect(() => feed.subscribe(setSnap), [feed]);
  return snap;
}

export interface HomeBoardSlots {
  /** The panel (absolute, right column) — hidden below 1100 px by CSS. */
  panel: ReactNode;
  /** Trophy button for the topline — shown only below 1100 px by CSS. */
  button: ReactNode;
}

/**
 * Owns the feed subscription + the modal; hands the panel and the topline button to the page through a render prop
 * (the topline belongs to Splash).
 */
export function HomeBoard({ feed, children }: { feed: HomeBoardFeed; children: (slots: HomeBoardSlots) => ReactNode }) {
  const snap = useHomeBoard(feed);
  const reducedMotion = useSettings().reducedMotion;
  const [open, setOpen] = useState(false);
  const panel = <HomeBoardPanel snap={snap} reducedMotion={reducedMotion} onOpenFull={() => setOpen(true)} />;
  const button = (
    <button
      type="button" className="icon-btn home-board-btn" aria-label="Leaderboard" title="Leaderboard"
      onClick={() => setOpen(true)} data-testid="btn-home-board"
    >
      <Icon name="trophy" />
    </button>
  );
  return (
    <>
      {children({ panel, button })}
      {open && <LeaderboardModal snap={snap} onClose={() => setOpen(false)} />}
    </>
  );
}

function chipOf(snap: HomeBoardSnapshot | null): { kind: 'live' | 'local' | 'reconnecting'; text: string } {
  if (!snap || snap.source === 'local') return { kind: 'local', text: 'LOCAL DEMO' };
  return snap.status === 'reconnecting' ? { kind: 'reconnecting', text: 'Reconnecting…' } : { kind: 'live', text: 'LIVE' };
}

export function HomeBoardPanel({ snap, onOpenFull, reducedMotion = false }: { snap: HomeBoardSnapshot | null; onOpenFull: () => void; reducedMotion?: boolean }) {
  const titleId = useId();
  const reduced = reducedMotion;
  const rows = (snap?.top ?? []).slice(0, HOME_TOP_N);
  const loading = !snap || (snap.status === 'loading' && rows.length === 0);
  const chip = chipOf(snap);
  const { fresh, newFirst, announce } = useLiveChanges(rows, loading);
  const listRef = useFlip(rows, reduced);

  return (
    <section
      className="home-board panel" aria-labelledby={titleId} data-testid="home-board"
      data-source={snap?.source ?? 'local'} data-status={loading ? 'loading' : rows.length === 0 ? 'empty' : snap?.status}
    >
      <header className="home-board__head">
        <div className="home-board__titles">
          <p className="home-board__kicker">TONIGHT · TOP 5</p>
          <h2 id={titleId} className="home-board__title display">Top Detectives</h2>
        </div>
        <div className="home-board__chips">
          {newFirst && <span className="home-board__new" data-testid="home-board-new-first">New #1!</span>}
          <span className={`home-board__chip home-board__chip--${chip.kind}`} data-testid="home-board-chip" data-kind={chip.kind}>
            {chip.kind === 'live' && <span className="home-board__dot" aria-hidden="true" />}
            {chip.kind === 'reconnecting' && <Icon name="wifiOff" />}
            {chip.text}
          </span>
        </div>
      </header>

      {loading ? (
        <ol className="home-board__rows" aria-busy="true" aria-label="Loading the leaderboard" data-testid="home-board-skeleton">
          {Array.from({ length: HOME_TOP_N }, (_, i) => <li key={i} className="hb-row hb-row--skel"><span className="hb-skel" /></li>)}
        </ol>
      ) : rows.length === 0 ? (
        <div className="home-board__empty" data-testid="home-board-empty">
          <Icon name="trophy" className="home-board__empty-icon" />
          <p className="home-board__empty-1">No detectives on the board yet.</p>
          <p className="home-board__empty-2">Solve a case to claim #1.</p>
        </div>
      ) : (
        <ol className="home-board__rows" ref={listRef} data-testid="home-board-rows">
          {rows.map((e) => <BoardRow key={e.id} e={e} fresh={fresh.has(e.id)} />)}
        </ol>
      )}

      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      <p className="home-board__foot" data-testid="home-board-foot">
        {snap?.source === 'live' ? 'Verified scores · new rules (v4)' : 'This laptop only · not verified'}
      </p>
      <button type="button" className="btn btn--ghost btn--md home-board__more" onClick={onOpenFull} data-testid="btn-full-board">
        <Icon name="trophy" />View Full Leaderboard
      </button>
    </section>
  );
}

function BoardRow({ e, fresh }: { e: BoardEntry; fresh: boolean }) {
  const first = e.rank === 1;
  return (
    <li
      className={`hb-row${first ? ' is-first' : ''}${fresh ? ' is-fresh' : ''}`} data-id={e.id} data-rank={e.rank ?? undefined}
      data-testid={`home-board-row-${e.rank ?? 0}`}
    >
      <span className="hb-row__rank num">
        {first && <Icon name="trophy" className="hb-row__trophy" />}
        <span>{e.rank}</span>
      </span>
      {e.duo ? (
        <span className="hb-row__duo" aria-hidden="true">
          <img src={characterArt(e.duo.characterId)} alt="" width={28} height={28} loading="lazy" decoding="async" />
          <img src={pokemonArt(e.duo.pokemonId)} alt="" width={28} height={28} loading="lazy" decoding="async" />
        </span>
      ) : <span className="hb-row__duo hb-row__duo--none" aria-hidden="true" />}
      <span className="hb-row__name" title={e.nickname}>{e.nickname}</span>
      <span className="hb-row__score num">
        {fmtPoints(e.score ?? 0)}
        <span className="sr-only"> points</span>
      </span>
    </li>
  );
}

/** Rows that just appeared (flash 1.2 s) + a new #1 (chip 4 s) + a polite announcement. Nothing on the first data. */
function useLiveChanges(rows: BoardEntry[], loading: boolean) {
  const prev = useRef<{ ids: Set<string>; first: string | null } | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const [newFirst, setNewFirst] = useState(false);
  const [announce, setAnnounce] = useState('');
  const key = rows.map((r) => `${r.id}:${r.score}`).join('|');
  useEffect(() => {
    if (loading) return undefined;
    const ids = new Set(rows.map((r) => r.id));
    const first = rows[0]?.id ?? null;
    const before = prev.current;
    prev.current = { ids, first };
    if (!before) return undefined;
    const added = rows.filter((r) => !before.ids.has(r.id)).map((r) => r.id);
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (added.length > 0) {
      setFresh(new Set(added));
      timers.push(setTimeout(() => setFresh(new Set()), FLASH_MS));
    }
    if (first && first !== before.first) {
      setNewFirst(true);
      setAnnounce(`New number one: ${rows[0]!.nickname}, ${fmtPoints(rows[0]!.score ?? 0)} points.`);
      timers.push(setTimeout(() => setNewFirst(false), NEW_FIRST_MS));
    } else if (added.length > 0) {
      const r = rows.find((x) => x.id === added[0]);
      if (r) setAnnounce(`${r.nickname} joined the top five at number ${r.rank}.`);
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loading]);
  return { fresh, newFirst, announce };
}

/** FLIP: rows that moved glide 300 ms to their new place; new rows slide in 16 px from the right. Off in reduced motion. */
function useFlip(rows: BoardEntry[], reduced: boolean) {
  const ref = useRef<HTMLOListElement>(null);
  const tops = useRef(new Map<string, number>());
  const key = rows.map((r) => r.id).join('|');
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) {
      tops.current = new Map();
      return;
    }
    const next = new Map<string, number>();
    for (const el of Array.from(list.children) as HTMLElement[]) {
      const id = el.dataset.id;
      if (!id) continue;
      const top = el.getBoundingClientRect().top;
      next.set(id, top);
      if (reduced || typeof el.animate !== 'function') continue;
      const was = tops.current.get(id);
      if (was !== undefined && Math.abs(was - top) > 0.5) {
        el.animate([{ transform: `translateY(${was - top}px)` }, { transform: 'none' }], { duration: FLIP_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      } else if (was === undefined && tops.current.size > 0) {
        el.animate([{ transform: 'translateX(16px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: FLIP_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      }
    }
    tops.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduced]);
  return ref;
}
