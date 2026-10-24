// Death cutscenes: a short scripted shot per monster, played by MysteryScene when the run is lost (3-5 s, first person, no gore):
//   hyde       : a creeping dolly toward the beast in the mist, its head snaps up, a roar flash, then a sudden lunge straight at the lens, impact, black.
//   crackstone : the pilgrim raises his staff, a cursed sigil blooms under the camera and rises around it, a green burst, the world fades to grey-violet.
//   slurp      : the zombie lurches closer, rears up, lunges and grabs; the camera is yanked into a close-up of the face (jaw wide, pale eyes), then black.
// This module is PURE timeline maths: it produces a `DeathStage` per frame (a staged enemy pose, a camera pose, overlay fades / flashes, one-shot
// events) that the scene feeds through its normal rendering paths (a staged copy of the run), so the creatures animate with their real rigs.
// Reduced motion: the same staging frozen at its key frame (no camera move, no flashes, no fade) for 1.2 s; the app cross-fades to the card.
import * as THREE from 'three';
import type { EnemyId } from '../../mystery/types.ts';
import { clamp, lerp, smoothstep } from '../util.ts';

export type DeathCue = 'start' | 'build' | 'strike' | 'impact' | 'fade' | 'end';
export interface DeathOptions {
  reducedMotion: boolean;
  /** sound hook: called once per cue as the cutscene reaches it (start, build, strike, impact, fade, end) */
  onCue?: (cue: DeathCue, enemy: EnemyId) => void;
}
export type DeathEventKind = 'roar' | 'impact' | 'burst' | 'grab';

export interface DeathStage {
  /** script time in seconds (the staged run's `t`) */
  t: number;
  staged: boolean;
  enemy: EnemyId;
  // ---- staged enemy (world space)
  x: number; z: number; yaw: number;
  mode: string;
  speed: number;
  grabbing: boolean;
  attacking: boolean;
  windup: number;
  reach: number;
  jaw: number | null;
  suspicion: number;
  curse: { x: number; z: number; radiusM: number; startedAt: number; landsAt: number } | null;
  /** 0..1 ghost fade of the enemy body */
  fade: number;
  // ---- camera
  cam: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  roll: number;
  /** Slurp: 0..1 blend toward a camera that hangs off the face (`headDist` m from the head) */
  headK: number;
  headDist: number;
  // ---- screen
  fadeRGB: [number, number, number];
  fadeA: number;
  flashRGB: [number, number, number];
  flashA: number;
  /** extra dark vignette 0..1 */
  dark: number;
  shake: number;
  /** Crackstone: progress 0..1 of the rising sigil rings (0 = none) */
  sigil: number;
  events: DeathEventKind[];
}

export const DEATH_DURATION: Readonly<Record<EnemyId, number>> = { hyde: 3.2, crackstone: 4.0, slurp: 3.6 };
/** reduced motion: a still frame of the monster's pose for this long (the app cross-fades to the card) */
export const DEATH_REDUCED_DURATION = 1.2;
/** script time shown as the still frame */
const KEY_T: Readonly<Record<EnemyId, number>> = { hyde: 1.95, crackstone: 1.75, slurp: 2.7 };
/** end colour of each cutscene (the held frame under the game-over card) */
export const DEATH_END: Readonly<Record<EnemyId, [number, number, number]>> = { hyde: [0, 0, 0], crackstone: [0, 0, 0], slurp: [0, 0, 0] };
/** the grey-violet the world fades to before the final black (Crackstone) */
const GREY_VIOLET: [number, number, number] = [0.36, 0.33, 0.45];

