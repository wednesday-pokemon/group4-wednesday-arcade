// develop-web-game test hooks: window.render_game_to_text() and window.advanceTime(ms).
import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => void;
  }
}

/** Registers the hooks once; the latest snapshot/advance functions are read through refs. */
export function useTestHooks(snapshot: () => unknown, advance: (ms: number) => void): void {
  const snapRef = useRef(snapshot);
  const advRef = useRef(advance);
  snapRef.current = snapshot;
  advRef.current = advance;
  useEffect(() => {
    window.render_game_to_text = () => JSON.stringify(snapRef.current());
    window.advanceTime = (ms: number) => advRef.current(ms);
    return () => {
      delete window.render_game_to_text;
      delete window.advanceTime;
    };
  }, []);
}
