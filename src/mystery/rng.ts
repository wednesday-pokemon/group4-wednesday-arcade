// Deterministic random streams for the mystery sim and bots. Seed string → SHA-256 (128 bits) → sfc32 stream.
// Never Math.random: the same (seed, key) always yields the same sequence in browsers, Node and Deno.
import { prfUniform, prfWords128 } from './prf.ts';

export { prfUniform };

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: string, key = 'stream') {
    [this.a, this.b, this.c, this.d] = prfWords128(seed, key);
    if ((this.a | this.b | this.c | this.d) === 0) this.d = 1;
    for (let i = 0; i < 12; i++) this.nextU32(); // warm-up
  }

  nextU32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }
}
