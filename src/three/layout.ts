// World layout shared by the static environment and the cinematic timeline.
import type { RouteId } from './types.ts';
import { lerp, smoothstep } from './util.ts';

/** Race track runs from z = 0 (start) towards -TRACK_LEN (finish gate / dock). */
export const TRACK_LEN = 240;
/** Lateral centre of the narrow shortcut corridor (the safe channel is at x = 0). */
export const SHORTCUT_X = -21;
/** Progress range over which the shortcut corridor is walled in by rocks. */
export const CORRIDOR_START = 0.2;
export const CORRIDOR_END = 0.84;
export const SAFE_HALF_WIDTH = 8;

/** Lateral position of the boat for route + progress (0..1). */
export function pathX(route: RouteId, p: number): number {
  const endFade = 1 - smoothstep(0.9, 1, p);
  const weave = (route === 'safe' ? 1.8 : 0.5) * Math.sin(p * (route === 'safe' ? 15 : 34)) * endFade;
  if (route === 'safe') return weave;
  const s = smoothstep(0.08, 0.2, p) * (1 - smoothstep(0.84, 0.93, p));
  return lerp(weave, SHORTCUT_X + weave, s);
}

export function pathZ(p: number): number {
  return -TRACK_LEN * p;
}

/** The centre line of a route as sample points (used for ribbons / previews). */
export function routeCenterline(route: RouteId, samples = 48): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i <= samples; i++) {
    const p = i / samples;
    pts.push({ x: pathX(route, p), z: pathZ(p) });
  }
  return pts;
}
