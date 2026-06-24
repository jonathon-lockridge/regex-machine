import { describe, it, expect } from 'vitest';
import { compile, match } from '../src/engine/index.js';
import { RegexSyntaxError } from '../src/engine/errors.js';

const oracle = (p: string, input: string): boolean => new RegExp(`^(?:${p})$`).test(input);

/**
 * Compare the engine to the host for a single-symbol pattern across EVERY
 * UTF-16 code unit. This is the strongest possible membership check and pins
 * `\s` (implemented to the full JS whitespace set) byte-for-byte.
 */
function sweep(pattern: string): { mismatches: number; firstHex: string | null } {
  const c = compile(pattern);
  const re = new RegExp(`^(?:${pattern})$`);
  let mismatches = 0;
  let firstHex: string | null = null;
  for (let cp = 0; cp <= 0xffff; cp++) {
    const s = String.fromCharCode(cp);
    if (c.test(s) !== re.test(s)) {
      mismatches++;
      if (firstHex === null) firstHex = `U+${cp.toString(16).padStart(4, '0').toUpperCase()}`;
    }
  }
  return { mismatches, firstHex };
}

describe('semantics 2.1 + 2.2: dot, classes and shorthands match JS across all of UTF-16', () => {
  const singleSymbol = ['\\d', '\\w', '\\s', '\\D', '\\W', '\\S', '.', '[^a]', '[a-z]', '[\\s\\d]'];
  for (const p of singleSymbol) {
    it(`"${p}" matches the host for every code unit 0..0xFFFF`, () => {
      const r = sweep(p);
      expect(r.mismatches, `first divergence at ${r.firstHex}`).toBe(0);
    });
  }
});

describe('semantics 2.1: dot vs negated class on the four line terminators', () => {
  const TERMINATORS = [
    ['\\n', 0x000a],
    ['\\r', 0x000d],
    ['U+2028', 0x2028],
    ['U+2029', 0x2029],
  ] as const;

  it('dot rejects all four terminators; [^x] accepts all four', () => {
    for (const [name, cp] of TERMINATORS) {
      const ch = String.fromCharCode(cp);
      expect(match('.', ch), `dot should reject ${name}`).toBe(false);
      expect(match('[^x]', ch), `[^x] should accept ${name}`).toBe(true);
    }
    expect(match('.', 'a')).toBe(true);
  });
});

describe('semantics 2.2: hand-picked, JS-verified membership', () => {
  it('\\d is ASCII digits only', () => {
    expect(match('\\d', '5')).toBe(true);
    expect(match('\\d', '٠')).toBe(false); // Arabic-Indic digit
    expect(match('\\D', '٠')).toBe(true);
  });
  it('\\w is ASCII word chars only', () => {
    expect(match('\\w', '_')).toBe(true);
    expect(match('\\w', 'A')).toBe(true);
    expect(match('\\w', 'é')).toBe(false); // é
    expect(match('\\W', 'é')).toBe(true);
  });
  it('\\s includes the exotic JS whitespace code points', () => {
    for (const cp of [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2009, 0x202f, 0x205f, 0x3000, 0xfeff]) {
      const ch = String.fromCharCode(cp);
      expect(match('\\s', ch), `\\s should match U+${cp.toString(16)}`).toBe(true);
      expect(match('\\s', ch)).toBe(oracle('\\s', ch));
    }
    expect(match('\\s', 'a')).toBe(false);
  });
});

describe('semantics 2.3: anchors only when binding the whole pattern', () => {
  it('accepts whole-pattern anchors', () => {
    expect(match('^abc$', 'abc')).toBe(true);
    expect(match('^abc', 'abc')).toBe(true);
    expect(match('abc$', 'abc')).toBe(true);
    expect(match('^$', '')).toBe(true);
    expect(match('^$', 'a')).toBe(false);
  });
  it('rejects interior / branch-bound anchors', () => {
    for (const p of ['(^a)', 'a|b$', '(a$|b)', '^a|b', 'a^b']) {
      expect(() => compile(p), p).toThrow(RegexSyntaxError);
    }
  });
});

describe('semantics 2.4 + 2.5: degenerate-construct parse errors and supported edges', () => {
  it('stacked quantifiers are parse errors', () => {
    for (const p of ['a**', 'a+*', 'a?+', 'a*?']) {
      expect(() => compile(p), p).toThrow(RegexSyntaxError);
    }
  });
  it('empty/reversed classes are parse errors', () => {
    for (const p of ['[]', '[^]', '[z-a]']) {
      expect(() => compile(p), p).toThrow(RegexSyntaxError);
    }
  });
  it('empty pattern and empty alternation branch are supported', () => {
    expect(match('', '')).toBe(true);
    expect(match('', 'a')).toBe(false);
    expect(match('(a|)', '')).toBe(true);
    expect(match('(a|)', 'a')).toBe(true);
    expect(match('(a|)', 'b')).toBe(false);
  });
});

describe('semantics 2.6: nullable-quantifier epsilon loops terminate with correct results', () => {
  const cases: Array<[string, string, boolean]> = [
    ['(a*)*', '', true],
    ['(a*)*', 'aaa', true],
    ['(a*)*', 'b', false],
    ['(a?)*', 'aaa', true],
    ['(|a)*', 'aaa', true],
    ['()*', '', true],
    ['()*', 'a', false],
  ];
  it('the engine answers without hanging and matches the oracle', () => {
    for (const [p, input, expected] of cases) {
      expect(match(p, input), `${p} ~ "${input}"`).toBe(expected);
      expect(match(p, input)).toBe(oracle(p, input));
    }
  });
});
