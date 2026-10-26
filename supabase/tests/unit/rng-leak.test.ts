// Regression test for docs/SECURITY.md T-06b. The pre-release keyedUniform (FNV-1a + murmur3 fmix) let two revealed
// leg-1 draws predict every later draw. The engine now uses a SHA-256 keyed PRF (src/game/sha256.ts); this test keeps
// the original attack and asserts it fails. Server-side draw redaction while in progress is kept as defence in depth.
import { describe, expect, it } from 'vitest';
import { deriveLegDraws, keyedUniform } from '../../functions/_shared/game/index.ts';

const P = 0x01000193;
const invMul = (a: number) => {
  let x = a;
  for (let i = 0; i < 5; i++) x = Math.imul(x, 2 - Math.imul(a, x)) >>> 0;
  return x;
};
const P_INV = invMul(P);
const unxorshift = (h: number, s: number) => {
  let r = h;
  for (let i = 0; i < 32 / s + 1; i++) r = (h ^ (r >>> s)) >>> 0;
  return r;
};
const fmix = (h: number) => {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};
const fmixInv = (h: number) => {
  h = unxorshift(h, 16); h = Math.imul(h, invMul(0xc2b2ae35)) >>> 0;
  h = unxorshift(h, 13); h = Math.imul(h, invMul(0x85ebca6b)) >>> 0;
  return unxorshift(h, 16) >>> 0;
};
const forward = (s: number, t: string) => {
  let h = s;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), P);
  return h >>> 0;
};
const backward = (h: number, t: string) => {
  for (let i = t.length - 1; i >= 0; i--) h = (Math.imul(h, P_INV) ^ t.charCodeAt(i)) >>> 0;
  return h;
};
const split = (u: number) => {
  const n = Math.round(u * 2 ** 53);
  return { hi: Math.floor(n / 2 ** 26), lo: n % 2 ** 26 };
};

/** Attacker: only sees leg-1 crash and eggFailure draws (as LegResolution.draws would reveal). */
function recoverPredictor(crash: number, eggFailure: number) {
  const states = (part: 'hi' | 'lo') => {
    const free = part === 'hi' ? 5 : 6;
    const top = split(crash)[part];
    const out: number[] = [];
    for (let k = 0; k < 1 << free; k++) out.push(backward(fmixInv(((top << free) | k) >>> 0), '|L1:crash'));
    return out.filter((s) => fmix(forward(s, '|L1:egg_failure')) >>> free === split(eggFailure)[part]);
  };
  const [s1] = states('hi');
  const [s2] = states('lo');
  return (key: string) =>
    ((fmix(forward(s1, `|${key}`)) >>> 5) * 67108864 + (fmix(forward(s2, `|${key}`)) >>> 6)) / 9007199254740992;
}

describe('T-06b: revealed draws must NOT predict the rest of the session (SHA-256 keyed PRF, DECISIONS D-19)', () => {
  it('the FNV/murmur state-recovery attack that broke the v2.5 pre-release RNG no longer predicts any future draw', () => {
    let predicted = 0;
    for (let i = 0; i < 25; i++) {
      const seed = Array.from({ length: 32 }, (_, j) => ((i * 7 + j * 13) % 16).toString(16)).join('');
      const d1 = deriveLegDraws(seed, 1);
      const keys = ['L2:weather', 'L2:egg:safe', 'L2:egg:shortcut', 'L2:crash', 'L2:hyde', 'L3:weather', 'L3:hyde'];
      try {
        const predict = recoverPredictor(d1.crash, d1.eggFailure);
        if (keys.some((k) => predict(k) === keyedUniform(seed, k))) predicted++;
      } catch {
        // attack could not even recover a candidate state
      }
    }
    expect(predicted).toBe(0);
  });
});
