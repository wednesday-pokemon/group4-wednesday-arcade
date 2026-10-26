// Screen-reader announcements through the persistent live regions rendered by the app shell (UX_SPEC §5).
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function write(id: 'sr-polite' | 'sr-alert', text: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  // Clear first so repeating the same sentence is announced again.
  el.textContent = '';
  window.setTimeout(() => {
    el.textContent = text;
  }, 30);
}

export function announce(text: string, kind: 'polite' | 'alert' = 'polite'): void {
  write(kind === 'alert' ? 'sr-alert' : 'sr-polite', text);
}

/** Selection changes are debounced by 400 ms so arrow-key browsing does not flood the reader. */
export function announceSelection(text: string): void {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => write('sr-polite', text), 400);
}

export function LiveRegions() {
  return (
    <>
      <div id="sr-polite" className="sr-only" aria-live="polite" aria-atomic="true" />
      <div id="sr-alert" className="sr-only" role="alert" aria-atomic="true" />
    </>
  );
}
