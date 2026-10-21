// Encounter director: fires each course trigger once (calm / disturbance / hyde_emerge / surge / safe_harbour) when
// the boat enters its radius — or, on an open lake where the player may take another route, once their best
// progress passes the trigger's own progress by a small margin. Courses without triggers (the Phase 1 crossing) get
// a synthetic progress-based script so the Hyde still appears. The run applies the consequences.
import { RUN } from './config.ts';
import { STAGE_TUNING } from './data/stages.ts';
import type { CourseDef, EncounterKind, EncounterTrigger } from './types.ts';

export interface ArmedTrigger { def: EncounterTrigger; progress: number; fallbackProgress: number; fired: boolean }

/** 0..1 straight-line progress of a point from the start toward the dock. */
export function progressAt(course: CourseDef, x: number, z: number): number {
  const total = Math.hypot(course.start.x - course.finish.x, course.start.z - course.finish.z);
  if (total <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - Math.hypot(x - course.finish.x, z - course.finish.z) / total));
}

function syntheticTriggers(course: CourseDef): EncounterTrigger[] {
  const at = (p: number) => ({
    x: course.start.x + (course.finish.x - course.start.x) * p,
    z: course.start.z + (course.finish.z - course.start.z) * p,
  });
  const mk = (id: string, kind: EncounterKind, p: number): EncounterTrigger => ({ id, kind, ...at(p), radius: 0 });
  return [
    mk('auto-calm', 'calm', 0),
    mk('auto-disturbance', 'disturbance', RUN.fallbackDisturbanceProgress),
    mk('auto-emerge', 'hyde_emerge', RUN.fallbackEmergeProgress),
    ...STAGE_TUNING.hyde.stage1.surgeAtProgress.map((p, i) => mk(`auto-surge-${i + 1}`, 'surge', p)),
    mk('auto-harbour', 'safe_harbour', RUN.fallbackSafeHarbourProgress),
  ];
}

export class EncounterDirector {
  readonly triggers: ArmedTrigger[];
  readonly synthetic: boolean;

  constructor(course: CourseDef) {
    const authored = course.encounters ?? [];
    this.synthetic = authored.length === 0;
    const defs = this.synthetic ? syntheticTriggers(course) : authored;
    this.triggers = defs
      .map((def) => {
        const progress = progressAt(course, def.x, def.z);
        // a calm trigger at the start fires immediately; synthetic triggers are pure progress marks
        const margin = this.synthetic || def.kind === 'calm' ? 0 : RUN.encounterProgressMargin;
        const fallbackProgress = def.kind === 'safe_harbour' ? Math.min(0.99, progress + margin) : Math.min(1, progress + margin);
        return { def, progress, fallbackProgress, fired: false };
      })
      .sort((a, b) => a.progress - b.progress);
  }

  /** Triggers that fire this step (in course order). */
  update(x: number, z: number, bestProgress: number): EncounterTrigger[] {
    const out: EncounterTrigger[] = [];
    for (const a of this.triggers) {
      if (a.fired) continue;
      const inside = a.def.radius > 0 && Math.hypot(x - a.def.x, z - a.def.z) <= a.def.radius;
      if (inside || bestProgress >= a.fallbackProgress) {
        a.fired = true;
        out.push(a.def);
      }
    }
    return out;
  }

  /** Force the first unfired trigger of a kind (time fallbacks). Returns it, or null if none is left. */
  force(kind: EncounterKind): EncounterTrigger | null {
    const a = this.triggers.find((x) => !x.fired && x.def.kind === kind);
    if (!a) return null;
    a.fired = true;
    return a.def;
  }

  hasFired(kind: EncounterKind): boolean {
    return this.triggers.some((x) => x.fired && x.def.kind === kind);
  }
}
