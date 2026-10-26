// "View Full Leaderboard" (docs/final/UX_FINAL.md §5): a modal (no route — the kiosk flow stays), 60rem × 37.5rem, tabs
// "Top scores" (top 20 v4 finishers: # · Detective · Case · Time · Hints · Score) | "Defeat log" (runs that ended early,
// never ranked, with the monster that ended them). role=dialog + focus trap; Esc / Close closes and focus returns to
// the control that opened it; ←/→ switch tabs. Registers as a modal so the home's Enter-to-start hotkey pauses.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useModalPresence } from '../../../app/keyboard.ts';
import { CASES } from '../../../mystery/data/cases.ts';
import type { CaseId } from '../../../mystery/types.ts';
import { Icon } from '../../Icon.tsx';
import { characterArt, pokemonArt } from '../duoView.ts';
import { ENEMY_SHORT, EnemyGlyph } from './EnemyGlyph.tsx';
import { fmtClock, fmtPoints, FULL_TOP_N, type BoardEntry, type HomeBoardSnapshot } from './model.ts';

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
export type BoardTab = 'top' | 'defeats';

/** Focus trap (pure): the element Tab / Shift+Tab must wrap to, or null to let the browser move focus. */
export function trapTarget<T>(items: readonly T[], active: T | null, shift: boolean): T | null {
  if (items.length === 0) return null;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (shift && active === first) return last;
  if (!shift && active === last) return first;
  if (active === null || !items.includes(active)) return first;
  return null;
}

/** Tablist keys (pure): ←/→ toggle, Home / End jump; other keys → null. */
export function nextTab(tab: BoardTab, key: string): BoardTab | null {
  if (key === 'Home') return 'top';
  if (key === 'End') return 'defeats';
  if (key === 'ArrowLeft' || key === 'ArrowRight') return tab === 'top' ? 'defeats' : 'top';
  return null;
}

const caseText = (id: CaseId | null) => (id ? `${CASES[id].number} · ${CASES[id].title}` : '—');

