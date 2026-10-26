// Sound model: loudness (0..1) → hearing radius through the tuning knots (crouch 0.10 → 2 m, walk 0.35 → 7 m, sprint
// 0.95 → 13 m, egg drop 1.0 → 17 m). A listener hears a source if its distance is within the radius after occlusion:
// each wall on the straight line (up to maxOccludingWalls) multiplies the radius by wallOcclusionMult; high cover by
// coverOcclusionMult; the listener's own multiplier (e.g. COOLDOWN hearing) scales the result.
import type { SimTuning } from './config.ts';
import type { World } from './geometry.ts';

export function hearingRadius(loudness: number, knots: readonly (readonly [number, number])[]): number {
  const l = Math.min(1, Math.max(0, loudness));
  if (l <= 0) return 0;
  for (let i = 1; i < knots.length; i++) {
    const [l1, r1] = knots[i];
    if (l <= l1) {
      const [l0, r0] = knots[i - 1];
      return l1 > l0 ? r0 + ((r1 - r0) * (l - l0)) / (l1 - l0) : r1;
    }
  }
  return knots[knots.length - 1][1];
}

export interface Hearing {
  heard: boolean;
  distanceM: number;
  radiusM: number; // un-occluded radius
  effectiveRadiusM: number; // after occlusion and listener multiplier
  occluded: boolean;
  walls: number;
}

export function hear(
  world: World, tuning: SimTuning['noise'], loudness: number, sx: number, sz: number, lx: number, lz: number, listenerMult = 1,
): Hearing {
  const radiusM = hearingRadius(loudness, tuning.knots);
  const distanceM = Math.hypot(sx - lx, sz - lz);
  if (radiusM * listenerMult <= 0 || distanceM > radiusM * listenerMult) {
    return { heard: false, distanceM, radiusM, effectiveRadiusM: radiusM * listenerMult, occluded: false, walls: 0 };
  }
  const b = world.blockersOn(sx, sz, lx, lz);
  const walls = Math.min(b.walls, tuning.maxOccludingWalls);
  const occluded = b.walls + b.cover > 0;
  const effectiveRadiusM = radiusM * listenerMult * tuning.wallOcclusionMult ** walls * tuning.coverOcclusionMult ** b.cover;
  return { heard: distanceM <= effectiveRadiusM, distanceM, radiusM, effectiveRadiusM, occluded, walls: b.walls };
}
