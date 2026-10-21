// Default Stage 1 course: the designer's open lake (src/action/data/lake.ts → buildLakeCourse) when that module
// exists and exports it, otherwise the Phase 1 crossing. The optional glob keeps the build green either way.
import { buildCrossingCourse } from './course.ts';
import type { CourseDef } from './types.ts';

const lakeModules = import.meta.glob<{ buildLakeCourse?: () => CourseDef }>('./data/lake.ts', { eager: true });

export function hasLakeCourse(): boolean {
  return Object.values(lakeModules).some((m) => typeof m.buildLakeCourse === 'function');
}

export function defaultCourse(): CourseDef {
  const lake = Object.values(lakeModules).find((m) => typeof m.buildLakeCourse === 'function');
  return lake?.buildLakeCourse ? lake.buildLakeCourse() : buildCrossingCourse();
}
