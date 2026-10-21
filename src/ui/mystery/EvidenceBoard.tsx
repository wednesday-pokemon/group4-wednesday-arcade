// Evidence board (UX_MYSTERY §5). Review mode (Tab during play; the sim is paused): read-only, Tab/Esc close it.
// Accusation mode (auto-opened after the deposit at Iago Tower): a focus trap — Tab moves between controls, nothing
// closes the board — with a radiogroup of suspects, "Accuse {name}" and "Leave the case unsolved", each confirmed once.
// Links come ONLY from clues the player has found; locked clues show only where to search; nothing names the culprit.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { CaseDef, ClueDef, ClueId, RoomId, SuspectDef, SuspectId } from '../../mystery/types.ts';
import { useModalPresence } from '../../app/keyboard.ts';
import { CLUE_ICON } from '../../app/mystery/hudModel.ts';
import { Button } from '../components/Button.tsx';
import { Icon } from '../Icon.tsx';

interface EvidenceBoardProps {
  caseDef: CaseDef;
  cluesFound: readonly ClueId[];
  roomName: (id: RoomId) => string;
  mode: 'review' | 'accuse';
  onClose: () => void;
  /** null = leave the case unsolved. */
  onAccuse: (s: SuspectId | null) => void;
}

const ENTER_GUARD_MS = 500;

export interface SuspectLinks { points: ClueDef[]; explains: ClueDef[]; contradiction: boolean }

/** Evidence → suspect links derived only from FOUND clues (pure; unit-tested). */
export function linksFor(caseDef: CaseDef, found: readonly ClueId[], s: SuspectId): SuspectLinks {
  const fc = caseDef.clues.filter((c) => found.includes(c.id));
  const points = fc.filter((c) => c.implicates.includes(s));
  const explains = fc.filter((c) => c.exonerates.includes(s));
  return { points, explains, contradiction: points.length > 0 && explains.length > 0 };
}

