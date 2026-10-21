// Keyboard plumbing (UX_SPEC §5): screen-level hotkeys, the 500 ms post-mount Enter/Space guard,
// modal awareness and focus-to-h1 on every screen change.
import { useEffect, useRef, type RefObject } from 'react';

const MOUNT_GUARD_MS = 500;
let screenMountedAt = 0;
let modalDepth = 0;

export function isModalOpen(): boolean {
  return modalDepth > 0;
}

export function useModalPresence(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    modalDepth++;
    return () => {
      modalDepth--;
    };
  }, [open]);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Install once: swallows Enter/Space for 500 ms after a screen mounts so held keys never skip a screen. */
export function installMountGuard(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && performance.now() - screenMountedAt < MOUNT_GUARD_MS) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    { capture: true },
  );
}

export function markScreenMounted(): void {
  screenMountedAt = performance.now();
}

/**
 * Screen hotkeys. `handler` receives the lower-cased key and returns true when it handled it.
 * Ignored in inputs, while a modal is open, with Ctrl/Alt/Meta held, and on key repeat.
 */
export function useHotkeys(handler: (key: string, e: KeyboardEvent) => boolean | void, enabled = true): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      if (isModalOpen() || isTypingTarget(e.target)) return;
      if (ref.current(e.key.toLowerCase(), e) === true) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** Focus the initial control (or the screen's h1) when a screen mounts; arms the Enter/Space guard. */
export function useScreenFocus(heading: RefObject<HTMLElement | null>, initial?: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    markScreenMounted();
    (initial?.current ?? heading.current)?.focus({ preventScroll: true });
    // Mount-only by design: later re-renders must not steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** True when Enter should trigger the screen's primary action (focus is not on another control). */
export function focusIsNeutral(primary?: HTMLElement | null): boolean {
  const el = document.activeElement;
  if (!el || el === document.body || el.tagName === 'H1' || el.tagName === 'H2') return true;
  return primary ? el === primary : false;
}
