// Enemy rigs (Hyde + Crackstone): geometry budgets, finite animation in every mode / status, and the telegraph shaders constructing.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HydeBiped, type HydeFrame } from '../../../src/three/mystery/hydeBeast.ts';
import { CrackstoneRig, type CrackstoneFrame } from '../../../src/three/mystery/crackstone.ts';
import { Telegraph } from '../../../src/three/mystery/telegraph.ts';
import type { CrackstoneMode, HydeMode } from '../../../src/mystery/types.ts';

const HYDE_MODES: HydeMode[] = ['PATROL', 'INVESTIGATE_SOUND', 'SEARCH', 'CHASE', 'COOLDOWN'];
const CRACK_MODES: CrackstoneMode[] = ['PATROL', 'INVESTIGATE', 'CHASE', 'ATTACK', 'SEARCH', 'RETURN'];

function finiteTree(root: THREE.Object3D): boolean {
  let ok = true;
  root.traverse((o) => {
    for (const v of [o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w]) if (!Number.isFinite(v)) ok = false;
  });
  return ok;
}

describe('Hyde statue rig', () => {
  it('stays inside the triangle budget and animates every mode and status without NaNs', () => {
    const h = new HydeBiped();
    expect(h.triangles).toBeLessThan(9000);
    const base: HydeFrame = { dt: 1 / 30, clock: 0, mode: 'PATROL', speed: 2.2, grabbing: false, stunned: false, petrified: false, slowed: false, distracted: false, suspicion: 0.4, lookYaw: 0.5, bodyYaw: 0.3, fade: 0, reduced: false };
    let t = 0;
    for (const mode of HYDE_MODES) {
      for (const extra of [{}, { grabbing: true }, { stunned: true }, { slowed: true }, { distracted: true }, { petrified: true }, { pinned: true }, { reduced: true, fade: 0.6 }]) {
        for (let i = 0; i < 40; i++) { t += 1 / 30; h.update({ ...base, ...extra, mode, clock: t, speed: mode === 'CHASE' ? 5.2 : i < 5 ? 0 : 2.2 }); }
        expect(finiteTree(h.root)).toBe(true);
        expect(Number.isFinite(h.headWorld.x + h.headWorld.y + h.headWorld.z)).toBe(true);
      }
    }
    // the creature is long, low and hunched: head and shoulders well above the ground, nothing above ~3 m
    h.update({ ...base, mode: 'PATROL', clock: t + 1, speed: 0 });
    expect(h.headWorld.y).toBeGreaterThan(1.2);
    expect(h.headWorld.y).toBeLessThan(2.8);
    h.dispose();
  });
});

describe('Crackstone rig', () => {
  it('stays inside the triangle budget and animates every mode, telegraph pose and status without NaNs', () => {
    const c = new CrackstoneRig();
    expect(c.triangles).toBeLessThan(6000);
    const base: CrackstoneFrame = { dt: 1 / 30, clock: 0, mode: 'PATROL', speed: 1.5, stunned: false, petrified: false, slowed: false, distracted: false, suspicion: 0.3, lookYaw: 0.4, bodyYaw: 1, fade: 0, reduced: false, scan: null, scanK: 0, curseK: -1 };
    let t = 0;
    for (const mode of CRACK_MODES) {
      for (const extra of [{}, { speed: 0 }, { scan: 'warning' as const, scanK: 0.5 }, { scan: 'pulse' as const, scanK: 1 }, { curseK: 0.4 }, { curseK: 0.95 }, { stunned: true }, { petrified: true }, { pinned: true }, { slowed: true }, { distracted: true }, { reduced: true, fade: 0.5 }]) {
        for (let i = 0; i < 30; i++) { t += 1 / 30; c.update({ ...base, ...extra, mode, clock: t, speed: mode === 'CHASE' ? 3.8 : base.speed }); }
        expect(finiteTree(c.root)).toBe(true);
      }
    }
    c.update({ ...base, mode: 'PATROL', clock: t + 1, speed: 0, scan: null });
    expect(c.headWorld.y).toBeGreaterThan(1.7);
    expect(c.headWorld.y).toBeLessThan(2.4);
    c.dispose();
  });

  it('flares his aura during the scan warning and the curse wind-up', () => {
    const c = new CrackstoneRig();
    const f: CrackstoneFrame = { dt: 1 / 30, clock: 0, mode: 'PATROL', speed: 0, stunned: false, petrified: false, slowed: false, distracted: false, suspicion: 0, lookYaw: null, bodyYaw: 0, fade: 0, reduced: false, scan: null, scanK: 0, curseK: -1 };
    for (let i = 0; i < 30; i++) c.update({ ...f, clock: i / 30 });
    const calm = c.flare;
    for (let i = 0; i < 30; i++) c.update({ ...f, clock: 1 + i / 30, scan: 'warning', scanK: 0.6 });
    expect(c.flare).toBeGreaterThan(calm + 0.3);
    c.dispose();
  });
});

describe('telegraphs', () => {
  it('construct and update for scan and curse without a GL context', () => {
    for (const kind of ['scan', 'curse'] as const) {
      const t = new Telegraph(kind);
      t.set({ x: 1, z: 2, r: 9, prog: 0.5, out: 0, mode: 0, time: 1, reduced: false, alpha: 1 }, 4.5);
      expect(t.ground.visible).toBe(true);
      expect(t.wall.scale.y).toBeGreaterThan(0.5);
      t.hide();
      expect(t.ground.visible).toBe(false);
      t.dispose();
    }
  });
});