export function EvidenceBoard({ caseDef, cluesFound, roomName, mode, onClose, onAccuse }: EvidenceBoardProps) {
  useModalPresence(true);
  const root = useRef<HTMLElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const [choice, setChoice] = useState<SuspectId | null>(null);
  const [confirm, setConfirm] = useState<SuspectId | 'unsolved' | null>(null);
  const [done, setDone] = useState(false);
  const accuse = mode === 'accuse';
  useEffect(() => {
    (accuse ? root.current?.querySelector<HTMLElement>('[role="radio"]') : first.current)?.focus({ preventScroll: true });
  }, [accuse]);

  const found = cluesFound;
  const nameOf = (id: SuspectId) => caseDef.suspects.find((s) => s.id === id)?.name ?? id;

  // Focus trap in accusation mode (UX ruling 3): Tab cycles inside the board; Esc does nothing.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!accuse || e.key !== 'Tab') return;
    const items = [...(root.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [role="radio"][tabindex="0"]') ?? [])].filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
    items[next]?.focus();
  };

  return (
    <section
      ref={root}
      className={`board board--${mode}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="board-title"
      data-testid="evidence-board"
      data-mode={mode}
      onKeyDown={onKeyDown}
    >
      <header className="board__head">
        <div>
          <h2 id="board-title" className="board__title">Evidence Board</h2>
          <p className="board__sub text-2">{caseDef.victim} · {caseDef.title}</p>
        </div>
        {!accuse && <Button ref={first} variant="secondary" kbd="Tab" onClick={onClose} data-testid="btn-board-close">Close</Button>}
      </header>

      <ul className="board__clues" aria-label="Evidence">
        {caseDef.clues.map((c, i) => (
          <ClueCard key={c.id} c={c} index={i} found={found.includes(c.id)} room={roomName(c.roomId)} nameOf={nameOf} />
        ))}
      </ul>

      <Threads caseDef={caseDef} found={found} />

      <ul className="board__suspects" aria-label="Suspects">
        {caseDef.suspects.map((s) => (
          <SuspectCard key={s.id} s={s} links={linksFor(caseDef, found, s.id)} />
        ))}
      </ul>

      {accuse ? (
        <footer className="accuse-panel" data-testid="accuse-panel">
          <p className="accuse-panel__q display">Who released the Hyde?</p>
          <SuspectRadios suspects={caseDef.suspects} value={choice} onChange={setChoice} disabled={done} />
          <div className="accuse-panel__actions">
            <Button
              variant="primary"
              inactive={choice === null || done}
              inactiveReason="Choose a suspect first."
              onClick={() => choice && setConfirm(choice)}
              data-testid="btn-accuse"
            >
              {choice ? `Accuse ${nameOf(choice)}` : 'Accuse…'}
            </Button>
            <Button variant="ghost" inactive={done} onClick={() => setConfirm('unsolved')} data-testid="btn-leave-unsolved">Leave the case unsolved</Button>
          </div>
        </footer>
      ) : (
        <footer className="accuse-panel accuse-panel--locked">
          <Button variant="secondary" inactive inactiveReason="Deliver the egg first, then name the culprit." aria-describedby="accuse-locked-reason">Accuse at Iago Tower</Button>
          <p id="accuse-locked-reason" className="text-2">Deliver the egg first, then name the culprit.</p>
        </footer>
      )}
      <p className="board__note">Jobs and events are invented for this game’s story.</p>

      {confirm !== null && !done && (
        <AccuseConfirm
          title={confirm === 'unsolved' ? 'Leave the case unsolved?' : `Accuse ${nameOf(confirm)}?`}
          body={confirm === 'unsolved'
            ? 'Your egg still counts. The mystery stays open.'
            : `You found ${found.length} of ${caseDef.clues.length} clues. You can accuse only once.`}
          confirmLabel={confirm === 'unsolved' ? 'Leave it unsolved' : 'Accuse'}
          onConfirm={() => {
            setDone(true);
            onAccuse(confirm === 'unsolved' ? null : confirm);
          }}
          onReview={() => setConfirm(null)}
        />
      )}
    </section>
  );
}

function SuspectRadios({ suspects, value, onChange, disabled }: { suspects: SuspectDef[]; value: SuspectId | null; onChange: (s: SuspectId) => void; disabled: boolean }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(0, suspects.findIndex((s) => s.id === value));
  const move = (d: number) => {
    const n = (idx + d + suspects.length) % suspects.length;
    onChange(suspects[n]!.id);
    refs.current[n]?.focus();
  };
  return (
    <div className="suspect-radios" role="radiogroup" aria-label="Suspects">
      {suspects.map((s, i) => (
        <button
          key={s.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === s.id}
          tabIndex={i === idx ? 0 : -1}
          disabled={disabled}
          className="suspect-radio"
          onClick={() => onChange(s.id)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault();
              move(1);
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault();
              move(-1);
            }
          }}
          data-testid={`radio-${s.id}`}
        >
          <span className="suspect-radio__dot" aria-hidden="true" />
          {s.name}
        </button>
      ))}
    </div>
  );
}

function AccuseConfirm({ title, body, confirmLabel, onConfirm, onReview }: { title: string; body: string; confirmLabel: string; onConfirm: () => void; onReview: () => void }) {
  const review = useRef<HTMLButtonElement>(null);
  const mountedAt = useRef(performance.now());
  useEffect(() => review.current?.focus(), []);
  return (
    <div className="board__confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body" data-testid="accuse-confirm"
      onKeyDownCapture={(e) => {
        // Enter is ignored for 500 ms so a held key never confirms by accident.
        if (e.key === 'Enter' && performance.now() - mountedAt.current < ENTER_GUARD_MS) e.preventDefault();
      }}
    >
      <div className="board__confirm-box panel">
        <h3 id="confirm-title" className="board__confirm-title display">{title}</h3>
        <p id="confirm-body" className="text-2">{body}</p>
        <div className="button-row">
          <Button variant="primary" onClick={onConfirm} data-testid="btn-accuse-confirm">{confirmLabel}</Button>
          <Button ref={review} variant="ghost" onClick={onReview} data-testid="btn-accuse-review">Review evidence</Button>
        </div>
      </div>
    </div>
  );
}

function SuspectCard({ s, links }: { s: SuspectDef; links: SuspectLinks }) {
  return (
    <li className="suspect" data-testid={`suspect-${s.id}`}>
      <span className="suspect__cameo" aria-hidden="true">{s.name.slice(0, 1)}</span>
      <div className="suspect__body">
        <p className="suspect__name">{s.name}</p>
        <p className="suspect__role">{s.role}</p>
        <p className="suspect__context text-2">{s.alibiOrContext}</p>
        <p className="suspect__links">
          {links.points.length > 0 && <span className="pin pin--points"><Icon name="link" /> Linked by: {links.points.map((c) => c.title).join(', ')}</span>}
          {links.explains.length > 0 && <span className="pin pin--explains"><Icon name="check" /> Explained by: {links.explains.map((c) => c.title).join(', ')}</span>}
          {links.points.length + links.explains.length === 0 && <span className="pin pin--none">No evidence linked yet</span>}
        </p>
        {links.contradiction && <p className="suspect__contra"><Icon name="alert" /> Contradiction: one clue points here, another explains it.</p>}
      </div>
    </li>
  );
}

function ClueCard({ c, index, found, room, nameOf }: { c: ClueDef; index: number; found: boolean; room: string; nameOf: (id: SuspectId) => string }) {
  if (!found) {
    return (
      <li className="clue clue--locked" data-testid={`clue-${c.id}`}>
        <Icon name="lock" />
        <p className="clue__locked">Evidence {index + 1} — not found yet</p>
        <p className="text-2">Location: {room}</p>
      </li>
    );
  }
  return (
    <li className="clue clue--found" data-testid={`clue-${c.id}`}>
      <p className="clue__head"><Icon name={CLUE_ICON[c.id]} /> <span className="clue__title">{c.title}</span> <span className="clue__room">{room}</span></p>
      <p className="clue__text">{c.text}</p>
      <p className="clue__deduction"><em>Deduction:</em> {c.deduction}</p>
      <p className="clue__pins">
        {c.implicates.map((s) => <span key={`p${s}`} className="pin pin--points">Points to: {nameOf(s)}</span>)}
        {c.exonerates.map((s) => <span key={`e${s}`} className="pin pin--explains"><Icon name="check" /> Explains: {nameOf(s)}</span>)}
      </p>
    </li>
  );
}

/** Decorative threads from each FOUND clue (column i) to the suspects it links (column j). */
function Threads({ caseDef, found }: { caseDef: CaseDef; found: readonly ClueId[] }) {
  const cx = (i: number) => (i + 0.5) * (300 / 3);
  const lines: { x1: number; x2: number; kind: 'points' | 'explains'; key: string }[] = [];
  caseDef.clues.forEach((c, i) => {
    if (!found.includes(c.id)) return;
    c.implicates.forEach((s) => lines.push({ x1: cx(i), x2: cx(caseDef.suspects.findIndex((x) => x.id === s)), kind: 'points', key: `${c.id}-p-${s}` }));
    c.exonerates.forEach((s) => lines.push({ x1: cx(i), x2: cx(caseDef.suspects.findIndex((x) => x.id === s)), kind: 'explains', key: `${c.id}-e-${s}` }));
  });
  return (
    <svg className="board__threads" viewBox="0 0 300 36" preserveAspectRatio="none" aria-hidden="true">
      {lines.map((l) => <line key={l.key} x1={l.x1} y1={0} x2={l.x2} y2={36} className={`thread thread--${l.kind}`} />)}
    </svg>
  );
}
