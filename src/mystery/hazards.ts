// Case hazards (docs/overhaul/OVERHAUL_CONTRACT.md "Sim rules" 5). Pure helpers + the per-run searchlight tracker.
//
//   noisy_floor  while WALKING or SPRINTING inside the polygon, each footstep's final loudness += loudnessAdd (after the
//                stance / carry / mods / wet / boost multipliers, then clamped to 1). Crouching is unaffected. Overlapping
//                floors do not stack: the largest loudnessAdd applies. The first loud step after entering a floor emits
//                `hazard_triggered` (telemetry for the diagnostic "the glass floor made your steps louder").
//   searchlight  beam yaw at sim time t = phase + 2π·t / periodS (contract yaw: 0 faces −Z, positive turns left; a negative
//                periodS turns clockwise). A NOT-hidden player within rangeM, inside coneDeg/2 of the beam, with line of
//                sight from the light (walls + high cover; low cover too when the player crouches) → `hazard_triggered`
//                then a 'hazard' noise of `loudness` at the player, at most once per cooldownS per light.
// The renderer draws the beam with `searchlightYaw(h, run.t)` so the picture and the rule agree exactly.
import { pointInPolygon, wrapAngle, yawTo, type World } from './geometry.ts';
import type { HazardDef } from './types.ts';

export type SearchlightHazard = Extract<HazardDef, { kind: 'searchlight' }>;
export type NoisyFloorHazard = Extract<HazardDef, { kind: 'noisy_floor' }>;

/** Beam yaw (radians, wrapped to (−π, π]) at sim time `t`. */
export function searchlightYaw(h: Pick<SearchlightHazard, 'phase' | 'periodS'>, t: number): number {
  if (!Number.isFinite(h.periodS) || h.periodS === 0) return wrapAngle(h.phase);
  return wrapAngle(h.phase + (2 * Math.PI * t) / h.periodS);
}

/** Is (x, z) inside the beam's cone and range at time t (geometry only, no line of sight)? */
export function inSearchlightCone(h: SearchlightHazard, t: number, x: number, z: number): boolean {
  const d = Math.hypot(x - h.x, z - h.z);
  if (d > h.rangeM) return false;
  if (d < 0.05) return true;
  const off = Math.abs(wrapAngle(yawTo(h.x, h.z, x, z) - searchlightYaw(h, t)));
  return off <= (h.coneDeg * Math.PI) / 360;
}

/** The full rule: in cone + range, not hidden, line of sight from the light (low cover counts for a crouching player). */
export function searchlightSees(world: World, h: SearchlightHazard, t: number, p: { x: number; z: number; crouched: boolean; hidden: boolean }): boolean {
  if (p.hidden) return false;
  if (!inSearchlightCone(h, t, p.x, p.z)) return false;
  return world.lineOfSight(h.x, h.z, p.x, p.z, p.crouched);
}

/**
 * Seconds until the beam next covers the bearing from the light to (x, z) (0 if it covers it now; Infinity for a beam that
 * does not turn and is not on it). Range and line of sight are not considered. Used by the bot to wait for the beam.
 */
export function searchlightEtaS(h: SearchlightHazard, t: number, x: number, z: number): number {
  const half = (h.coneDeg * Math.PI) / 360;
  const theta = yawTo(h.x, h.z, x, z);
  const yaw = searchlightYaw(h, t);
  if (Math.abs(wrapAngle(theta - yaw)) <= half) return 0;
  if (!Number.isFinite(h.periodS) || h.periodS === 0) return Infinity;
  const omega = (2 * Math.PI) / h.periodS;
  const TAU = 2 * Math.PI;
  const mod = (a: number) => ((a % TAU) + TAU) % TAU;
  return omega > 0 ? mod(theta - half - yaw) / omega : mod(yaw - (theta + half)) / -omega;
}

/** The noisy floor under (x, z) with the largest loudnessAdd, or null. */
export function noisyFloorAt(hazards: readonly HazardDef[] | undefined, x: number, z: number): NoisyFloorHazard | null {
  let best: NoisyFloorHazard | null = null;
  if (!hazards) return null;
  for (const h of hazards) {
    if (h.kind !== 'noisy_floor') continue;
    if (!pointInPolygon(x, z, h.polygon)) continue;
    if (!best || h.loudnessAdd > best.loudnessAdd) best = h;
  }
  return best;
}

export function searchlightsOf(hazards: readonly HazardDef[] | undefined): SearchlightHazard[] {
  return (hazards ?? []).filter((h): h is SearchlightHazard => h.kind === 'searchlight');
}
