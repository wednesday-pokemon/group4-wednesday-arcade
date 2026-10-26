import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../../src/game/sha256.ts';
import { keyedUniform } from '../../../src/game/random.ts';

describe('pure SHA-256 used by the keyed RNG', () => {
  it('matches FIPS 180-4 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches node:crypto for many lengths and unicode input', () => {
    for (let n = 0; n < 200; n++) {
      const text = `Pokémon-${'x'.repeat(n)}-${n}`;
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
  });

  it('keyedUniform stays in [0, 1) and is stable', () => {
    const a = keyedUniform('seed', 'L1:crash');
    expect(a).toBe(keyedUniform('seed', 'L1:crash'));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });
});
