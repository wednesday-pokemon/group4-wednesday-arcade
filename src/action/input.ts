// Keyboard input for real-time play. Tracks held keys (keydown/keyup), counts SPACE strokes only on genuine
// presses (browser key-repeat is ignored), and exposes one-frame edges for E/Q. Safe to attach/detach repeatedly.
import type { InputSnapshot } from './types.ts';

export interface KeyLike { code: string; repeat: boolean; preventDefault?: () => void; target?: unknown }

const HELD_CODES: Record<string, keyof Pick<InputSnapshot, 'forward' | 'left' | 'right' | 'brake'>> = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyS: 'brake', ArrowDown: 'brake',
};
const SWALLOWED = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export interface InputCallbacks {
  onPause?: () => void;
  onMute?: () => void;
  onToggleHoldRow?: () => void;
}

function isTypingTarget(target: unknown): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || !!el.isContentEditable);
}

export class InputController {
  private held = { forward: false, left: false, right: false, brake: false };
  private spaceDown = false;
  private pendingStrokes = 0;
  private interactEdge = false;
  private abilityEdge = false;
  private attachedTo: Window | null = null;
  holdToRow = false;

  constructor(private readonly callbacks: InputCallbacks = {}) {}

  attach(target: Window = window): void {
    if (this.attachedTo) return;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
    this.attachedTo = target;
  }

  detach(): void {
    if (!this.attachedTo) return;
    this.attachedTo.removeEventListener('keydown', this.onKeyDown);
    this.attachedTo.removeEventListener('keyup', this.onKeyUp);
    this.attachedTo.removeEventListener('blur', this.onBlur);
    this.attachedTo = null;
    this.reset();
  }

  reset(): void {
    this.held = { forward: false, left: false, right: false, brake: false };
    this.spaceDown = false;
    this.pendingStrokes = 0;
    this.interactEdge = false;
    this.abilityEdge = false;
  }

  /** Returns everything since the previous call and clears the one-frame edges. */
  consume(): InputSnapshot {
    const snapshot: InputSnapshot = {
      ...this.held,
      interact: this.interactEdge,
      ability: this.abilityEdge,
      strokes: this.pendingStrokes,
      holdRow: this.holdToRow && this.spaceDown,
    };
    this.pendingStrokes = 0;
    this.interactEdge = false;
    this.abilityEdge = false;
    return snapshot;
  }

  readonly onKeyDown = (e: KeyLike): void => {
    if (isTypingTarget(e.target)) return;
    if (SWALLOWED.has(e.code)) e.preventDefault?.();
    const held = HELD_CODES[e.code];
    if (held) {
      this.held[held] = true;
      return;
    }
    if (e.repeat) return; // key-repeat never counts as a new action
    switch (e.code) {
      case 'Space':
        this.spaceDown = true;
        if (!this.holdToRow) this.pendingStrokes++;
        break;
      case 'KeyE':
        this.interactEdge = true;
        break;
      case 'KeyQ':
        this.abilityEdge = true;
        break;
      case 'Escape':
      case 'KeyP':
        this.callbacks.onPause?.();
        break;
      case 'KeyM':
        this.callbacks.onMute?.();
        break;
      case 'KeyH':
        this.holdToRow = !this.holdToRow;
        this.callbacks.onToggleHoldRow?.();
        break;
    }
  };

  readonly onKeyUp = (e: KeyLike): void => {
    const held = HELD_CODES[e.code];
    if (held) this.held[held] = false;
    if (e.code === 'Space') this.spaceDown = false;
  };

  private readonly onBlur = (): void => {
    this.reset();
  };
}
