// Kiosk display/audio preferences, persisted per browser and mirrored as classes on <html>.
import { useSyncExternalStore } from 'react';

export interface Settings {
  muted: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  lowGraphics: boolean;
  /** Mystery look sensitivity 1–10 (5 = default; UX_MYSTERY §7). */
  lookSensitivity: number;
  invertY: boolean;
  /** Crouch key toggles (default, UX ruling) instead of hold. */
  crouchToggle: boolean;
  /** Captions are always on (UX §7); only their size is a choice. */
  captionSize: 'normal' | 'large';
  /** Show the HUD risk estimate chip (Phase 4). */
  showRisk: boolean;
  /** Reduced motion follows the system unless forced. */
  motionPref: 'system' | 'on' | 'off';
}

const KEY = 'raven-regatta:settings:v1';

/** Per-visitor preferences, reset on "New investigation" (UX_MYSTERY §7). */
export const VISITOR_DEFAULTS = { lookSensitivity: 5, invertY: false, crouchToggle: true, captionSize: 'normal', showRisk: true } as const satisfies Partial<Settings>;

function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function load(): Settings {
  const defaults: Settings = {
    muted: false, reducedMotion: prefersReducedMotion(), highContrast: false, lowGraphics: false,
    ...VISITOR_DEFAULTS, motionPref: 'system',
  };
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) } : defaults;
  } catch {
    return defaults;
  }
}

let current: Settings = load();
const listeners = new Set<() => void>();

function applyClasses(s: Settings): void {
  const root = document.documentElement.classList;
  root.toggle('captions-large', s.captionSize === 'large');
  root.toggle('reduced-motion', s.reducedMotion);
  root.toggle('high-contrast', s.highContrast);
  root.toggle('low-graphics', s.lowGraphics);
}
applyClasses(current);

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // ignore
  }
  applyClasses(current);
  listeners.forEach((l) => l());
}

/** Reduced-motion choice: System follows prefers-reduced-motion; On/Off force it. */
export function setMotionPref(pref: Settings['motionPref']): void {
  updateSettings({ motionPref: pref, reducedMotion: pref === 'system' ? prefersReducedMotion() : pref === 'on' });
}

/** "New investigation": the next visitor starts from the kiosk defaults for look / crouch / captions / risk chip. */
export function resetVisitorSettings(): void {
  updateSettings({ ...VISITOR_DEFAULTS });
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await document.documentElement.requestFullscreen();
    // Keep Esc for in-app modals instead of exiting fullscreen (Chromium only).
    const kb = (navigator as Navigator & { keyboard?: { lock?: (keys: string[]) => Promise<void> } }).keyboard;
    await kb?.lock?.(['Escape']).catch(() => undefined);
  } catch {
    // Fullscreen refused (e.g. iframe); the game still works windowed.
  }
}