const easeIn = (u: number, p = 2): number => Math.pow(clamp(u, 0, 1), p);
const easeOut = (u: number, p = 3): number => 1 - Math.pow(1 - clamp(u, 0, 1), p);
const mix3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export class DeathCutscene {
  readonly enemy: EnemyId;
  readonly reduced: boolean;
  readonly duration: number;
  readonly stage: DeathStage;
  private t = 0;
  private finished = false;
  private skipped = false;
  private readonly fired = new Set<string>();
  private readonly fx: number;
  private readonly fz: number;
  private readonly rx: number;
  private readonly rz: number;

  /**
   * @param ox,oz   the player (camera) position
   * @param psi     yaw of the shot direction (toward where the monster is staged); forward = (-sin psi, -cos psi)
   * @param eyeY    camera eye height
   * @param distScale  0.5..1: shrinks the long approach when there is little open ground ahead
   */
  constructor(enemy: EnemyId, private readonly ox: number, private readonly oz: number, private readonly psi: number, private readonly eyeY: number, opts: DeathOptions, private readonly distScale = 1) {
    this.enemy = enemy;
    this.reduced = opts.reducedMotion;
    this.duration = this.reduced ? DEATH_REDUCED_DURATION : DEATH_DURATION[enemy];
    this.onCue = opts.onCue;
    this.fx = -Math.sin(psi); this.fz = -Math.cos(psi);
    this.rx = -this.fz; this.rz = this.fx; // right-hand side seen from above... (only used for sway)
    this.stage = {
      t: 0, staged: true, enemy, x: ox, z: oz, yaw: 0, mode: 'PATROL', speed: 0, grabbing: false, attacking: false, windup: 0, reach: 0, jaw: null, suspicion: 0, curse: null, fade: 0,
      cam: new THREE.Vector3(ox, eyeY, oz), look: new THREE.Vector3(ox + this.fx, eyeY, oz + this.fz), fov: 62, roll: 0, headK: 0, headDist: 1,
      fadeRGB: [0, 0, 0], fadeA: 0, flashRGB: [1, 1, 1], flashA: 0, dark: 0, shake: 0, sigil: 0, events: [],
    };
    this.cue('start');
  }

  private readonly onCue?: (cue: DeathCue, enemy: EnemyId) => void;
  private cue(c: DeathCue): void {
    if (this.fired.has(c)) return;
    this.fired.add(c);
    try { this.onCue?.(c, this.enemy); } catch { /* sound hooks must never break the scene */ }
  }
  private once(key: string): boolean {
    const k = 'once:' + key;
    if (this.fired.has(k)) return false;
    this.fired.add(k);
    return true;
  }

  get done(): boolean { return this.finished; }
  get time(): number { return this.t; }
  get wasSkipped(): boolean { return this.skipped; }

  /** Jumps to the end frame (the caller resolves its promise). */
  skip(): void {
    if (this.finished) return;
    this.skipped = true;
    this.t = this.duration;
    this.step(0);
  }

  step(dt: number): DeathStage {
    const S = this.stage;
    S.events.length = 0;
    if (!this.finished) this.t = Math.min(this.duration, this.t + dt);
    const t = this.reduced ? KEY_T[this.enemy] : this.t;
    S.t = t;
    S.flashA = 0; S.shake = 0; S.dark = 0; S.sigil = 0; S.roll = 0; S.fadeA = 0;
    if (this.enemy === 'hyde') this.hyde(t);
    else if (this.enemy === 'crackstone') this.crackstone(t);
    else this.slurp(t);
    if (this.reduced) {
      // a still: no motion, no flashes, no fade; the creature holds its key pose
      S.flashA = 0; S.shake = 0; S.fadeA = 0; S.speed = 0; S.events.length = 0; S.roll = 0;
      if (this.enemy === 'crackstone') this.camAt(0, this.eyeY, -0.12);
      if (this.t > 0.2) this.cue('strike');
    }
    if (this.t >= this.duration && !this.finished) { this.finished = true; this.cue('end'); }
    return S;
  }

  get originX(): number { return this.ox; }
  get originZ(): number { return this.oz; }

  private place(d0: number): void {
    const S = this.stage;
    // short rooms: only the long approach shrinks (the last 2.5 m of the shot never do)
    const d = d0 <= 2.5 ? d0 : 2.5 + (d0 - 2.5) * this.distScale;
    S.x = this.ox + this.fx * d;
    S.z = this.oz + this.fz * d;
    S.yaw = this.psi + Math.PI; // faces the camera
  }

  private camAt(dolly: number, y: number, pitch: number, sway = 0): void {
    const S = this.stage;
    const px = this.ox + this.fx * dolly + this.rx * sway, pz = this.oz + this.fz * dolly + this.rz * sway;
    S.cam.set(px, y, pz);
    const cp = Math.cos(pitch);
    S.look.set(px + this.fx * cp, y + Math.sin(pitch), pz + this.fz * cp);
  }

  // ------------------------------------------------------------------------------------------------------------------- Hyde
  private hyde(t: number): void {
    const S = this.stage;
    const d0 = 10.5;
    const lungeStart = 1.5, contact = 2.1;
    if (t < 0.55) { S.mode = 'PATROL'; S.speed = 0; }
    else if (t < 1.25) { S.mode = 'SEARCH'; S.speed = 0; S.suspicion = 0.7; }
    else { S.mode = 'CHASE'; S.suspicion = 1; }
    let d = d0 - 0.4 * Math.min(t, lungeStart);
    let dolly = 0.35 * Math.min(t, lungeStart); // the camera creeps forward too
    S.grabbing = false;
    if (t >= 1.1 && this.once('build')) this.cue('build');
    if (t >= 1.3 && this.once('roar')) { S.events.push('roar'); this.cue('strike'); }
    if (t >= lungeStart) {
      const u = (t - lungeStart) / (contact - lungeStart);
      const dFrom = d0 - 0.4 * lungeStart;
      d = lerp(dFrom, 1.15, easeIn(u, 2.4));
      S.speed = 5.2;
      S.grabbing = u > 0.72;
      dolly = 0.35 * lungeStart - 0.45 * easeOut(u, 2); // the lens recoils as it comes
    }
    this.place(d);
    S.fov = 62 + 16 * easeIn((t - lungeStart) / (contact - lungeStart), 1.6) + (t < lungeStart ? -2 * smoothstep(0.2, 1.2, t) : 0);
    // roar flash (violet-white) then the impact flash
    const roar = t >= 1.3 && t < 1.8 ? Math.pow(1 - (t - 1.3) / 0.5, 2) * 0.45 : 0;
    if (roar > 0) { S.flashRGB = [0.82, 0.7, 1]; S.flashA = roar; }
    S.shake = (t >= 1.3 ? 0.35 * Math.pow(clamp(1 - (t - 1.3) / 0.9, 0, 1), 1.2) : 0) + (t >= lungeStart && t < contact ? 0.35 + 0.5 * easeIn((t - lungeStart) / (contact - lungeStart)) : 0);
    if (t >= contact) {
      if (this.once('impact')) { S.events.push('impact'); this.cue('impact'); }
      // contact: one white flash frame, then a hard cut to black (the held black is the end of the shot)
      if (t < contact + 0.1) { S.flashRGB = [1, 0.96, 1]; S.flashA = 0.95; }
      S.shake = Math.max(S.shake, 1.0 * Math.pow(clamp(1 - (t - contact) / 0.3, 0, 1), 1.5));
      S.fadeRGB = DEATH_END.hyde;
      S.fadeA = t >= contact + 0.06 ? 1 : 0;
      if (this.once('fade')) this.cue('fade');
    }
    S.dark = 0.25 * smoothstep(1.0, 1.9, t);
    this.camAt(dolly, this.eyeY, -0.02 + 0.06 * smoothstep(1.1, 1.5, t) - 0.04 * smoothstep(1.5, contact, t));
  }

  // ------------------------------------------------------------------------------------------------------------------ Crackstone
  private crackstone(t: number): void {
    const S = this.stage;
    const dFar = 8.5;
    const castAt = 0.7, landsAt = 2.0;
    // glides closer once the circle is cast
    this.place(lerp(dFar, 4.6, smoothstep(0.8, 2.6, t)));
    S.suspicion = 1;
    S.mode = t < 0.45 ? 'PATROL' : 'ATTACK';
    S.speed = 0;
    if (t >= 0.4 && this.once('build')) this.cue('build');
    if (t >= castAt) S.curse = { x: this.ox, z: this.oz, radiusM: 3.4, startedAt: castAt, landsAt };
    // the staged run's clock is script time: after the burst the circle is cleared (the scene fires the `curse hit` burst from the event)
    if (t >= landsAt) {
      S.curse = null;
      if (this.once('burst')) { S.events.push('burst'); this.cue('strike'); this.cue('impact'); }
    }
    // camera: eyes up, then down at the sigil taking shape under the player's feet, then up as it rises
    const pitch = 0.05 - 0.55 * smoothstep(0.8, 1.3, t) * (1 - smoothstep(2.0, 2.5, t)) + 0.26 * smoothstep(2.1, 2.9, t);
    this.camAt(0, this.eyeY, pitch);
    S.fov = 62 + 6 * smoothstep(2.0, 2.7, t);
    S.shake = t >= landsAt ? 0.45 * Math.pow(clamp(1 - (t - landsAt) / 0.8, 0, 1), 1.3) : 0.06 * smoothstep(1.0, 2.0, t);
    if (t >= landsAt) S.sigil = clamp((t - landsAt) / 1.5, 0, 1);
    const flash = t >= landsAt && t < landsAt + 0.4 ? Math.pow(1 - (t - landsAt) / 0.4, 2) * 0.4 : 0;
    if (flash > 0) { S.flashRGB = [0.7, 1, 0.5]; S.flashA = flash; }
    S.fade = 0.7 * smoothstep(2.5, 3.4, t);
    S.dark = 0.2 * smoothstep(1.0, 2.0, t);
    // supernatural fade: the world drains to grey-violet, then the last 400 ms go to black
    const toBlack = smoothstep(this.duration - 0.4, this.duration, t);
    S.fadeRGB = mix3(GREY_VIOLET, DEATH_END.crackstone, toBlack);
    S.fadeA = Math.max(smoothstep(landsAt + 0.15, this.duration - 0.6, t) * 0.97, toBlack);
    if (t >= landsAt + 0.15 && this.once('fade')) this.cue('fade');
  }

  // ------------------------------------------------------------------------------------------------------------------------ Slurp
  private slurp(t: number): void {
    const S = this.stage;
    const approachEnd = 1.6, windEnd = 2.05, grabEnd = 2.3;
    const u = clamp(t / approachEnd, 0, 1);
    let d = 7 - 4.9 * (u + 0.035 * Math.sin(u * 16)); // a stuttering, lurching approach
    S.mode = 'CHASE'; S.speed = t < approachEnd ? 1.9 : 0.3; S.attacking = false; S.windup = 0; S.reach = 0; S.jaw = null;
    S.suspicion = 1;
    let dolly = 0, shake = 0.04 * smoothstep(0.5, 1.6, t);
    if (t >= 0.3 && this.once('build')) this.cue('build');
    if (t >= approachEnd) {
      // wind-up: he rears back, mouth gaping, trembling; the lens flinches back
      const w = clamp((t - approachEnd) / (windEnd - approachEnd), 0, 1);
      S.mode = 'ATTACK'; S.windup = w; d = 2.1 + 0.25 * w; dolly = -0.18 * w; shake = 0.12 + 0.25 * w;
    }
    if (t >= windEnd) {
      // lunge + grab: he covers the gap in a couple of frames
      const g = clamp((t - windEnd) / (grabEnd - windEnd), 0, 1);
      S.attacking = true; S.windup = 1; S.reach = easeOut(g, 2);
      d = lerp(2.35, 0.95, easeIn(g, 1.7));
      dolly = -0.18 + 0.1 * g;
      shake = 0.5 + 0.5 * g;
      if (this.once('strike')) { S.events.push('grab'); this.cue('strike'); }
    }
    this.place(d);
    // camera: level until the grab, then yanked down and in toward the face
    let pitch = 0.0;
    if (t >= windEnd) pitch = -0.32 * easeOut((t - windEnd) / 0.3, 2);
    this.camAt(dolly, this.eyeY, pitch);
    S.fov = 62 + 10 * smoothstep(windEnd, windEnd + 0.4, t);
    // close-up: the camera hangs off the face, coming nearer as the head lunges into frame
    const cu = smoothstep(grabEnd - 0.04, grabEnd + 0.32, t);
    S.headK = cu;
    S.headDist = lerp(1.0, 0.4, easeOut((t - grabEnd) / 0.6, 2.2));
    S.jaw = t >= windEnd ? 1.15 : null;
    if (t >= grabEnd + 0.25) S.fov = lerp(S.fov, 56, smoothstep(grabEnd + 0.25, grabEnd + 0.7, t));
    S.shake = shake;
    if (t >= windEnd && t < windEnd + 0.35) { S.flashRGB = [0.82, 0.9, 0.82]; S.flashA = Math.pow(1 - (t - windEnd) / 0.35, 2) * 0.28; }
    S.dark = 0.3 * smoothstep(0.8, 2.0, t) + 0.35 * cu;
    const blackAt = 2.95;
    if (t >= blackAt - 0.08 && this.once('impact')) this.cue('impact');
    S.fadeRGB = DEATH_END.slurp;
    S.fadeA = smoothstep(blackAt, blackAt + 0.12, t); // cut to black at contact
    if (t >= blackAt && this.once('fade')) this.cue('fade');
    if (t >= grabEnd + 0.3 && t < blackAt) S.shake = 0.35 + 0.15 * Math.sin(t * 40);
  }
}
