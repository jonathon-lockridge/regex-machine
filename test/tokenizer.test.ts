import { describe, it, expect } from 'vitest';
import { tokenize, type Token } from '../src/engine/tokenizer.js';
import { RegexSyntaxError } from '../src/engine/errors.js';

function kinds(pattern: string): string[] {
  return tokenize(pattern).map((t) => t.kind);
}

function atomAt(tokens: Token[], idx: number) {
  const t = tokens[idx];
  if (!t || t.kind !== 'atom') throw new Error(`token ${idx} is not an atom`);
  return t;
}

const cp = (ch: string) => ch.charCodeAt(0);

describe('tokenizer: structure', () => {
  it('tokenizes literals as atoms', () => {
    const t = tokenize('abc');
    expect(kinds('abc')).toEqual(['atom', 'atom', 'atom']);
    expect(atomAt(t, 0).label).toBe('a');
    expect(atomAt(t, 0).set.test(cp('a'))).toBe(true);
    expect(atomAt(t, 0).set.test(cp('b'))).toBe(false);
  });

  it('tokenizes quantifiers, alternation, grouping, anchors', () => {
    expect(kinds('a*b+c?')).toEqual(['atom', 'star', 'atom', 'plus', 'atom', 'question']);
    expect(kinds('a|b')).toEqual(['atom', 'pipe', 'atom']);
    expect(kinds('(ab)')).toEqual(['lparen', 'atom', 'atom', 'rparen']);
    expect(kinds('^a$')).toEqual(['anchorStart', 'atom', 'anchorEnd']);
  });

  it('emits zero tokens for the empty pattern', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('tokenizer: dot vs negated class on the four line terminators', () => {
  const TERMINATORS = [0x0a, 0x0d, 0x2028, 0x2029];

  it('dot rejects all four line terminators', () => {
    const dot = atomAt(tokenize('.'), 0).set;
    for (const t of TERMINATORS) expect(dot.test(t)).toBe(false);
    expect(dot.test(cp('a'))).toBe(true);
  });

  it('negated class includes all four line terminators', () => {
    const neg = atomAt(tokenize('[^x]'), 0).set;
    for (const t of TERMINATORS) expect(neg.test(t)).toBe(true);
    expect(neg.test(cp('x'))).toBe(false);
    expect(neg.test(cp('y'))).toBe(true);
  });
});

describe('tokenizer: character classes', () => {
  it('parses simple and range classes', () => {
    const simple = atomAt(tokenize('[abc]'), 0).set;
    expect(simple.test(cp('a'))).toBe(true);
    expect(simple.test(cp('c'))).toBe(true);
    expect(simple.test(cp('d'))).toBe(false);

    const range = atomAt(tokenize('[a-c]'), 0).set;
    expect([cp('a'), cp('b'), cp('c')].every((x) => range.test(x))).toBe(true);
    expect(range.test(cp('d'))).toBe(false);
  });

  it('treats a trailing dash and leading dash as literal', () => {
    const a = atomAt(tokenize('[a-]'), 0).set;
    expect(a.test(cp('a'))).toBe(true);
    expect(a.test(cp('-'))).toBe(true);
    expect(a.test(cp('b'))).toBe(false);

    const b = atomAt(tokenize('[-a]'), 0).set;
    expect(b.test(cp('-'))).toBe(true);
    expect(b.test(cp('a'))).toBe(true);
  });

  it('supports shorthands inside classes', () => {
    const set = atomAt(tokenize('[\\d_]'), 0).set;
    expect(set.test(cp('5'))).toBe(true);
    expect(set.test(cp('_'))).toBe(true);
    expect(set.test(cp('a'))).toBe(false);
  });
});

describe('tokenizer: escapes and shorthands', () => {
  it('escaped metacharacters are literal', () => {
    const dot = atomAt(tokenize('\\.'), 0).set;
    expect(dot.test(cp('.'))).toBe(true);
    expect(dot.test(cp('a'))).toBe(false);

    const star = atomAt(tokenize('\\*'), 0).set;
    expect(star.test(cp('*'))).toBe(true);
  });

  it('control escapes \\n \\t \\r', () => {
    expect(atomAt(tokenize('\\n'), 0).set.test(0x0a)).toBe(true);
    expect(atomAt(tokenize('\\t'), 0).set.test(0x09)).toBe(true);
    expect(atomAt(tokenize('\\r'), 0).set.test(0x0d)).toBe(true);
  });

  it('shorthand classes outside a class', () => {
    expect(atomAt(tokenize('\\d'), 0).set.test(cp('7'))).toBe(true);
    expect(atomAt(tokenize('\\d'), 0).set.test(cp('a'))).toBe(false);
    expect(atomAt(tokenize('\\D'), 0).set.test(cp('a'))).toBe(true);
    expect(atomAt(tokenize('\\w'), 0).set.test(cp('_'))).toBe(true);
    expect(atomAt(tokenize('\\W'), 0).set.test(cp('_'))).toBe(false);
  });
});

describe('tokenizer: error cases', () => {
  it('rejects empty and reversed-range classes', () => {
    expect(() => tokenize('[]')).toThrow(RegexSyntaxError);
    expect(() => tokenize('[^]')).toThrow(RegexSyntaxError);
    expect(() => tokenize('[z-a]')).toThrow(RegexSyntaxError);
  });

  it('rejects unterminated class and bad escapes', () => {
    expect(() => tokenize('[abc')).toThrow(RegexSyntaxError);
    expect(() => tokenize('\\')).toThrow(RegexSyntaxError);
    expect(() => tokenize('\\q')).toThrow(RegexSyntaxError);
  });
});
