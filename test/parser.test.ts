import { describe, it, expect } from 'vitest';
import { parse } from '../src/engine/parser.js';
import { astToString, type AstNode } from '../src/engine/ast.js';
import { RegexSyntaxError } from '../src/engine/errors.js';

const s = (p: string): string => astToString(parse(p));

describe('parser: precedence and structure', () => {
  it('alternation is lowest precedence', () => {
    const a = parse('a|bc');
    expect(a.type).toBe('alt');
    expect(s('a|bc')).toBe('(a|bc)');
    expect(s('ab|c')).toBe('(ab|c)');
  });

  it('quantifiers bind to the nearest atom, not the whole concatenation', () => {
    expect(s('ab*')).toBe('ab*');
    const node = parse('ab*') as AstNode;
    expect(node.type).toBe('concat');
  });

  it('grouping overrides precedence', () => {
    expect(s('(a|b)c')).toBe('(a|b)c');
    const node = parse('(a|b)c');
    expect(node.type).toBe('concat');
  });

  it('groups, empty groups and empty branches', () => {
    expect(s('(ab)')).toBe('ab');
    expect(s('()')).toBe('ε');
    expect(s('(a|)')).toBe('(a|ε)');
    expect(s('()*')).toBe('ε*');
  });

  it('empty pattern is epsilon', () => {
    expect(s('')).toBe('ε');
  });
});

describe('parser: anchors (section 2.3)', () => {
  it('accepts anchors that bind the whole pattern', () => {
    expect(s('^abc$')).toBe('abc');
    expect(s('^abc')).toBe('abc');
    expect(s('abc$')).toBe('abc');
    expect(s('^$')).toBe('ε');
    expect(s('^(a|b)$')).toBe('(a|b)'); // alternation is inside a group -> ok
  });

  it('rejects interior anchors and branch-bound anchors', () => {
    expect(() => parse('(^a)')).toThrow(RegexSyntaxError);
    expect(() => parse('a|b$')).toThrow(RegexSyntaxError);
    expect(() => parse('(a$|b)')).toThrow(RegexSyntaxError);
    expect(() => parse('^a|b')).toThrow(RegexSyntaxError);
    expect(() => parse('a^b')).toThrow(RegexSyntaxError);
    expect(() => parse('a$b')).toThrow(RegexSyntaxError);
  });
});

describe('parser: stacked quantifiers (section 2.4)', () => {
  it('rejects adjacent quantifiers', () => {
    for (const p of ['a**', 'a+*', 'a?+', 'a*?', 'a*+', 'a??']) {
      expect(() => parse(p), p).toThrow(RegexSyntaxError);
    }
  });
});

describe('parser: nothing to repeat', () => {
  it('rejects a quantifier with no preceding atom', () => {
    for (const p of ['*a', '+a', '?a', '(*)', '|*', '*']) {
      expect(() => parse(p), p).toThrow(RegexSyntaxError);
    }
  });
});

describe('parser: unmatched parentheses', () => {
  it('rejects unbalanced parens', () => {
    for (const p of ['(a', 'a)', '((a)', '(a))']) {
      expect(() => parse(p), p).toThrow(RegexSyntaxError);
    }
  });
});

describe('parser: degenerate classes propagate tokenizer errors', () => {
  it('rejects [] [^] [z-a]', () => {
    for (const p of ['[]', '[^]', '[z-a]']) {
      expect(() => parse(p), p).toThrow(RegexSyntaxError);
    }
  });
});
