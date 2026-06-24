/**
 * A `CharSet` is the engine's single primitive for "matches one input symbol".
 * Literal characters, the dot, character classes `[...]`, and the convenience
 * classes `\d \w \s \D \W \S` are ALL represented as a `CharSet`. That uniformity
 * is what lets the NFA carry one transition type ("epsilon or a CharSet") and
 * lets the DFA builder derive its alphabet by intersecting these sets.
 *
 * Representation: a sorted list of disjoint inclusive code-point intervals
 * `[lo, hi]`. The universe is the UTF-16 code-unit space [0, 0xFFFF] — the same
 * space the host `RegExp` operates over WITHOUT the `u` flag, which is exactly
 * the oracle the engine is validated against. (`String.prototype.charCodeAt`
 * returns 16-bit code units; surrogate pairs count as two units on both sides.)
 *
 * The asymmetry the spec demands falls out naturally here:
 *   - `.`        = complement of {LF, CR, LS, PS}           (excludes the 4 terminators)
 *   - `[^...]`   = complement of the listed members         (INCLUDES the 4 terminators)
 */

/** Largest UTF-16 code unit. The matching universe is [0, CP_MAX]. */
export const CP_MAX = 0xffff;

export type Interval = readonly [number, number];

/** The four line terminators that `.` excludes (but `[^...]` does not). */
export const LINE_TERMINATORS: readonly number[] = [
  0x000a, // LF
  0x000d, // CR
  0x2028, // LS
  0x2029, // PS
];

/** Sort and merge a list of intervals into a canonical disjoint form. */
function normalize(raw: readonly Interval[]): Interval[] {
  const valid = raw.filter(([lo, hi]) => lo <= hi);
  if (valid.length === 0) return [];
  const sorted = [...valid].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Array<[number, number]> = [];
  for (const [lo, hi] of sorted) {
    const last = out[out.length - 1];
    // Merge overlapping OR adjacent intervals (hi + 1 === lo).
    if (last && lo <= last[1] + 1) {
      if (hi > last[1]) last[1] = hi;
    } else {
      out.push([lo, hi]);
    }
  }
  return out;
}

export class CharSet {
  readonly intervals: readonly Interval[];

  constructor(intervals: readonly Interval[]) {
    this.intervals = normalize(intervals);
  }

  /** Does this set match the given code point? Binary search over intervals. */
  test(cp: number): boolean {
    let lo = 0;
    let hi = this.intervals.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const iv = this.intervals[mid];
      if (iv === undefined) break;
      if (cp < iv[0]) hi = mid - 1;
      else if (cp > iv[1]) lo = mid + 1;
      else return true;
    }
    return false;
  }

  /** True if this set matches no code point at all. */
  isEmpty(): boolean {
    return this.intervals.length === 0;
  }

  /** Complement over the full universe [0, CP_MAX]. */
  complement(): CharSet {
    const out: Array<[number, number]> = [];
    let next = 0;
    for (const [lo, hi] of this.intervals) {
      if (lo > next) out.push([next, lo - 1]);
      next = hi + 1;
      if (next > CP_MAX) break;
    }
    if (next <= CP_MAX) out.push([next, CP_MAX]);
    return new CharSet(out);
  }

  /**
   * Code points at which membership *may* change — the left edges and the
   * point just past each right edge. The DFA builder collects these across all
   * CharSets to carve the universe into elementary intervals.
   */
  boundaries(): number[] {
    const out: number[] = [];
    for (const [lo, hi] of this.intervals) {
      out.push(lo);
      if (hi + 1 <= CP_MAX) out.push(hi + 1);
    }
    return out;
  }

  /** A stable string key for deduplication / equality. */
  key(): string {
    return this.intervals.map(([lo, hi]) => `${lo}-${hi}`).join(',');
  }

  /** Union of several CharSets. */
  static union(sets: readonly CharSet[]): CharSet {
    const all: Interval[] = [];
    for (const s of sets) all.push(...s.intervals);
    return new CharSet(all);
  }

  /** A set matching exactly one code point. */
  static char(cp: number): CharSet {
    return new CharSet([[cp, cp]]);
  }

  /** A set matching one inclusive range. Caller must ensure lo <= hi. */
  static range(lo: number, hi: number): CharSet {
    return new CharSet([[lo, hi]]);
  }

  /** `.` — every code unit except the four line terminators. */
  static dot(): CharSet {
    return new CharSet(LINE_TERMINATORS.map((cp) => [cp, cp] as Interval)).complement();
  }
}

// --- Convenience classes, pinned exactly to the host JS semantics (no `u`). ---

/** `\d` = [0-9] (ASCII only). */
export const DIGIT = new CharSet([[0x30, 0x39]]);

/** `\w` = [A-Za-z0-9_] (ASCII only). */
export const WORD = new CharSet([
  [0x30, 0x39],
  [0x41, 0x5a],
  [0x5f, 0x5f],
  [0x61, 0x7a],
]);

/**
 * `\s` = the FULL JS WhiteSpace + LineTerminator set. Implemented exactly and
 * unit-tested against the host across every listed code point, so the engine is
 * byte-for-byte identical to `RegExp` for `\s`/`\S` over all of UTF-16.
 */
export const SPACE = new CharSet([
  [0x09, 0x0d], // TAB, LF, VT, FF, CR (contiguous)
  [0x20, 0x20], // SPACE
  [0xa0, 0xa0], // NBSP
  [0x1680, 0x1680], // OGHAM SPACE MARK
  [0x2000, 0x200a], // EN QUAD .. HAIR SPACE
  [0x2028, 0x2028], // LINE SEPARATOR
  [0x2029, 0x2029], // PARAGRAPH SEPARATOR
  [0x202f, 0x202f], // NARROW NO-BREAK SPACE
  [0x205f, 0x205f], // MEDIUM MATHEMATICAL SPACE
  [0x3000, 0x3000], // IDEOGRAPHIC SPACE
  [0xfeff, 0xfeff], // ZERO WIDTH NO-BREAK SPACE (BOM)
]);

export const NOT_DIGIT = DIGIT.complement();
export const NOT_WORD = WORD.complement();
export const NOT_SPACE = SPACE.complement();
