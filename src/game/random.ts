// Keyed deterministic RNG (SHA-256 PRF). Each named draw is an independent pure function of (seed, key), so a skipped
// conditional roll never shifts later draws. Pure 32-bit integer math: identical in browsers, Node and Deno.
import { EGG_TABLE, EGG_TIER_ORDER, WEATHER, WEATHER_ORDER } from './constants.ts';
import { sha256Words } from './sha256.ts';
import type { EggTier, LegContext, LegDraws, LegIndex, RouteId, WeatherId } from './types.ts';

function hash32(text: string, salt: number): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  }
  // murmur3 finalizer for avalanche
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Uniform float in [0, 1) with 53 bits, keyed by seed and draw name via SHA-256 (a PRF for a secret 128-bit seed),
 * so revealed draws cannot be used to recover the seed or predict other draws (DECISIONS D-19).
 */
export function keyedUniform(seed: string, key: string): number {
  const words = sha256Words(`raven-regatta|${seed}|${key}`);
  const hi = words[0] >>> 5; // 27 bits
  const lo = words[1] >>> 6; // 26 bits
  return (hi * 67108864 + lo) / 9007199254740992;
}

/** Inverse-CDF categorical pick in a fixed category order. */
export function pickCategorical<T extends string>(u: number, order: readonly T[], weights: Record<T, number>): T {
  let cumulative = 0;
  for (const item of order) {
    cumulative += weights[item];
    if (u < cumulative) return item;
  }
  // Floating-point tail: return the last category with non-zero weight.
  for (let i = order.length - 1; i >= 0; i--) if (weights[order[i]] > 0) return order[i];
  return order[order.length - 1];
}

export const DRAW_KEYS = {
  weather: (leg: LegIndex) => `L${leg}:weather`,
  egg: (leg: LegIndex, route: RouteId) => `L${leg}:egg:${route}`,
  crash: (leg: LegIndex) => `L${leg}:crash`,
  eggFailure: (leg: LegIndex) => `L${leg}:egg_failure`,
  hyde: (leg: LegIndex) => `L${leg}:hyde`,
} as const;

const WEATHER_WEIGHTS = Object.fromEntries(WEATHER_ORDER.map((w) => [w, WEATHER[w].probability])) as Record<WeatherId, number>;

export function weatherFromUniform(u: number): WeatherId {
  return pickCategorical(u, WEATHER_ORDER, WEATHER_WEIGHTS);
}

export function eggTierFromUniform(u: number, route: RouteId, leg: LegIndex): EggTier {
  return pickCategorical(u, EGG_TIER_ORDER, EGG_TABLE[route][leg]);
}

/** Trusted leg context (weather + both route offers) derived only from the secret seed. Stable across calls. */
export function deriveLegContext(seed: string, leg: LegIndex): LegContext {
  return {
    legIndex: leg,
    weather: weatherFromUniform(keyedUniform(seed, DRAW_KEYS.weather(leg))),
    offers: {
      safe: eggTierFromUniform(keyedUniform(seed, DRAW_KEYS.egg(leg, 'safe')), 'safe', leg),
      shortcut: eggTierFromUniform(keyedUniform(seed, DRAW_KEYS.egg(leg, 'shortcut')), 'shortcut', leg),
    },
  };
}

export function deriveLegDraws(seed: string, leg: LegIndex): LegDraws {
  return {
    crash: keyedUniform(seed, DRAW_KEYS.crash(leg)),
    eggFailure: keyedUniform(seed, DRAW_KEYS.eggFailure(leg)),
    hyde: keyedUniform(seed, DRAW_KEYS.hyde(leg)),
  };
}

/** Small seedable PRNG stream (mulberry32) for simulations and the advisor — never for trusted session rolls. */
export function createStream(seed: string): () => number {
  let state = hash32(seed, 0x2545f491);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Non-cryptographic public commitment helper for LOCAL DEMO only; live mode uses SHA-256 on the server. */
export function demoCommitment(seed: string): string {
  return `${hash32(seed, 1).toString(16).padStart(8, '0')}${hash32(seed, 2).toString(16).padStart(8, '0')}`;
}
