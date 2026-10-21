// Kiosk display/audio preferences, persisted per browser and mirrored as classes on <html>.
import { useSyncExternalStore } from 'react';

export interface Settings {
  muted: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  lowGraphics: boolean;
}

const KEY = 'raven-regatta:settings:v1';

function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function load(): Settings {
  const defaults: Settings = { muted: false, reducedMotion: prefersReducedMotion(), highContrast: false, lowGraphics: false };
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
