// Stage 1 course — The Crossing. Fixed, hand-tuned layout (same for every visitor, so skill decides).
// Boat starts at z = 0 heading −Z; Raven Island's dock is at z ≈ −415. Every section leaves ≥ 8 u gaps.
import type { CourseDef, CurrentZone, FogZone, Obstacle, ObstacleKind } from './types.ts';

const DAMAGE: Record<ObstacleKind, number> = { rock: 14, log: 10, dock: 12, branch: 8, buoy: 3, debris: 6 };
const HALF_PI = Math.PI / 2;

let serial = 0;
function ob(kind: ObstacleKind, x: number, z: number, radius: number, halfLength = 0, angle = 0, drift?: Obstacle['drift']): Obstacle {
  return { id: `${kind}-${++serial}`, kind, x, z, radius, halfLength, angle, damage: DAMAGE[kind], ...(drift ? { drift } : {}) };
}

function laneBuoys(): Obstacle[] {
  const out: Obstacle[] = [];
  for (let z = -18; z >= -62; z -= 11) out.push(ob('buoy', -13, z, 0.6), ob('buoy', 13, z, 0.6));
  return out;
}

function rockField(): Obstacle[] {
  const rows: [number, number[]][] = [
    [-75, [-20, 0, 22]],
    [-92, [-31, -9, 12, 32]],
    [-110, [-19, 4, 26]],
    [-128, [-30, -6, 16]],
    [-146, [-14, 10, 33]],
    [-160, [-26, 2]],
  ];
  return rows.flatMap(([z, xs], row) => xs.map((x, i) => ob('rock', x, z + ((i + row) % 3) * 2, 2.2 + ((i * 7 + row) % 3) * 0.5)));
}

function logRun(): Obstacle[] {
  return [
    ob('log', -14, -178, 0.6, 4.5, HALF_PI),
    ob('log', 16, -190, 0.6, 4.5, HALF_PI + 0.3, { amplitude: 5, periodS: 6, phase: 0 }),
    ob('log', -4, -204, 0.6, 5, HALF_PI - 0.2, { amplitude: 7, periodS: 7, phase: 1.7 }),
    ob('log', 22, -218, 0.6, 4, HALF_PI),
    ob('log', -22, -226, 0.6, 4.5, HALF_PI + 0.4),
    ob('log', 4, -236, 0.6, 4, HALF_PI, { amplitude: 6, periodS: 5, phase: 3.1 }),
  ];
}

/** Rock walls funnel into a 13-unit channel with broken dock pieces to weave around. */
function narrowPassage(): Obstacle[] {
  const out: Obstacle[] = [];
  for (let z = -252; z >= -300; z -= 6) {
    const sway = Math.sin((z + 252) / 14) * 4;
    for (let x = -40; x <= -10; x += 6) out.push(ob('rock', x + sway, z, 3));
    for (let x = 10; x <= 40; x += 6) out.push(ob('rock', x + sway, z, 3));
  }
  out.push(ob('dock', -5, -266, 0.7, 2, HALF_PI), ob('dock', 4, -284, 0.7, 2.5, HALF_PI + 0.25));
  return out;
}

function sunkenBranches(): Obstacle[] {
  return [
    ob('branch', -24, -316, 0.45, 9, HALF_PI - 0.5),
    ob('branch', 24, -330, 0.45, 9, HALF_PI + 0.5),
    ob('branch', -22, -348, 0.45, 8, HALF_PI - 0.4),
    ob('branch', 6, -362, 0.45, 4, 0.3),
    ob('rock', 26, -362, 2.5),
    ob('branch', 22, -376, 0.45, 8, HALF_PI + 0.45),
    ob('rock', -16, -388, 2.4),
    ob('rock', 18, -398, 2.4),
  ];
}

const CURRENTS: CurrentZone[] = [{ x: 0, z: -338, radius: 22, pushX: 2.6, pushZ: 0 }];
const FOG: FogZone[] = [{ x: 0, z: -352, radius: 30, density: 0.03 }];

export function buildCrossingCourse(): CourseDef {
  serial = 0;
  return {
    id: 'crossing',
    name: 'The Crossing',
    start: { x: 0, z: 0, heading: 0 },
    finish: { x: 0, z: -415, radius: 7 },
    bounds: { minX: -42, maxX: 42, minZ: -430, maxZ: 18 },
    obstacles: [...laneBuoys(), ...rockField(), ...logRun(), ...narrowPassage(), ...sunkenBranches()],
    currents: CURRENTS,
    fog: FOG,
  };
}

export function courseProgress(course: CourseDef, z: number): number {
  return Math.max(0, Math.min(1, (course.start.z - z) / (course.start.z - course.finish.z)));
}