export function LeaderboardModal({ snap, onClose, initialTab = 'top' }: { snap: HomeBoardSnapshot | null; onClose: () => void; initialTab?: BoardTab }) {
  useModalPresence(true);
  const titleId = useId();
  const tabIds = { top: useId(), defeats: useId() };
  const panelId = useId();
  const [tab, setTab] = useState<BoardTab>(initialTab);
  const panel = useRef<HTMLDivElement>(null);
  const tabRefs = { top: useRef<HTMLButtonElement>(null), defeats: useRef<HTMLButtonElement>(null) };

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    tabRefs[initialTab].current?.focus();
    return () => trigger?.focus?.({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const target = trapTarget(items, document.activeElement as HTMLElement | null, e.shiftKey);
    if (target) {
      e.preventDefault();
      target.focus();
    }
  };

  const onTabKey = (e: KeyboardEvent) => {
    const next = nextTab(tab, e.key);
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs[next].current?.focus();
  };

  const top = (snap?.top ?? []).slice(0, FULL_TOP_N);
  const defeats = snap?.defeats ?? [];
  const live = snap?.source === 'live';

  return (
    <div className="lb-modal-scrim" onKeyDown={onKeyDown} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className="panel lb-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="board-modal">
        <header className="lb-modal__head">
          <div>
            <p className="home-board__kicker">{live ? 'TONIGHT · VERIFIED · v4' : 'THIS LAPTOP · NOT VERIFIED'}</p>
            <h2 id={titleId} className="lb-modal__title display">Leaderboard</h2>
          </div>
          <div className="lb-tabs" role="tablist" aria-label="Leaderboard views">
            {(['top', 'defeats'] as const).map((t) => (
              <button
                key={t} ref={tabRefs[t]} id={tabIds[t]} type="button" role="tab" className={`lb-tab${tab === t ? ' is-on' : ''}`}
                aria-selected={tab === t} aria-controls={panelId} tabIndex={tab === t ? 0 : -1}
                onClick={() => setTab(t)} onKeyDown={onTabKey} data-testid={`board-tab-${t}`}
              >
                <Icon name={t === 'top' ? 'trophy' : 'skull'} />
                {t === 'top' ? 'Top scores' : 'Defeat log'}
                <span className="lb-tab__n num">{t === 'top' ? top.length : defeats.length}</span>
              </button>
            ))}
          </div>
          <button type="button" className="icon-btn" aria-label="Close leaderboard" title="Close (Esc)" onClick={onClose} data-testid="board-close">
            <Icon name="close" />
          </button>
        </header>

        <div id={panelId} role="tabpanel" aria-labelledby={tabIds[tab]} className="lb-modal__body" data-testid={`board-panel-${tab}`}>
          {tab === 'top' ? <TopTable rows={top} /> : <DefeatTable rows={defeats} />}
        </div>
        <p className="lb-modal__foot">
          {live ? 'Verified by the case server · mystery-v4 only (older scores never mix).' : 'This laptop only · not verified · mystery-v4 only.'}
          {' '}Every finisher ranks above every defeat.
        </p>
      </div>
    </div>
  );
}

function Who({ e }: { e: BoardEntry }) {
  return (
    <span className="lb-who">
      {e.duo && (
        <span className="hb-row__duo" aria-hidden="true">
          <img src={characterArt(e.duo.characterId)} alt="" width={28} height={28} loading="lazy" decoding="async" />
          <img src={pokemonArt(e.duo.pokemonId)} alt="" width={28} height={28} loading="lazy" decoding="async" />
        </span>
      )}
      <span className="lb-who__name" title={e.nickname}>{e.nickname}</span>
    </span>
  );
}

function TopTable({ rows }: { rows: BoardEntry[] }) {
  if (rows.length === 0) {
    return (
      <div className="home-board__empty lb-modal__empty" data-testid="board-top-empty">
        <Icon name="trophy" className="home-board__empty-icon" />
        <p className="home-board__empty-1">No detectives on the board yet.</p>
        <p className="home-board__empty-2">Solve a case to claim #1.</p>
      </div>
    );
  }
  return (
    <table className="lb-table" data-testid="board-top-table">
      <colgroup><col className="c-rank" /><col className="c-who" /><col className="c-case" /><col className="c-time" /><col className="c-hints" /><col className="c-score" /></colgroup>
      <thead><tr><th scope="col">#</th><th scope="col">Detective</th><th scope="col">Case</th><th scope="col" className="r">Time</th><th scope="col" className="r">Hints</th><th scope="col" className="r">Score</th></tr></thead>
      <tbody>
        {rows.map((e) => (
          <tr key={e.id} className={e.rank === 1 ? 'is-first' : undefined} data-testid="board-top-row">
            <td className="lb-table__rank num">{e.rank === 1 && <Icon name="trophy" className="hb-row__trophy" />}{e.rank}</td>
            <td><Who e={e} /></td>
            <td className="lb-table__case" title={caseText(e.caseId)}>{caseText(e.caseId)}</td>
            <td className="r num">{fmtClock(e.activeTimeS)}</td>
            <td className="r num">{e.hintsUsed ?? '—'}</td>
            <td className="r num lb-table__score">{fmtPoints(e.score ?? 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DefeatTable({ rows }: { rows: BoardEntry[] }) {
  return (
    <>
      <p className="lb-modal__lead" data-testid="board-defeat-lead"><Icon name="skull" />Runs that ended early. Never ranked.</p>
      {rows.length === 0 ? (
        <p className="lb-modal__none text-2" data-testid="board-defeat-empty">No runs have ended early tonight.</p>
      ) : (
        <table className="lb-table lb-table--defeat" data-testid="board-defeat-table">
          <colgroup><col className="c-who" /><col className="c-case" /><col className="c-by" /><col className="c-time" /><col className="c-hints" /></colgroup>
          <thead><tr><th scope="col">Detective</th><th scope="col">Case</th><th scope="col">Defeated by</th><th scope="col" className="r">Lasted</th><th scope="col" className="r">Clues</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} data-testid="board-defeat-row">
                <td><Who e={e} /></td>
                <td className="lb-table__case" title={caseText(e.caseId)}>{caseText(e.caseId)}</td>
                <td>
                  {e.defeatedBy ? (
                    <span className={`lb-by lb-by--${e.defeatedBy}`}><EnemyGlyph enemy={e.defeatedBy} />{ENEMY_SHORT[e.defeatedBy]}</span>
                  ) : <span className="text-2">—</span>}
                </td>
                <td className="r num">{fmtClock(e.activeTimeS)}</td>
                <td className="r num">{e.cluesFound === null ? '—' : `${Math.min(3, e.cluesFound)}/3`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
