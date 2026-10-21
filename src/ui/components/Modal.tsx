// Modal / Confirm (UX_SPEC §4): role=dialog, focus trap, Esc cancels, focus returns to the trigger,
// destructive confirms focus Cancel first. Optional typed confirmation ("RESET").
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useModalPresence } from '../../app/keyboard.ts';
import { Button } from './Button.tsx';

interface ModalProps {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  testId?: string;
  /** Element to focus first; defaults to the first focusable element. */
  initialFocus?: React.RefObject<HTMLElement | null>;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function Modal({ title, description, onClose, children, testId, initialFocus }: ModalProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useModalPresence(true);

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const first = initialFocus?.current ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => trigger?.focus?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    if (e.shiftKey && document.activeElement === firstEl) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && document.activeElement === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  };

  return (
    <div className="modal-scrim" onKeyDown={onKeyDown}>
      <div
        ref={panelRef}
        className="panel modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        data-testid={testId}
      >
        <h2 id={titleId} className="modal__title display">{title}</h2>
        {description && <div id={descId} className="modal__desc">{description}</div>}
        {children}
      </div>
    </div>
  );
}

interface ConfirmProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
  /** When set, the confirm button stays aria-disabled until this exact text is typed. */
  typeToConfirm?: string;
  testId?: string;
}

export function ConfirmDialog({
  title, description, confirmLabel, cancelLabel, onConfirm, onCancel, destructive, typeToConfirm, testId,
}: ConfirmProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState('');
  const reasonId = useId();
  const locked = typeToConfirm !== undefined && typed.trim() !== typeToConfirm;
  return (
    <Modal title={title} description={description} onClose={onCancel} testId={testId} initialFocus={destructive ? cancelRef : confirmRef}>
      {typeToConfirm && (
        <label className="field">
          <span className="field__label">Type {typeToConfirm} to confirm</span>
          <input
            className="input input--sm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            data-testid="confirm-type"
          />
        </label>
      )}
      <div className="modal__actions">
        <Button ref={cancelRef} variant="ghost" onClick={onCancel} data-testid="confirm-cancel">{cancelLabel}</Button>
        <Button
          ref={confirmRef}
          variant={destructive ? 'danger' : 'primary'}
          inactive={locked}
          inactiveReason={locked ? `Type ${typeToConfirm} first` : null}
          aria-describedby={locked ? reasonId : undefined}
          onClick={onConfirm}
          data-testid="confirm-ok"
        >
          {confirmLabel}
        </Button>
      </div>
      {locked && <p id={reasonId} className="reason">Type {typeToConfirm} to enable this button.</p>}
    </Modal>
  );
}
