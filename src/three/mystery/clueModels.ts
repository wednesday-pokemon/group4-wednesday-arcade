// Geometry recipes for the nine clue props (three per case). Exhaustive over ClueId so a new id is a compile error.
// `lit` = lambert-lit parts, `em` = unlit emissive parts. Props sit at local origin on the ground (y = 0), roughly 0.5-1.0 m tall.
import type { ClueId } from '../../mystery/types.ts';
import type { MeshBuilder } from '../util.ts';
import { BOX, CONE4, CYL6, CYL8, ICO0, ICO1, TORUS } from './common.ts';

const NG = { gradient: 0, jitter: 0 } as const;

export function buildClueModel(clueId: ClueId, lit: MeshBuilder, em: MeshBuilder): void {
  switch (clueId) {
    case 'falsified_transfer': {
      // archive desk: dark wood slab on legs, green blotter, transfer form with a red wax seal, quill, inkwell
      lit.add(BOX, '#3b2619', [0, 0.46, 0], [0, 0.3, 0], [0.9, 0.07, 0.6], { gradient: 0.2 });
      const c = Math.cos(0.3), s = Math.sin(0.3);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) lit.add(BOX, '#2a1a10', [c * sx * 0.38 + s * sz * 0.24, 0.22, -s * sx * 0.38 + c * sz * 0.24], [0, 0.3, 0], [0.07, 0.44, 0.07], { gradient: 0.1 });
      lit.add(BOX, '#27402f', [0, 0.5, 0], [0, 0.3, 0], [0.5, 0.012, 0.36], NG);
      lit.add(BOX, '#efe5c8', [0.02, 0.512, 0], [0, 0.42, 0], [0.3, 0.012, 0.22], { gradient: 0.05, jitter: 0.02 });
      for (let i = 0; i < 4; i++) lit.add(BOX, '#2a2630', [0.02, 0.52, -0.06 + i * 0.045], [0, 0.42, 0], [0.2 - (i % 2) * 0.05, 0.003, 0.012], NG);
      lit.add(CYL8, '#8a1c24', [-0.06, 0.524, 0.07], [0, 0, 0], [0.03, 0.012, 0.03], NG);
      lit.add(CYL6, '#e8e0c8', [0.28, 0.58, -0.1], [0, 0, 1.3], [0.008, 0.28, 0.008], NG);
      lit.add(CYL6, '#1a1a28', [-0.3, 0.55, -0.12], [0, 0, 0], [0.04, 0.07, 0.04], NG);
      em.add(ICO0, '#ffd86a', [0.0, 0.8, 0], [0, 0, 0], 0.025, NG);
      break;
    }
    case 'botanical_residue': {
      // potting shelf with three violet vials, a label card and a glowing spill
      lit.add(BOX, '#5a3d2a', [0, 0.5, 0], [0, 0.2, 0], [0.8, 0.05, 0.3], { gradient: 0.2 });
      lit.add(BOX, '#3a2a1c', [-0.34, 0.25, 0.0], [0, 0.2, 0], [0.06, 0.5, 0.26], { gradient: 0.1 });
      lit.add(BOX, '#3a2a1c', [0.34, 0.25, 0.0], [0, 0.2, 0], [0.06, 0.5, 0.26], { gradient: 0.1 });
      lit.add(BOX, '#4a3322', [0, 0.25, 0], [0, 0.2, 0], [0.7, 0.03, 0.26], { gradient: 0.1 });
      for (let i = 0; i < 3; i++) {
        const x = -0.22 + i * 0.22, h = i === 1 ? 0.2 : 0.15;
        lit.add(CYL6, '#cfe0e8', [x, 0.525 + h / 2, 0.02], [0, 0, 0], [0.05, h, 0.05], NG);
        em.add(CYL6, i === 1 ? '#c08bff' : '#8b5cf6', [x, 0.53 + h * 0.4, 0.02], [0, 0, 0], [0.04, h * 0.78, 0.04], NG);
        lit.add(CYL6, '#5a3d2a', [x, 0.525 + h + 0.015, 0.02], [0, 0, 0], [0.03, 0.03, 0.03], NG);
      }
      lit.add(BOX, '#efe5c8', [0.26, 0.545, 0.14], [-0.5, 0.2, 0], [0.12, 0.003, 0.08], NG);
      em.add(ICO1, '#c08bff', [0.12, 0.528, 0.12], [0, 0, 0], [0.07, 0.006, 0.05], NG);
      break;
    }
    case 'access_ledger': {
      // lectern with a big open ledger, ribbon markers
      lit.add(BOX, '#3b2619', [0, 0.28, 0], [0, 0, 0], [0.12, 0.56, 0.12], { gradient: 0.2 });
      lit.add(BOX, '#3b2619', [0, 0.04, 0], [0, 0, 0], [0.34, 0.08, 0.34], { gradient: 0.2 });
      lit.add(BOX, '#4a3020', [0, 0.62, 0], [-0.35, 0, 0], [0.62, 0.05, 0.42], { gradient: 0.2 });
      lit.add(BOX, '#6b1e2a', [0, 0.66, 0.0], [-0.35, 0, 0], [0.56, 0.025, 0.36], NG);
      lit.add(BOX, '#efe5c8', [-0.13, 0.68, -0.005], [-0.35, 0, 0.04], [0.25, 0.02, 0.32], { gradient: 0.05, jitter: 0.02 });
      lit.add(BOX, '#efe5c8', [0.13, 0.68, -0.005], [-0.35, 0, -0.04], [0.25, 0.02, 0.32], { gradient: 0.05, jitter: 0.02 });
      for (let i = 0; i < 5; i++) {
        lit.add(BOX, '#2a2630', [-0.13, 0.692, 0.07 - i * 0.05], [-0.35, 0, 0], [0.17, 0.002, 0.01], NG);
        lit.add(BOX, '#2a2630', [0.13, 0.692, 0.07 - i * 0.05], [-0.35, 0, 0], [0.17, 0.002, 0.01], NG);
      }
      em.add(BOX, '#e0b040', [0.03, 0.705, 0.0], [-0.35, 0, 0], [0.025, 0.006, 0.36], NG);
      em.add(BOX, '#e0b040', [0.03, 0.6, 0.27], [0.5, 0, 0], [0.025, 0.006, 0.16], NG);
      break;
    }
    case 'sabotaged_gate': {
      // gate mechanism: stone footing, iron upright with a pin socket and a bent arm, chain hanging to a counterweight,
      // two chain links filed through (bright cuts) and the dropped brass pin on the floor
      lit.add(BOX, '#3a4070', [-0.1, 0.06, 0], [0, 0.2, 0], [0.7, 0.12, 0.5], { gradient: 0.3, jitter: 0.04 });
      lit.add(BOX, '#5a5f80', [-0.25, 0.55, 0], [0, 0, 0], [0.14, 0.9, 0.14], { gradient: 0.15 });
      lit.add(BOX, '#0b0b14', [-0.25, 0.35, -0.075], [0, 0, 0], [0.09, 0.14, 0.02], NG); // pin socket
      lit.add(BOX, '#5a5f80', [0.02, 1.0, 0], [0, 0, -0.12], [0.6, 0.08, 0.08], { gradient: 0.1 }); // arm
      lit.add(BOX, '#5a5f80', [0.38, 0.92, 0], [0, 0, -0.7], [0.18, 0.07, 0.07], NG); // bent, sheared end
      for (let i = 0; i < 7; i++) lit.add(TORUS, '#9aa0bc', [0.42, 0.82 - i * 0.075, 0], [0, (i % 2) * Math.PI / 2, 0], [0.04, 0.04, 0.04], NG);
      lit.add(ICO1, '#4a4a60', [0.42, 0.18, 0], [0, 0.4, 0], [0.22, 0.2, 0.22], { gradient: 0.3, jitter: 0.05 }); // counterweight
      em.add(BOX, '#fff0b0', [0.42, 0.66, 0], [0, 0.4, 0.5], [0.05, 0.012, 0.05], NG); // filed-through link
      em.add(BOX, '#fff0b0', [-0.25, 0.9, -0.075], [0, 0, 0], [0.1, 0.012, 0.01], NG); // fresh file cut on the upright
      for (let i = 0; i < 5; i++) lit.add(TORUS, '#9aa0bc', [0.0 - i * 0.1, 0.03, 0.3 + (i % 2) * 0.04], [(i % 2) * Math.PI / 2, 0.3, 0.2 * i], [0.04, 0.04, 0.04], NG);
      em.add(CYL6, '#ffc83a', [-0.4, 0.14, -0.25], [0, 0.5, Math.PI / 2], [0.016, 0.2, 0.016], NG); // dropped brass pin
      break;
    }
    case 'tunnel_access_record': {
      // lamp-room sign-in board on a post with a bracket lantern
      lit.add(BOX, '#33221a', [0, 0.5, 0], [0, 0, 0], [0.09, 1.0, 0.09], { gradient: 0.2 });
      lit.add(BOX, '#5a3d2a', [0, 0.8, -0.03], [-0.12, 0, 0], [0.62, 0.45, 0.04], { gradient: 0.2 });
      lit.add(BOX, '#efe5c8', [0, 0.8, -0.06], [-0.12, 0, 0], [0.5, 0.36, 0.01], { gradient: 0.05, jitter: 0.02 });
      for (let i = 0; i < 6; i++) lit.add(BOX, '#2a2630', [-0.03 + (i % 2) * 0.03, 0.93 - i * 0.055, -0.068], [-0.12, 0, 0], [0.34 - (i % 3) * 0.06, 0.012, 0.004], NG);
      em.add(BOX, '#6fe8ff', [0.17, 0.62, -0.068], [-0.12, 0, 0], [0.09, 0.025, 0.004], NG);
      lit.add(BOX, '#1b1d2c', [0.34, 0.98, 0], [0, 0, 0], [0.34, 0.025, 0.025], NG);
      lit.add(BOX, '#1b1d2c', [0.5, 0.8, 0], [0, 0, 0], [0.2, 0.025, 0.2], NG);
      lit.add(CONE4, '#1b1d2c', [0.5, 0.96, 0], [0, Math.PI / 4, 0], [0.16, 0.1, 0.16], NG);
      em.add(BOX, '#f5b04c', [0.5, 0.88, 0], [0, 0, 0], [0.1, 0.14, 0.1], NG);
      lit.add(BOX, '#2a2a3a', [0.2, 0.05, 0.1], [0, 0.4, 0], [0.4, 0.1, 0.3], { gradient: 0.2 });
      break;
    }
    case 'equipment_match': {
      // rolled leather tool roll on a mat, a file and a brass pin
      lit.add(BOX, '#2a1a10', [0, 0.01, 0], [0, 0.3, 0], [0.8, 0.02, 0.5], { gradient: 0.1 });
      lit.add(CYL8, '#8a5a32', [0, 0.14, 0], [0, 0.3, Math.PI / 2], [0.12, 0.5, 0.12], { gradient: 0.25 });
      lit.add(CYL8, '#b07a44', [0.24, 0.14, -0.07], [0, 0.3, Math.PI / 2], [0.1, 0.02, 0.1], NG);
      lit.add(TORUS, '#2a1a10', [0.04, 0.14, -0.01], [0, 0.3, 0], [0.13, 0.13, 0.13], NG);
      lit.add(BOX, '#aab0c8', [-0.12, 0.2, 0.26], [0, 0.9, 0.12], [0.34, 0.02, 0.035], { gradient: 0.1 });
      lit.add(BOX, '#3a2a1c', [-0.3, 0.205, 0.33], [0, 0.9, 0.12], [0.1, 0.045, 0.045], NG);
      em.add(CYL6, '#ffc83a', [0.2, 0.05, 0.3], [0, 0, Math.PI / 2], [0.016, 0.26, 0.016], NG);
      em.add(CYL6, '#ffc83a', [0.34, 0.05, 0.3], [0, 0, Math.PI / 2], [0.03, 0.02, 0.03], NG);
      lit.add(BOX, '#aab0c8', [0.1, 0.03, -0.3], [0, 0.4, 0], [0.12, 0.03, 0.05], NG);
      break;
    }
    case 'falsified_patrol_log': {
      // guard logbook on a slanted lectern, with a smudged correction and a pencil
      lit.add(BOX, '#2a2d44', [0, 0.3, 0], [0, 0, 0], [0.14, 0.6, 0.14], { gradient: 0.2 });
      lit.add(BOX, '#2a2d44', [0, 0.04, 0], [0, 0, 0], [0.4, 0.08, 0.4], { gradient: 0.2 });
      lit.add(BOX, '#3d4468', [0, 0.66, 0], [-0.4, 0, 0], [0.6, 0.04, 0.42], { gradient: 0.2 });
      lit.add(BOX, '#1e2a4a', [0, 0.69, 0], [-0.4, 0, 0], [0.5, 0.03, 0.34], NG);
      lit.add(BOX, '#e6ddc4', [0, 0.715, 0], [-0.4, 0, 0], [0.44, 0.02, 0.29], { gradient: 0.05, jitter: 0.02 });
      for (let i = 0; i < 6; i++) lit.add(BOX, '#2a2630', [-0.04 + (i % 2) * 0.03, 0.73, 0.09 - i * 0.045], [-0.4, 0, 0], [0.3 - (i % 3) * 0.06, 0.003, 0.012], NG);
      em.add(BOX, '#e0703a', [0.13, 0.735, 0.0], [-0.4, 0, 0], [0.12, 0.004, 0.04], NG);
      lit.add(BOX, '#ffd23a', [0.26, 0.66, 0.1], [0, 0.4, 0.2], [0.18, 0.012, 0.012], NG);
      break;
    }
    case 'alarm_override': {
      // security console: sloped desk with a glowing switch panel, red lever, cyan monitor
      lit.add(BOX, '#232842', [0, 0.25, 0], [0, 0, 0], [0.9, 0.5, 0.42], { gradient: 0.25 });
      lit.add(BOX, '#2e3556', [0, 0.54, 0.02], [-0.5, 0, 0], [0.9, 0.08, 0.42], { gradient: 0.2 });
      for (let i = 0; i < 6; i++) {
        const x = -0.33 + i * 0.13;
        const c = i === 2 ? '#ff4a4a' : i % 2 ? '#4fe6f2' : '#7bffb0';
        lit.add(BOX, '#10152e', [x, 0.575, 0.05], [-0.5, 0, 0], [0.09, 0.02, 0.09], NG);
        em.add(BOX, c, [x, 0.59, 0.05], [-0.5, 0, 0], [0.06, 0.02, 0.05], NG);
      }
      lit.add(CYL6, '#aab0c8', [0.33, 0.68, -0.07], [0.2, 0, 0.3], [0.015, 0.2, 0.015], NG);
      em.add(ICO0, '#ff4a4a', [0.37, 0.78, -0.05], [0, 0, 0], 0.035, NG);
      lit.add(BOX, '#10152e', [0, 0.95, -0.12], [-0.12, 0, 0], [0.7, 0.4, 0.05], NG);
      em.add(BOX, '#4fe6f2', [0, 0.95, -0.09], [-0.12, 0, 0], [0.62, 0.32, 0.005], NG);
      for (let i = 0; i < 3; i++) lit.add(BOX, '#10152e', [-0.1 + i * 0.1, 0.93, -0.086], [-0.12, 0, 0], [0.04, 0.12 + i * 0.05, 0.004], NG);
      lit.add(BOX, '#10152e', [0, 0.68, -0.14], [0, 0, 0], [0.07, 0.3, 0.05], NG);
      break;
    }
    case 'watchtower_signal': {
      // signal-lamp recorder: tripod, brass lamp drum with a gold lens, recorder box with paper tape
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.3;
        lit.add(CYL6, '#33221a', [Math.cos(a) * 0.14, 0.38, Math.sin(a) * 0.14], [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3], [0.02, 0.8, 0.02], NG);
      }
      // lamp drum points toward +X (axis along X)
      lit.add(CYL8, '#8a742f', [0, 0.84, 0], [0, 0, Math.PI / 2], [0.16, 0.32, 0.16], { gradient: 0.2 });
      em.add(CYL8, '#ffd24a', [0.165, 0.84, 0], [0, 0, Math.PI / 2], [0.13, 0.03, 0.13], NG);
      lit.add(TORUS, '#3a2a14', [0.17, 0.84, 0], [0, Math.PI / 2, 0], [0.15, 0.15, 0.15], NG);
      lit.add(BOX, '#1b1d2c', [-0.3, 0.2, 0.1], [0, 0.3, 0], [0.34, 0.4, 0.26], { gradient: 0.2 });
      lit.add(CYL8, '#aab0c8', [-0.3, 0.46, 0.1], [0, 0, Math.PI / 2], [0.07, 0.24, 0.07], { gradient: 0.1 });
      lit.add(BOX, '#efe5c8', [-0.15, 0.1, 0.25], [0, 0.6, 0.0], [0.3, 0.004, 0.06], NG);
      em.add(BOX, '#ffd24a', [-0.3, 0.26, -0.04], [0, 0.3, 0], [0.1, 0.03, 0.01], NG);
      break;
    }
    default: {
      const unhandled: never = clueId;
      void unhandled;
    }
  }
}
