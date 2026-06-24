/**
 * Deterministic, seeded pseudo-random number generator for tests.
 *
 * The entire test suite — most importantly the fuzzer — draws every random
 * decision from one of these. There is NO use of `Math.random` anywhere in
 * the tests, so a given seed always produces the exact same run. That keeps
 * CI reproducible bit-for-bit and makes any fuzz failure replayable.
 *
 * `mulberry32` is a tiny, well-known 32-bit PRNG: one mutable state word,
 * good enough statistical quality for property testing, trivially portable.
 */

export class Rng {
  private state: number;

  constructor(seed: number) {
    // Force to an unsigned 32-bit integer.
    this.state = seed >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    let a = this.state;
    a = (a + 0x6d2b79f5) | 0;
    this.state = a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** Integer in [min, max] inclusive. */
  intBetween(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  /** True with probability `p` (default 0.5). */
  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  /** Uniformly pick one element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('Rng.pick called on empty array');
    }
    return items[this.int(items.length)] as T;
  }
}

/** Convenience factory mirroring the class constructor. */
export function makeRng(seed: number): Rng {
  return new Rng(seed);
}
