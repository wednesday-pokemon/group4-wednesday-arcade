// Kiosk fullscreen + keyboard lock (UX_MYSTERY ruling 1). The Home "Open the case" click requests element fullscreen
// and then navigator.keyboard.lock(); only once that lock has resolved (and we are still fullscreen) may Ctrl crouch —
// otherwise Ctrl is ignored, because Ctrl+W would close the tab. C always crouches.

type KeyboardLockApi = { lock?: (codes?: string[]) => Promise<void>; unlock?: () => void };

/** Keys whose browser meaning we suppress while locked (Ctrl+W, Tab, Esc-exits-fullscreen, …). */
export const LOCK_CODES = [
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyR', 'KeyF', 'KeyE', 'KeyC', 'KeyV', 'KeyX', 'KeyM', 'Tab', 'Escape', 'Space',
  'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
];

let locked = false;
let listening = false;

function keyboardApi(): KeyboardLockApi | undefined {
  return (navigator as Navigator & { keyboard?: KeyboardLockApi }).keyboard;
}

function watchFullscreen(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      locked = false;
      keyboardApi()?.unlock?.();
    }
  });
}

/** Call from a user gesture (Home CTA). Never throws; the game works windowed with C to crouch. */
export async function openCaseFullscreen(): Promise<{ fullscreen: boolean; keyboardLocked: boolean }> {
  watchFullscreen();
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  } catch {
    return { fullscreen: false, keyboardLocked: false };
  }
  try {
    const kb = keyboardApi();
    if (kb?.lock) {
      await kb.lock(LOCK_CODES);
      locked = true;
    }
  } catch {
    locked = false;
  }
  return { fullscreen: !!document.fullscreenElement, keyboardLocked: locked };
}

/** True only while the keyboard lock is active in fullscreen: Ctrl may crouch. */
export function ctrlCrouchEnabled(): boolean {
  return locked && typeof document !== 'undefined' && !!document.fullscreenElement;
}
