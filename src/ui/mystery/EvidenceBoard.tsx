// Evidence board (UX_MYSTERY §5, docs/MYSTERY_CASES.md). Review mode (Tab during play; the sim is paused): read-only,
// Tab/Esc close it. Accusation mode (auto-opened after the deposit at Iago Tower): a focus trap — Tab cycles inside the
// board, Esc does nothing — in three steps: 1 choose a suspect (radiogroup) or leave the case unsolved; 2 cite the
// evidence that supports the accusation (found clues + the case-file notes, at least one); 3 confirm once.
// SECRECY: the board shows only public case data. No "points to / explains" links, no culprit, no hint which clue
// matters: suspects are styled identically and a clue's "Names:" line just lists who its text mentions.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { citableEvidence, sanitizeEvidence } from '../../mystery/caseLogic.ts';
import type { Accusation, CaseDef, ClueDef, ClueId, RoomId, SuspectDef, SuspectId } from '../../mystery/types.ts';
import { useModalPresence } from '../../app/keyboard.ts';
import { Button } from '../components/Button.tsx';
import { Icon } from '../Icon.tsx';

interface EvidenceBoardProps {
  caseDef: CaseDef;
  cluesFound: readonly ClueId[];
  /** Fallback room label for a clue without a `location`. */
  roomName: (id: RoomId) => string;
  mode: 'review' | 'accuse';
  onClose: () => void;
  /** suspectId null = leave the case unsolved (evidence is then empty). Called exactly once. */
  onAccuse: (a: Accusation) => void;
}

const ENTER_GUARD_MS = 500;
const FOCUSABLE = 'button:not([disabled]), [role="radio"][tabindex="0"], input:not([disabled])';

export type AccuseStep = 'suspect' | 'evidence';

export interface EvidenceOption { id: string; kind: 'clue' | 'note'; title: string }

/** The checklist for step 2: found clues (case order) then the two case-file notes (pure; unit-tested). */
export function evidenceOptions(caseDef: CaseDef, cluesFound: readonly ClueId[]): EvidenceOption[] {
  return citableEvidence(caseDef, cluesFound).map((id) => {
    const clue = caseDef.clues.find((c) => c.id === id);
    if (clue) return { id, kind: 'clue', title: clue.title };
    const note = caseDef.notes.find((n) => n.id === id);
    return { id, kind: 'note', title: note?.title ?? id };
  });
}

/** The board's footnote already says jobs are invented for this story, so the per-role suffix is dropped (pure). */
export function shortRole(role: string): string {
  return role.replace(/\s*\(role in this story\)\s*$/i, '');
}

/** Names mentioned in a clue's text, in suspect order (neutral; pure). */
export function mentionedNames(caseDef: CaseDef, clue: ClueDef): string[] {
  return caseDef.suspects.filter((s) => clue.mentions.includes(s.id)).map((s) => s.name);
}

