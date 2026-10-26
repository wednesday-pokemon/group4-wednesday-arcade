// Geometry recipes for the nine evidence items (three per case). Exhaustive over ClueId so a new id is a compile error.
// The furniture they rest on is the SITE prop (siteProps.ts) — an item is just a small object (about 0.3 m) lying on / sticking out of
// it, drawn only once the player may know the clue is there. `lit` = lambert-lit parts, `em` = unlit emissive parts. Origin = item base.
import type { ClueId } from '../../mystery/types.ts';
import type { MeshBuilder } from '../util.ts';
import { BOX, CONE4, CYL6, CYL8, ICO0, TORUS } from './common.ts';

const NG = { gradient: 0, jitter: 0 } as const;

export function buildClueModel(clueId: ClueId, lit: MeshBuilder, em: MeshBuilder): void {
  switch (clueId) {
    case 'falsified_transfer': {
      // transfer form with a red wax seal and a second, slightly crooked sheet under it
      lit.add(BOX, '#e8dcc0', [0.02, 0.012, 0.02], [0, -0.35, 0], [0.34, 0.02, 0.25], { gradient: 0.05, jitter: 0.02 });
      lit.add(BOX, '#efe5c8', [0, 0.03, 0], [0, 0.22, 0], [0.34, 0.02, 0.25], { gradient: 0.05, jitter: 0.02 });
      for (let i = 0; i < 4; i++) lit.add(BOX, '#2a2630', [0.0, 0.043, -0.07 + i * 0.045], [0, 0.22, 0], [0.22 - (i % 2) * 0.05, 0.003, 0.012], NG);
      lit.add(CYL8, '#8a1c24', [-0.07, 0.048, 0.07], [0, 0, 0], [0.032, 0.014, 0.032], NG);
      em.add(BOX, '#ff6a5a', [0.1, 0.045, -0.06], [0, 0.22, 0], [0.07, 0.005, 0.02], NG);
      break;
    }
    case 'botanical_residue': {
      // three violet vials, a label card and a glowing spill
      for (let i = 0; i < 3; i++) {
        const x = -0.12 + i * 0.12, h = i === 1 ? 0.2 : 0.15;
        lit.add(CYL6, '#cfe0e8', [x, h / 2, 0.02], [0, 0, 0], [0.04, h, 0.04], NG);
        em.add(CYL6, i === 1 ? '#c08bff' : '#8b5cf6', [x, h * 0.4, 0.02], [0, 0, 0], [0.032, h * 0.74, 0.032], NG);
        lit.add(CYL6, '#5a3d2a', [x, h + 0.015, 0.02], [0, 0, 0], [0.026, 0.03, 0.026], NG);
      }
      lit.add(BOX, '#efe5c8', [0.16, 0.012, 0.1], [0, 0.4, 0], [0.12, 0.012, 0.08], NG);
      em.add(ICO0, '#c08bff', [0.02, 0.008, 0.11], [0, 0, 0], [0.09, 0.008, 0.06], NG);
      break;
    }
    case 'access_ledger': {
      // open ledger with ribbon markers
      lit.add(BOX, '#6b1e2a', [0, 0.02, 0], [0, 0, 0], [0.5, 0.04, 0.34], { gradient: 0.1 });
      lit.add(BOX, '#efe5c8', [-0.12, 0.055, 0], [0, 0, 0.05], [0.22, 0.03, 0.3], { gradient: 0.05, jitter: 0.02 });
      lit.add(BOX, '#efe5c8', [0.12, 0.055, 0], [0, 0, -0.05], [0.22, 0.03, 0.3], { gradient: 0.05, jitter: 0.02 });
      for (let i = 0; i < 5; i++) {
        lit.add(BOX, '#2a2630', [-0.12, 0.074, 0.08 - i * 0.045], [0, 0, 0.05], [0.16, 0.003, 0.01], NG);
        lit.add(BOX, '#2a2630', [0.12, 0.074, 0.08 - i * 0.045], [0, 0, -0.05], [0.16, 0.003, 0.01], NG);
      }
      em.add(BOX, '#e0b040', [0.02, 0.078, 0.0], [0, 0, 0], [0.02, 0.005, 0.3], NG);
      em.add(BOX, '#e0b040', [0.02, 0.03, 0.2], [0.4, 0, 0], [0.02, 0.005, 0.14], NG);
      break;
    }
    case 'sabotaged_gate': {
      // sheared brass pin, a few filed-through chain links and a bright file cut
      em.add(CYL6, '#ffc83a', [-0.05, 0.03, 0.04], [0, 0.5, Math.PI / 2], [0.02, 0.26, 0.02], NG);
      em.add(CYL6, '#ffc83a', [0.1, 0.03, 0.04], [0, 0.5, Math.PI / 2], [0.034, 0.025, 0.034], NG);
      for (let i = 0; i < 5; i++) lit.add(TORUS, '#9aa0bc', [-0.04 - i * 0.075, 0.025, -0.1 + (i % 2) * 0.04], [(i % 2) * Math.PI / 2, 0.3, 0.2 * i], [0.04, 0.04, 0.04], NG);
      em.add(BOX, '#fff0b0', [-0.34, 0.03, -0.08], [0, 0.6, 0.5], [0.05, 0.012, 0.05], NG);
      lit.add(BOX, '#aab0c8', [0.1, 0.02, -0.12], [0, 0.4, 0], [0.18, 0.02, 0.035], NG);
      break;
    }
    case 'tunnel_access_record': {
      // sign-in clipboard with a cyan tick
      lit.add(BOX, '#5a3d2a', [0, 0.02, 0], [0, 0.15, 0], [0.3, 0.025, 0.4], { gradient: 0.1 });
      lit.add(BOX, '#efe5c8', [0, 0.04, 0.0], [0, 0.15, 0], [0.26, 0.012, 0.35], { gradient: 0.05, jitter: 0.02 });
      for (let i = 0; i < 6; i++) lit.add(BOX, '#2a2630', [-0.02 + (i % 2) * 0.03, 0.048, -0.13 + i * 0.05], [0, 0.15, 0], [0.18 - (i % 3) * 0.04, 0.003, 0.01], NG);
      lit.add(BOX, '#1b1d2c', [0, 0.05, -0.18], [0, 0.15, 0], [0.12, 0.03, 0.05], NG);
      em.add(BOX, '#6fe8ff', [0.07, 0.05, 0.09], [0, 0.15, 0], [0.07, 0.006, 0.02], NG);
      break;
    }
    case 'equipment_match': {
      // rolled leather tool roll, a file and a brass pin
      lit.add(CYL8, '#8a5a32', [0, 0.06, 0], [0, 0.3, Math.PI / 2], [0.06, 0.34, 0.06], { gradient: 0.25 });
      lit.add(CYL8, '#b07a44', [0.17, 0.06, -0.05], [0, 0.3, Math.PI / 2], [0.05, 0.015, 0.05], NG);
      lit.add(BOX, '#aab0c8', [-0.08, 0.02, 0.17], [0, 0.9, 0.12], [0.26, 0.015, 0.03], { gradient: 0.1 });
      em.add(CYL6, '#ffc83a', [0.1, 0.02, 0.15], [0, 0, Math.PI / 2], [0.014, 0.18, 0.014], NG);
      em.add(CYL6, '#ffc83a', [0.2, 0.02, 0.15], [0, 0, Math.PI / 2], [0.026, 0.016, 0.026], NG);
      break;
    }
    case 'falsified_patrol_log': {
      // guard logbook with a smudged correction and a pencil
      lit.add(BOX, '#1e2a4a', [0, 0.025, 0], [0, 0.2, 0], [0.34, 0.05, 0.25], { gradient: 0.1 });
      lit.add(BOX, '#e6ddc4', [0, 0.055, 0], [0, 0.2, 0], [0.3, 0.02, 0.21], { gradient: 0.05, jitter: 0.02 });
      for (let i = 0; i < 5; i++) lit.add(BOX, '#2a2630', [-0.02 + (i % 2) * 0.03, 0.067, -0.07 + i * 0.035], [0, 0.2, 0], [0.2 - (i % 3) * 0.04, 0.003, 0.01], NG);
      em.add(BOX, '#e0703a', [0.08, 0.069, 0.0], [0, 0.2, 0], [0.09, 0.004, 0.035], NG);
      lit.add(BOX, '#ffd23a', [0.2, 0.012, 0.1], [0, 0.4, 0.2], [0.17, 0.012, 0.012], NG);
      break;
    }
    case 'alarm_override': {
      // override key-panel: three switches, one red lever
      lit.add(BOX, '#232842', [0, 0.05, 0], [0, 0, 0], [0.34, 0.1, 0.22], { gradient: 0.2 });
      for (let i = 0; i < 3; i++) {
        lit.add(BOX, '#10152e', [-0.1 + i * 0.1, 0.105, 0.03], [0, 0, 0], [0.07, 0.02, 0.07], NG);
        em.add(BOX, i === 1 ? '#ff4a4a' : '#7bffb0', [-0.1 + i * 0.1, 0.12, 0.03], [0, 0, 0], [0.04, 0.02, 0.04], NG);
      }
      lit.add(CYL6, '#aab0c8', [0.12, 0.17, -0.05], [0.25, 0, 0.3], [0.012, 0.15, 0.012], NG);
      em.add(ICO0, '#ff4a4a', [0.15, 0.25, -0.03], [0, 0, 0], 0.03, NG);
      break;
    }
    case 'watchtower_signal': {
      // signal-lamp recorder: brass drum with a gold lens, paper tape
      lit.add(CYL8, '#8a742f', [0, 0.1, 0], [0, 0, Math.PI / 2], [0.1, 0.22, 0.1], { gradient: 0.2 });
      em.add(CYL8, '#ffd24a', [0.115, 0.1, 0], [0, 0, Math.PI / 2], [0.08, 0.02, 0.08], NG);
      lit.add(TORUS, '#3a2a14', [0.12, 0.1, 0], [0, Math.PI / 2, 0], [0.09, 0.09, 0.09], NG);
      lit.add(BOX, '#1b1d2c', [-0.08, 0.04, 0.12], [0, 0.3, 0], [0.22, 0.08, 0.16], { gradient: 0.2 });
      lit.add(BOX, '#efe5c8', [0.06, 0.008, 0.2], [0, 0.6, 0.0], [0.26, 0.004, 0.05], NG);
      em.add(CONE4, '#ffd24a', [-0.08, 0.1, 0.12], [0, Math.PI / 4, 0], [0.025, 0.04, 0.025], NG);
      break;
    }
    default: {
      const unhandled: never = clueId;
      void unhandled;
    }
  }
  void CYL8;
}
