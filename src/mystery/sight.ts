// Hyde vision: a horizontal cone (coneDeg total) with range 13 m (8 m when either end is in a fog room), × crouchRangeMult
// against a crouching target, × distractedRangeMult while distracted; blocked by walls and high cover; low cover blocks
// only a crouching target; a target hidden in a hiding spot (crouched inside it) is invisible unless the Hyde is within
// that spot's revealM.
import type { SimTuning } from './config.ts';
import { wrapAngle, yawTo, type World } from './geometry.ts';

export interface SightTarget { x: number; z: number; crouched: boolean; hiddenRevealM: number | null }
export interface Viewer { x: number; z: number; yaw: number }
export interface SightOptions { fog: boolean; distracted: boolean }

export type SightBlock = 'none' | 'range' | 'cone' | 'wall' | 'low_cover' | 'hidden';
export interface SightResult { seen: boolean; distanceM: number; rangeM: number; blockedBy: SightBlock }

export function sightRange(t: SimTuning['sight'], o: SightOptions, crouched: boolean): number {
  return (o.fog ? t.fogRangeM : t.rangeM) * (crouched ? t.crouchRangeMult : 1) * (o.distracted ? t.distractedRangeMult : 1);
}

export function canSee(world: World, t: SimTuning['sight'], v: Viewer, target: SightTarget, o: SightOptions): SightResult {
  const distanceM = Math.hypot(target.x - v.x, target.z - v.z);
  const rangeM = sightRange(t, o, target.crouched);
  if (distanceM > rangeM) return { seen: false, distanceM, rangeM, blockedBy: 'range' };
  if (distanceM > 0.05) {
    const off = Math.abs(wrapAngle(yawTo(v.x, v.z, target.x, target.z) - v.yaw));
    if (off > (t.coneDeg * Math.PI) / 360) return { seen: false, distanceM, rangeM, blockedBy: 'cone' };
  }
  if (target.hiddenRevealM !== null && distanceM > target.hiddenRevealM) return { seen: false, distanceM, rangeM, blockedBy: 'hidden' };
  if (!world.lineOfSight(v.x, v.z, target.x, target.z, false)) return { seen: false, distanceM, rangeM, blockedBy: 'wall' };
  if (target.crouched && !world.lineOfSight(v.x, v.z, target.x, target.z, true)) {
    return { seen: false, distanceM, rangeM, blockedBy: 'low_cover' };
  }
  return { seen: true, distanceM, rangeM, blockedBy: 'none' };
}