export function EvidenceBoard({ caseDef, cluesFound, roomName, mode, onClose, onAccuse }: EvidenceBoardProps) {
  useModalPresence(true);
  const root = useRef<HTMLElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const [choice, setChoice] = useState<SuspectId | null>(null);
  const [step, setStep] = useState<AccuseStep>('suspect');
  const [cited, setCited] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<'accuse' | 'unsolved' | null>(null);
  const [done, setDone] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const openConfirm = (kind: 'accuse' | 'unsolved') => {
    opener.current = document.activeElement as HTMLElement | null;
    setConfirm(kind);
  };
  const closeConfirm = () => {
    setConfirm(null);
    requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }));
  };
  const accuse = mode === 'accuse';
  const found = cluesFound;
  const options = evidenceOptions(caseDef, found);
  const nameOf = (id: SuspectId) => caseDef.suspects.find((s) => s.id === id)?.name ?? id;

  useEffect(() => {
    (accuse ? root.current?.querySelector<HTMLElement>('[role="radio"]') : first.current)?.focus({ preventScroll: true });
  }, [accuse]);
  // Step changes move focus to the step's first control (never lost to <body>).
  const stepMounted = useRef(false);
  useEffect(() => {
    if (!stepMounted.current) {
      stepMounted.current = true;
      return;
    }
    const sel = step === 'evidence' ? '.evidence-check input' : '[role="radio"][tabindex="0"]';
    root.current?.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true });
  }, [step]);

  // Focus trap in accusation mode (UX ruling 3): Tab cycles inside the board (or inside the open confirm dialog).
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!accuse || e.key !== 'Tab') return;
    const scope = root.current?.querySelector<HTMLElement>('.board__confirm') ?? root.current;
    const items = [...(scope?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
    items[next]?.focus();
  };

  const toggle = (id: string) => setCited((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const evidence = sanitizeEvidence(caseDef, found, cited);
  const commit = () => {
    if (done) return;
    setDone(true);
    onAccuse(confirm === 'unsolved' || choice === null ? { suspectId: null, evidence: [] } : { suspectId: choice, evidence });
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
      data-case={caseDef.id}
      onKeyDown={onKeyDown}
    >
      <header className="board__head">
        <div className="board__heading">
          <p className="board__case caps">Case {caseDef.number} · {caseDef.title}</p>
          <h2 id="board-title" className="board__title">Evidence Board</h2>
        </div>
        <div className="board__meta">
          <p className="board__sub text-2">Victim: {caseDef.victim} · {found.length} of {caseDef.clues.length} clues found</p>
          {!accuse && <Button ref={first} variant="secondary" kbd="Tab" onClick={onClose} data-testid="btn-board-close">Close</Button>}
        </div>
      </header>

      <section className="board__section" aria-labelledby="board-suspects">
        <h3 id="board-suspects" className="board__label caps">Suspects and their statements</h3>
        <ul className="board__suspects">
          {caseDef.suspects.map((s) => <SuspectCard key={s.id} s={s} />)}
        </ul>
      </section>

      <section className="board__section" aria-labelledby="board-evidence">
        <h3 id="board-evidence" className="board__label caps">Evidence</h3>
        <ul className="board__clues">
          {caseDef.clues.map((c, i) => (
            <ClueCard key={c.id} c={c} index={i} found={found.includes(c.id)} location={c.location || roomName(c.roomId)} names={mentionedNames(caseDef, c)} />
          ))}
        </ul>
      </section>

      <section className="board__section" aria-labelledby="board-notes">
        <h3 id="board-notes" className="board__label caps">Case-file notes</h3>
        <ul className="board__notes">
          {caseDef.notes.map((n) => (
            <li key={n.id} className="note" data-testid={`note-${n.id}`}>
              <p className="note__title"><Icon name="fileText" /> {n.title}</p>
              <p className="note__text">{n.text}</p>
            </li>
          ))}
        </ul>
      </section>

      {accuse ? (
        <footer className="accuse-panel" data-testid="accuse-panel" data-step={step}>
          {step === 'suspect' ? (
            <>
              <p className="accuse-panel__q display" id="accuse-q">
                <span className="accuse-panel__step caps">Step 1 of 2</span> Who is responsible for {caseDef.victim}’s death?
              </p>
              <SuspectRadios suspects={caseDef.suspects} value={choice} onChange={setChoice} disabled={done} />
              <div className="accuse-panel__actions">
                <Button
                  variant="primary"
                  inactive={choice === null || done}
                  inactiveReason="Choose a suspect first."
                  onClick={() => choice && setStep('evidence')}
                  data-testid="btn-accuse"
                >
                  {choice ? `Accuse ${nameOf(choice)}…` : 'Accuse…'}
                </Button>
                <Button variant="ghost" inactive={done} onClick={() => openConfirm('unsolved')} data-testid="btn-leave-unsolved">Leave the case unsolved</Button>
              </div>
            </>
          ) : (
            <>
              <fieldset className="evidence-step" aria-describedby="evidence-reason" disabled={done}>
                <legend className="accuse-panel__q display">
                  <span className="accuse-panel__step caps">Step 2 of 2</span> Which evidence supports accusing {choice ? nameOf(choice) : ''}?
                </legend>
                <ul className="evidence-checks">
                  {options.map((o) => (
                    <li key={o.id}>
                      <label className="evidence-check" data-kind={o.kind}>
                        <input type="checkbox" checked={cited.includes(o.id)} onChange={() => toggle(o.id)} data-testid={`evidence-option-${o.id}`} />
                        <span className="evidence-check__box" aria-hidden="true"><Icon name="check" /></span>
                        <span className="evidence-check__title">{o.title}</span>
                        <span className="evidence-check__kind">{o.kind === 'clue' ? 'Clue' : 'Case-file note'}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
              <div className="accuse-panel__actions">
                <p id="evidence-reason" className="accuse-panel__reason text-2">
                  {evidence.length === 0 ? 'Cite at least one piece of evidence.' : `${evidence.length} cited.`}
                </p>
                <Button variant="ghost" inactive={done} onClick={() => setStep('suspect')} data-testid="btn-accuse-back">Change suspect</Button>
                <Button
                  variant="primary"
                  inactive={evidence.length === 0 || done}
                  inactiveReason="Cite at least one piece of evidence."
                  aria-describedby="evidence-reason"
                  onClick={() => evidence.length > 0 && openConfirm('accuse')}
                  data-testid="btn-accuse-next"
                >
                  Continue
                </Button>
              </div>
            </>
          )}
        </footer>
      ) : (
        <footer className="accuse-panel accuse-panel--locked">
          <Button variant="secondary" inactive inactiveReason="Deliver the egg first, then name the culprit." aria-describedby="accuse-locked-reason">Accuse at Iago Tower</Button>
          <p id="accuse-locked-reason" className="text-2">Deliver the egg first, then name the culprit and cite your evidence.</p>
        </footer>
      )}
      <p className="board__note">Jobs and events are invented for this game’s story.</p>

      {confirm !== null && !done && (
        <AccuseConfirm
          title={confirm === 'unsolved' ? 'Leave the case unsolved?' : `Accuse ${choice ? nameOf(choice) : ''}?`}
          body={confirm === 'unsolved'
            ? 'Your egg still counts. The mystery stays open. You can decide only once.'
            : `Citing ${evidence.length} piece${evidence.length === 1 ? '' : 's'} of evidence · ${found.length} of ${caseDef.clues.length} clues found. You can accuse only once.`}
          cited={confirm === 'accuse' ? options.filter((o) => evidence.includes(o.id)).map((o) => o.title) : []}
          confirmLabel={confirm === 'unsolved' ? 'Leave it unsolved' : 'Accuse'}
          onConfirm={commit}
          onReview={closeConfirm}
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
    <div className="suspect-radios" role="radiogroup" aria-labelledby="accuse-q">
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

function AccuseConfirm({ title, body, cited, confirmLabel, onConfirm, onReview }: {
  title: string; body: string; cited: string[]; confirmLabel: string; onConfirm: () => void; onReview: () => void;
}) {
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
        {cited.length > 0 && (
          <ul className="board__confirm-cited" aria-label="Evidence you cite">
            {cited.map((t) => <li key={t}><Icon name="check" /> {t}</li>)}
          </ul>
        )}
        <div className="button-row">
          <Button variant="primary" onClick={onConfirm} data-testid="btn-accuse-confirm">{confirmLabel}</Button>
          <Button ref={review} variant="ghost" onClick={onReview} data-testid="btn-accuse-review">Review evidence</Button>
        </div>
      </div>
    </div>
  );
}

function SuspectCard({ s }: { s: SuspectDef }) {
  return (
    <li className="suspect" data-testid={`suspect-${s.id}`}>
      <span className="suspect__cameo" aria-hidden="true">{s.name.slice(0, 1)}</span>
      <div className="suspect__body">
        <p className="suspect__name">{s.name}</p>
        <p className="suspect__role">{shortRole(s.role)}</p>
        <p className="suspect__context"><span className="suspect__label">Statement</span> {s.alibiOrContext}</p>
      </div>
    </li>
  );
}

function ClueCard({ c, index, found, location, names }: { c: ClueDef; index: number; found: boolean; location: string; names: string[] }) {
  if (!found) {
    return (
      <li className="clue clue--locked" data-testid={`clue-${c.id}`} data-found="false">
        <Icon name="lock" />
        <p className="clue__locked">Evidence {index + 1} — not found yet</p>
        <p className="text-2">Location: {location}</p>
      </li>
    );
  }
  return (
    <li className="clue clue--found" data-testid={`clue-${c.id}`} data-found="true">
      <p className="clue__head"><Icon name={c.icon} /> <span className="clue__title">{c.title}</span> <span className="clue__room">{location}</span></p>
      <p className="clue__text">{c.text}</p>
      <p className="clue__deduction"><em>Deduction:</em> {c.deduction}</p>
      {names.length > 0 && <p className="clue__names">Names: {names.join(', ')}</p>}
    </li>
  );
}
