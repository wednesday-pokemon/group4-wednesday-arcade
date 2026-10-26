// Enterable hiding cabinets (HidingSpotDef.kind === 'cabinet'): one model per case theme - an archive cupboard with louvred wooden doors,
// a crypt ossuary locker (stone frame, plank door with iron straps and cracks), a security locker (steel door with vent slits). The carcass is
// static (merged into the hiding-spot geometry); the DOOR is a separate mesh on a hinge, driven by a damped spring from the run's cabinet
// phase + `cabinet` events, so it opens as the player steps in, shuts on E, creaks open on exit and flies open when a monster pulls the player
// out. Also owns the outline highlight (lantern rim, like the other interactables) and the hiding-view eye pose.
// Local model frame: origin = cabinet centre on the ground, front (the door) = -Z, like every other prop; placed with yaw = doorYaw.
import * as THREE from 'three';
import type { HidingSpotDef, MapDef } from '../../mystery/types.ts';
import { lambertVC } from '../actors.ts';
import { MeshBuilder, clamp, damp, hashString, mulberry32 } from '../util.ts';
import { mergeAll } from '../action/geom.ts';
import { Bld } from './builders.ts';
import { BOX, CONE4, CYL6, CYL8, ICO0, ICO1, PAL, TORUS, nearestWall, yawOf } from './common.ts';
import { gradeGeometry, type Grade, type Theme } from './look.ts';

const NG = { gradient: 0, jitter: 0 } as const;
/** cabinet outer size (m) and the eye pose of the hiding view */
export const CAB = { W: 1.16, D: 0.92, H: 2.15, DOOR_T: 0.045, EYE_Y: 1.52, EYE_BACK: 0.5, OPEN_MAX: 2.2 } as const;
const WD = CAB.W - 0.1; // door width

