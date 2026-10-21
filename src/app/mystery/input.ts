// Keyboard + pointer-lock mouse → MysteryInput (one per sim frame). DOM-free so it is unit-testable: the play loop
// forwards KeyboardEvent.code / movementX/Y here. UX_MYSTERY rulings: WASD move; mouse or arrow keys look (← → 120°/s,
// ↑ ↓ pitch); Shift sprint; C crouch (Ctrl only while the kiosk keyboard lock is active); E interact (+ held for the
// 0.8 s egg set-down); F power; Q move; V hint. Tab/Esc/M are app keys (PlayView).
import type { MysteryInput } from '../../mystery/types.ts';

export interface LookPrefs {
  /** 1 … 10, 5 = default. */
  sensitivity: number;
  invertY: boolean;
  crouchToggle: boolean;
}

/** The sim's input extension: E held (egg set-down hold, src/mystery/run.ts MysteryInputExt). */
export type MysteryFrameInput = MysteryInput & { interactHeld: boolean };

/** Radians of yaw per mouse pixel at sensitivity 5 (~0.14° / px). */
export const LOOK_RAD_PER_PX = 0.0024;
/** Keyboard look: ← → 120°/s (UX ruling 5), ↑ ↓ pitch. */
export const KEY_TURN_RAD_PER_S = (120 * Math.PI) / 180;
export const KEY_PITCH_RAD_PER_S = (70 * Math.PI) / 180;

/** Codes the game owns while playing: their browser defaults (scroll, find, focus moves…) are suppressed. */
export const GAME_CODES: ReadonlySet<string> = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight',
  'KeyC', 'KeyE', 'KeyF', 'KeyQ', 'KeyV', 'Space', 'Tab', 'PageUp', 'PageDown', 'Home', 'End', 'Slash', 'Quote', 'Backspace',
]);

type Edge = 'interact' | 'power' | 'move' | 'hint';
const EDGE_BY_CODE: Record<string, Edge> = { KeyE: 'interact', KeyF: 'power', KeyQ: 'move', KeyV: 'hint' };
const CTRL_CODES = new Set(['ControlLeft', 'ControlRight']);

export class MysteryInputController {
  prefs: LookPrefs;
  /** Whether Ctrl may crouch right now (kiosk keyboard lock active). */
  ctrlCrouch: () => boolean;
  private held = new Set<string>();
  private edges: Record<Edge, boolean> = { interact: false, power: false, move: false, hint: false };
  private crouchLatched = false;
  private dx = 0;
  private dy = 0;
  /** Cumulative counters (tutorial steps + debug). */
  readonly counts = { lookPx: 0, keyTurnS: 0, moveS: 0, sprintS: 0, crouchS: 0, interact: 0, power: 0, move: 0, hint: 0 };

  constructor(prefs: LookPrefs, ctrlCrouch: () => boolean = () => false) {
    this.prefs = { ...prefs };
    this.ctrlCrouch = ctrlCrouch;
  }

  private isCrouchKey(code: string): boolean {
    return code === 'KeyC' || (CTRL_CODES.has(code) && this.ctrlCrouch());
  }

  /** Returns true when the key belongs to the game (caller should preventDefault). */
  keyDown(code: string, repeat = false): boolean {
    if (!repeat) {
      const edge = EDGE_BY_CODE[code];
      if (edge) this.edges[edge] = true;
      if (this.prefs.crouchToggle && this.isCrouchKey(code)) this.crouchLatched = !this.crouchLatched;
    }
    if (CTRL_CODES.has(code) && !this.ctrlCrouch()) return false; // ignored outside the kiosk lock
    this.held.add(code);
    return GAME_CODES.has(code) || CTRL_CODES.has(code);
  }

  keyUp(code: string): void {
    this.held.delete(code);
  }

  mouseMove(movementX: number, movementY: number): void {
    this.dx += movementX;
    this.dy += movementY;
  }

  /** Window blur / overlay open: drop held keys and pending look so nothing sticks. Toggled crouch persists. */
  clear(): void {
    this.held.clear();
    this.dx = 0;
    this.dy = 0;
    this.edges = { interact: false, power: false, move: false, hint: false };
  }

  isHeld(code: string): boolean {
    return this.held.has(code);
  }

  get crouching(): boolean {
    if (this.prefs.crouchToggle) return this.crouchLatched;
    return this.held.has('KeyC') || (this.ctrlCrouch() && [...CTRL_CODES].some((c) => this.held.has(c)));
  }

  /** Builds the frame's input and resets edges + mouse deltas. */
  consume(dt: number): MysteryFrameInput {
    const h = (c: string) => this.held.has(c);
    const moveX = (h('KeyD') ? 1 : 0) - (h('KeyA') ? 1 : 0);
    const moveZ = (h('KeyW') ? 1 : 0) - (h('KeyS') ? 1 : 0);
    const keyTurn = (h('ArrowLeft') ? 1 : 0) - (h('ArrowRight') ? 1 : 0); // + = turn left (contract yaw convention)
    const keyPitch = (h('ArrowUp') ? 1 : 0) - (h('ArrowDown') ? 1 : 0); // + = look up
    const sens = LOOK_RAD_PER_PX * (clamp(this.prefs.sensitivity, 1, 10) / 5);
    // Mouse right → turn right → yaw decreases. Mouse up (dy < 0) → look up (+pitch) unless inverted.
    const lookYawDelta = -this.dx * sens + keyTurn * KEY_TURN_RAD_PER_S * dt;
    const mousePitch = (this.prefs.invertY ? this.dy : -this.dy) * sens;
    const lookPitchDelta = mousePitch + (this.prefs.invertY ? -keyPitch : keyPitch) * KEY_PITCH_RAD_PER_S * dt;
    const sprint = h('ShiftLeft') || h('ShiftRight');
    const crouch = this.crouching;
    const out: MysteryFrameInput = {
      moveX, moveZ, lookYawDelta, lookPitchDelta, sprint, crouch,
      interact: this.edges.interact, power: this.edges.power, move: this.edges.move, hint: this.edges.hint,
      interactHeld: h('KeyE'),
    };
    const c = this.counts;
    c.lookPx += Math.abs(this.dx) + Math.abs(this.dy);
    if (keyTurn !== 0 || keyPitch !== 0) c.keyTurnS += dt;
    if (moveX !== 0 || moveZ !== 0) c.moveS += dt;
    if (sprint && (moveX !== 0 || moveZ !== 0)) c.sprintS += dt;
    if (crouch) c.crouchS += dt;
    if (out.interact) c.interact++;
    if (out.power) c.power++;
    if (out.move) c.move++;
    if (out.hint) c.hint++;
    this.dx = 0;
    this.dy = 0;
    this.edges = { interact: false, power: false, move: false, hint: false };
    return out;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export const IDLE_INPUT: MysteryFrameInput = {
  moveX: 0, moveZ: 0, lookYawDelta: 0, lookPitchDelta: 0, sprint: false, crouch: false, interact: false, power: false, move: false, hint: false,
  interactHeld: false,
};