/** Which way the door faces: the designer's doorYaw, else away from the nearest wall, else 0. */
export function cabinetYaw(map: MapDef, h: HidingSpotDef, skip?: ReadonlySet<string>): number {
  if (typeof h.doorYaw === 'number' && Number.isFinite(h.doorYaw)) return h.doorYaw;
  const nw = nearestWall(map, h.x, h.z, skip);
  if (nw && nw.d < 2.5) {
    const w = nw.wall;
    const dx = w.b.x - w.a.x, dz = w.b.z - w.a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((h.x - w.a.x) * dx + (h.z - w.a.z) * dz) / l2));
    const fx = h.x - (w.a.x + dx * t), fz = h.z - (w.a.z + dz * t);
    if (Math.hypot(fx, fz) > 0.05) return yawOf(fx, fz);
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------- carcass
export function buildCabinetCarcass(b: Bld, theme: Theme): void {
  const { W, D, H } = CAB;
  const wood = theme === 'archive', stone = theme === 'crypt';
  const body = wood ? '#4e3524' : stone ? '#3a3b58' : '#4b5b72';
  const bodyDark = wood ? '#33221a' : stone ? '#262843' : '#37465a';
  const inner = wood ? '#1c130d' : stone ? '#101224' : '#0f1620';
  const top = wood ? '#6a4630' : stone ? '#4a4d78' : '#566680';
  b.lit.add(BOX, bodyDark, [0, 0.06, 0], [0, 0, 0], [W + 0.1, 0.12, D + 0.1], { gradient: 0.1 }); // plinth
  b.lit.add(BOX, inner, [0, 0.14, 0], [0, 0, 0], [W - 0.1, 0.04, D - 0.1], NG); // floor
  for (const s of [-1, 1]) {
    b.lit.add(BOX, body, [s * (W / 2 - 0.03), H / 2, 0], [0, 0, 0], [0.06, H, D], { gradient: 0.35, jitter: 0.07 }); // sides
    b.lit.add(BOX, inner, [s * (W / 2 - 0.066), H / 2, 0.02], [0, 0, 0], [0.012, H - 0.3, D - 0.12], NG); // dark inner lining
  }
  b.lit.add(BOX, body, [0, H / 2, D / 2 - 0.025], [0, 0, 0], [W, H, 0.05], { gradient: 0.3, jitter: 0.07 }); // back
  b.lit.add(BOX, inner, [0, H / 2, D / 2 - 0.056], [0, 0, 0], [W - 0.12, H - 0.3, 0.012], NG);
  b.lit.add(BOX, bodyDark, [0, H - 0.04, 0], [0, 0, 0], [W, 0.08, D], NG); // ceiling
  // front frame (jambs + rails) that the door closes against
  for (const s of [-1, 1]) b.lit.add(BOX, bodyDark, [s * (W / 2 - 0.035), H / 2, -D / 2 + 0.03], [0, 0, 0], [0.07, H - 0.1, 0.06], { gradient: 0.3 });
  b.lit.add(BOX, bodyDark, [0, H - 0.1, -D / 2 + 0.03], [0, 0, 0], [W, 0.1, 0.06], NG);
  b.lit.add(BOX, bodyDark, [0, 0.19, -D / 2 + 0.03], [0, 0, 0], [W, 0.1, 0.06], NG);

  if (wood) {
    // archive cupboard: cornice, a brass plate, ledgers stacked on top, a hanging file rail inside
    b.lit.add(BOX, top, [0, H + 0.05, 0.01], [0, 0, 0], [W + 0.16, 0.1, D + 0.14], { gradient: 0 });
    b.lit.add(BOX, bodyDark, [0, H + 0.12, -D / 2 - 0.02], [0, 0, 0], [W + 0.04, 0.05, 0.05], NG);
    b.em.add(BOX, '#c9a24a', [0, H + 0.05, -(D + 0.14) / 2 - 0.008], [0, 0, 0], [0.2, 0.05, 0.012], NG);
    ['#6b2a3a', '#2e4a6b', '#4a6b3a', '#6b5a2a'].forEach((c, i) => b.lit.add(BOX, c, [-0.25 + i * 0.12, H + 0.17 + (i % 2) * 0.02, 0.05], [0, (i - 1.5) * 0.12, 0], [0.1, 0.16, 0.22], { gradient: 0.1 }));
    b.lit.add(CYL6, PAL.iron, [0, 1.86, 0.1], [0, 0, Math.PI / 2], [0.015, W - 0.16, 0.015], NG);
    for (let i = 0; i < 4; i++) b.lit.add(BOX, ['#7a6a4a', '#8a7a58', '#6a5a3e', '#7a6a4a'][i], [-0.32 + i * 0.21, 1.66, 0.14 + (i % 2) * 0.04], [0.04, 0, 0.03 * (i - 1.5)], [0.012, 0.36, 0.2], NG);
  } else if (stone) {
    // ossuary locker: a heavy lintel with a carved skull and crossed bones, skulls stacked on top, a corbel candle
    b.lit.add(BOX, top, [0, H + 0.07, 0], [0, 0, 0], [W + 0.22, 0.14, D + 0.18], { gradient: 0.2, jitter: 0.08 });
    b.lit.add(BOX, bodyDark, [0, H + 0.17, 0.02], [0, 0, 0], [W + 0.08, 0.08, D + 0.04], NG);
    const lz = -(D + 0.18) / 2 - 0.03; // on the lintel's front face (never inside the cabinet)
    b.lit.add(ICO1, '#cfc7b0', [0, H + 0.08, lz], [0, 0, 0], [0.08, 0.09, 0.04], { gradient: 0.2, jitter: 0.04 });
    b.lit.add(BOX, '#1a1a24', [-0.03, H + 0.095, lz - 0.03], [0, 0, 0], [0.034, 0.03, 0.012], NG);
    b.lit.add(BOX, '#1a1a24', [0.03, H + 0.095, lz - 0.03], [0, 0, 0], [0.034, 0.03, 0.012], NG);
    for (const r of [0.45, -0.45]) b.lit.add(CYL6, '#cfc7b0', [0, H + 0.05, lz + 0.02], [0, 0, r + Math.PI / 2], [0.012, 0.3, 0.012], NG);
    for (let i = 0; i < 4; i++) b.lit.add(ICO1, '#cfc7b0', [-0.34 + i * 0.23, H + 0.3, -0.08 + (i % 2) * 0.18], [0, i * 1.1, 0], [0.085, 0.1, 0.09], { gradient: 0.3, jitter: 0.05 });
    const cx = W / 2 + 0.16;
    b.lit.add(BOX, bodyDark, [cx - 0.04, 1.35, -D / 2 + 0.02], [0, 0, 0], [0.16, 0.05, 0.14], NG);
    b.lit.add(CYL8, '#d8ccb0', [cx - 0.04, 1.47, -D / 2 + 0.02], [0, 0, 0], [0.028, 0.18, 0.028], NG);
    b.em.add(CONE4, '#ffb04a', [cx - 0.04, 1.6, -D / 2 + 0.02], [0, 0.4, 0], [0.034, 0.1, 0.034], NG);
    b.glows.push({ x: cx - 0.04, y: 1.62, z: -D / 2 - 0.05, size: 1.7, color: '#ffb04a', alpha: 0.7, flicker: 0.9, fogFloor: 0.1 });
  } else {
    // security locker: slanted steel top, feet, a status LED, a stencilled number plate
    b.lit.add(BOX, top, [0, H + 0.03, 0.04], [-0.07, 0, 0], [W + 0.04, 0.06, D + 0.04], { gradient: 0 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.lit.add(BOX, PAL.iron, [sx * (W / 2 - 0.03), 0.02, sz * (D / 2 - 0.04)], [0, 0, 0], [0.08, 0.04, 0.08], NG);
    b.lit.add(BOX, '#d8dce4', [-0.28, H - 0.05, -D / 2 - 0.008], [0, 0, 0], [0.18, 0.06, 0.012], NG);
    b.em.add(BOX, '#7bffb0', [0.4, H - 0.05, -D / 2 - 0.012], [0, 0, 0], [0.04, 0.04, 0.012], NG);
    b.glows.push({ x: 0.4, y: H - 0.05, z: -D / 2 - 0.05, size: 0.7, color: '#7bffb0', alpha: 0.55, flicker: 0.4, fogFloor: 0.05 });
    b.lit.add(BOX, PAL.iron, [0, H - 0.1, D / 2 - 0.02], [0, 0, 0], [W - 0.2, 0.08, 0.04], NG);
  }
}

// ------------------------------------------------------------------------------------------------------------------ door
/**
 * The door in hinge-local space: the hinge line is the Y axis at x = 0, the door runs along `dir * x` (dir = +1 or -1 so the hinge can sit
 * on either side), its plane is z = 0 (the outer face looks toward -Z). The geometry is built for the closed position; the pivot rotates it.
 */
export function buildCabinetDoor(theme: Theme, dir: 1 | -1, low: boolean, seed: string): THREE.BufferGeometry {
  const rand = mulberry32(hashString(seed));
  const mb = new MeshBuilder(rand);
  const H = CAB.H, T = CAB.DOOR_T;
  const X = (u: number): number => dir * u; // door-local u (0 at the hinge .. WD) -> x
  const box = (u0: number, u1: number, y0: number, y1: number, zc: number, dz: number, c: string, o: { rotX?: number; g?: number; j?: number } = {}): void => {
    mb.add(BOX, c, [X((u0 + u1) / 2), (y0 + y1) / 2, zc], [o.rotX ?? 0, 0, 0], [u1 - u0, y1 - y0, dz], { gradient: o.g ?? 0.25, jitter: o.j ?? 0.07 });
  };
  const y0 = 0.14, y1 = H - 0.1; // the door covers the opening between the rails
  if (theme === 'archive') {
    const wood = '#5a3d2a', dark = '#3b271a', slat = '#4a3222', brass = '#caa24a';
    const st = 0.075, rl = 0.085; // stile / rail widths
    box(0, st, y0, y1, 0, T, wood); box(WD - st, WD, y0, y1, 0, T, wood); // stiles
    box(0, WD, y1 - rl, y1, 0, T, wood); box(0, WD, y0, y0 + rl, 0, T, wood); // rails
    box(st, WD - st, y0 + rl, y0 + 0.4, 0, T * 0.8, dark); // solid lower panel
    box(st + 0.05, WD - st - 0.05, y0 + rl + 0.05, y0 + 0.35, -T * 0.55, 0.012, wood, { g: 0.1 }); // raised panel
    const l0 = y0 + 0.44, l1 = y1 - rl - 0.04; // louvred zone
    const pitch = low ? 0.14 : 0.118;
    const n = Math.max(3, Math.floor((l1 - l0) / pitch));
    for (let i = 0; i < n; i++) box(st, WD - st, l0 + i * pitch, l0 + i * pitch + 0.06, 0, 0.012, slat, { rotX: 0.5, g: 0.15 });
    mb.add(ICO0, brass, [X(WD - 0.1), 1.05, -T * 0.75], [0, 0, 0], [0.04, 0.04, 0.03], NG); // knob
    box(WD - 0.13, WD - 0.07, 0.99, 1.11, -T * 0.55, 0.01, brass, { g: 0 });
    for (const yy of [0.5, 1.5]) mb.add(CYL6, '#9a7a3a', [X(0.012), yy, -T * 0.5], [0, 0, 0], [0.018, 0.14, 0.018], NG); // hinge barrels
  } else if (theme === 'crypt') {
    const oak = ['#4a3626', '#3f2e20', '#53402c', '#43321f'], iron = '#25252f';
    const n = 4, gap = 0.07;
    const w = (WD - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const u0 = i * (w + gap);
      box(u0, u0 + w, y0, y1 - (i % 2) * 0.03 - 0.02, (rand() - 0.5) * 0.008, T, oak[i % 4], { g: 0.3, j: 0.1 });
    }
    for (const yy of [0.42, 0.98, 1.9]) { // iron straps across the planks (the head-height zone stays open for the cracks)
      box(0, WD, yy - 0.05, yy + 0.05, -T * 0.62, 0.014, iron, { g: 0.1 });
      for (let k = 0; k < 4; k++) mb.add(ICO0, '#55555f', [X(0.1 + k * (WD - 0.2) / 3), yy, -T * 0.78], [0, 0, 0], 0.016, NG);
      box(0, 0.22, yy - 0.07, yy + 0.07, -T * 0.62, 0.016, iron, { g: 0.1 }); // hinge-side strap eye
    }
    mb.add(TORUS, '#6a6a76', [X(WD - 0.12), 1.08, -T * 0.9], [Math.PI / 2, 0, 0], [0.06, 0.06, 0.06], NG); // ring pull
    box(WD - 0.16, WD - 0.08, 1.0, 1.16, -T * 0.7, 0.016, iron, { g: 0 });
    box(0.04, WD - 0.04, y0, y0 + 0.05, T * 0.55, 0.012, '#2a1f16', { g: 0 }); // backing rail inside, low
  } else {
    const steel = '#586a80', steelHi = '#667a92', dark = '#2d3a4c';
    const vy0 = 1.36, vy1 = 1.9;
    box(0, WD, y0, vy0, 0, T, steel, { g: 0.25, j: 0.04 }); // lower plate
    box(0, WD, vy1, y1, 0, T, steel, { g: 0.2, j: 0.04 }); // top cap
    box(0, 0.05, vy0, vy1, 0, T, steel); box(WD - 0.05, WD, vy0, vy1, 0, T, steel); // vent-zone stiles
    const vp = low ? 0.1 : 0.085;
    const n = Math.max(4, Math.floor((vy1 - vy0) / vp));
    for (let i = 0; i < n; i++) box(0.05, WD - 0.05, vy0 + 0.01 + i * vp, vy0 + 0.01 + i * vp + 0.04, 0, 0.01, steelHi, { rotX: -0.42, g: 0.1, j: 0.03 });
    box(0.1, WD - 0.1, 0.5, 0.52, -T * 0.55, 0.01, dark, { g: 0 }); // embossed rib
    box(0.1, WD - 0.1, 0.9, 0.92, -T * 0.55, 0.01, dark, { g: 0 });
    box(WD - 0.14, WD - 0.1, 0.85, 1.2, -T * 0.8, 0.02, '#12151c', { g: 0 }); // pull handle
    box(WD - 0.2, WD - 0.1, 0.78, 0.86, -T * 0.55, 0.014, '#aeb6c4', { g: 0 }); // lock plate
    box(0.14, 0.38, 1.22, 1.3, -T * 0.55, 0.01, '#d8dce4', { g: 0 }); // number tag
    for (const yy of [0.4, 1.0, 1.7]) mb.add(CYL6, '#2a3342', [X(0.012), yy, -T * 0.5], [0, 0, 0], [0.02, 0.12, 0.02], NG);
  }
  return mergeAll([mb.build()]) ?? new THREE.BufferGeometry();
}

// ------------------------------------------------------------------------------------------------------------------ runtime
export interface CabinetRt {
  def: HidingSpotDef;
  x: number;
  z: number;
  yaw: number;
  /** +1 / -1: which way the free edge lies from the hinge */
  dir: 1 | -1;
  group: THREE.Group;
  pivot: THREE.Group;
  hull: THREE.Mesh;
  /** door opening 0..1 (spring state; may overshoot) */
  open: number;
  vel: number;
  /** seconds the door stays open after the player left (then it swings shut) */
  linger: number;
  /** player was inside last frame */
  wasIn: boolean;
  /** 0..1 outline strength this frame */
  glow: number;
}

export interface CabinetFrame {
  dt: number;
  reduced: boolean;
  px: number;
  pz: number;
  /** the cabinet the player is in (null = none) and its phase */
  insideId: string | null;
  phase: 'entering' | 'open' | 'closed' | 'exiting' | null;
  /** the cabinet the sim prompts for (interactable), if any */
  promptId: string | null;
  /** the sim's door openness 0..1 while inside (null = derive from the phase) */
  door?: number | null;
}

export class CabinetSet {
  readonly root = new THREE.Group();
  readonly cabinets: CabinetRt[] = [];
  private readonly mat: THREE.MeshLambertMaterial;
  private readonly hullDim: THREE.MeshBasicMaterial;
  private readonly hullBright: THREE.MeshBasicMaterial;
  private readonly hullGeo: THREE.BufferGeometry;
  private readonly doorGeos: THREE.BufferGeometry[] = [];

  constructor(map: MapDef, theme: Theme, grade: Grade, low: boolean, skip?: ReadonlySet<string>) {
    this.mat = lambertVC();
    this.hullDim = new THREE.MeshBasicMaterial({ color: 0xffc880, side: THREE.BackSide, transparent: true, opacity: 0.3, depthWrite: false, fog: false });
    this.hullBright = new THREE.MeshBasicMaterial({ color: 0xffe0a0, side: THREE.BackSide, transparent: true, opacity: 1, depthWrite: false, fog: false });
    this.hullGeo = new THREE.BoxGeometry(CAB.W + 0.1, CAB.H + 0.08, CAB.D + 0.1);
    this.hullGeo.translate(0, CAB.H / 2 + 0.02, 0);
    this.hullGeo.deleteAttribute('uv');
    for (const h of map.hidingSpots) {
      if (h.kind !== 'cabinet') continue;
      const yaw = cabinetYaw(map, h, skip);
      const dir: 1 | -1 = hashString('hinge:' + h.id) % 2 === 0 ? 1 : -1;
      const geo = gradeGeometry(buildCabinetDoor(theme, dir, low, 'door:' + h.id), grade);
      this.doorGeos.push(geo);
      const group = new THREE.Group();
      group.position.set(h.x, 0, h.z);
      group.rotation.y = yaw;
      const pivot = new THREE.Group();
      pivot.position.set(-dir * (CAB.W / 2 - 0.05), 0, -CAB.D / 2 - 0.0);
      const door = new THREE.Mesh(geo, this.mat);
      door.position.z = -CAB.DOOR_T / 2;
      // the door is authored with its plane at z = 0; sit it just in front of the jambs
      pivot.add(door);
      const hull = new THREE.Mesh(this.hullGeo, this.hullDim);
      hull.visible = false;
      hull.frustumCulled = false;
      hull.renderOrder = 4;
      hull.scale.set(1.06, 1.035, 1.06);
      group.add(pivot, hull);
      this.root.add(group);
      this.cabinets.push({ def: h, x: h.x, z: h.z, yaw, dir, group, pivot, hull, open: 0, vel: 0, linger: 0, wasIn: false, glow: 0 });
    }
  }

  get count(): number { return this.cabinets.length; }
  byId(id: string | null | undefined): CabinetRt | undefined { return id ? this.cabinets.find((c) => c.def.id === id) : undefined; }

  /** The cabinet whose door front the player stands at (within `m`), nearest first; null if none. */
  nearest(px: number, pz: number, m: number): CabinetRt | null {
    let best: CabinetRt | null = null, bd = m;
    for (const c of this.cabinets) {
      const d = Math.hypot(c.x - px, c.z - pz);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /** Door events: `pulled_out` flings the door wide with an overshoot; `close` slams it (a small rebound at the end). */
  onEvent(spotId: string, action: 'enter' | 'close' | 'open' | 'exit' | 'pulled_out', loud: boolean): void {
    const c = this.byId(spotId);
    if (!c) return;
    if (action === 'pulled_out') { c.open = Math.max(c.open, 0.7); c.vel = 9; c.linger = 3.2; }
    else if (action === 'close' && loud) c.vel = Math.min(c.vel, -3);
    else if (action === 'open' || action === 'enter' || action === 'exit') c.linger = Math.max(c.linger, 1.6);
  }

  update(f: CabinetFrame): void {
    const dt = Math.min(f.dt, 0.05);
    for (const c of this.cabinets) {
      const inside = f.insideId === c.def.id;
      if (c.wasIn && !inside) c.linger = Math.max(c.linger, 1.5); // stepped out: the door stays open a moment, then shuts
      c.wasIn = inside;
      c.linger = Math.max(0, c.linger - dt);
      const far = Math.hypot(c.x - f.px, c.z - f.pz) > 48;
      let target = 0;
      if (inside) target = typeof f.door === 'number' ? f.door : f.phase === 'closed' ? 0 : 1;
      else if (c.linger > 0) target = 1;
      if (far && Math.abs(c.open - target) < 0.01 && Math.abs(c.vel) < 0.02) continue; // settled and far away: nothing to animate
      // damped spring: ~0.3 s to swing, a visible settle; the stop at 0 rebounds a little (a heavy door slapping shut)
      const steps = Math.max(1, Math.ceil(dt / 0.016));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const k = f.reduced ? 220 : 120, damping = f.reduced ? 30 : 15;
        c.vel += (k * (target - c.open) - damping * c.vel) * h;
        c.open += c.vel * h;
        if (c.open < 0) { c.open = 0; c.vel = f.reduced ? 0 : -c.vel * 0.3; }
      }
      c.pivot.rotation.y = c.dir * c.open * CAB.OPEN_MAX;
      // outline: only on the cabinet the sim prompts for (the player is within cabinet.useM of its door), never while inside
      const want = inside ? 0 : f.promptId === c.def.id ? 1 : 0;
      c.glow = damp(c.glow, want, 12, dt);
      c.hull.visible = c.glow > 0.04;
      if (c.hull.visible) c.hull.material = c.glow > 0.7 ? this.hullBright : this.hullDim;
    }
  }

  /** Eye pose of the hiding view for cabinet `c`: (x, y, z) in world space plus the door direction yaw. */
  eye(c: CabinetRt, out: THREE.Vector3): number {
    const lz = -CAB.D / 2 + CAB.EYE_BACK;
    out.set(c.x + lz * Math.sin(c.yaw), CAB.EYE_Y, c.z + lz * Math.cos(c.yaw));
    return c.yaw;
  }

  dispose(): void {
    this.mat.dispose(); this.hullDim.dispose(); this.hullBright.dispose(); this.hullGeo.dispose();
    for (const g of this.doorGeos) g.dispose();
  }
}

export const clampLook = (yaw: number, base: number, lim: number): number => {
  let d = yaw - base;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return base + clamp(d, -lim, lim);
};
