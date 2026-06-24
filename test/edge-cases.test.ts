import { describe, it, expect } from 'vitest';
import { compile, match } from '../src/engine/index.js';

const oracle = (p: string, input: string): boolean => new RegExp(`^(?:${p})$`).test(input);

describe('edge cases: hand-written', () => {
  const cases: Array<[string, string]> = [
    // [pattern, input]
    ['', ''],
    ['', 'a'],
    ['a*', ''],
    ['a*', 'aaaa'],
    ['(ab)?', ''],
    ['(ab)?', 'ab'],
    ['(ab)?', 'abab'],
    ['[^a]', 'b'],
    ['[^a]', 'a'],
    ['[^a]', '\n'], // negated class includes line terminators
    ['^abc$', 'abc'],
    ['^abc$', 'abx'],
    ['a\\.b', 'a.b'],
    ['a\\.b', 'axb'],
    ['\\(\\)', '()'],
    ['a\\+', 'a+'],
    ['(a|)', ''],
    ['(a|)', 'a'],
  ];

  it('the four recognizers all agree with the host oracle', () => {
    for (const [p, input] of cases) {
      const c = compile(p);
      const expected = oracle(p, input);
      expect(c.test(input), `min-dfa ${p} ~ "${input}"`).toBe(expected);
      expect(c.testNfa(input), `nfa ${p} ~ "${input}"`).toBe(expected);
      expect(c.testDfa(input), `dfa ${p} ~ "${input}"`).toBe(expected);
      // small input -> the naive foil should agree too
      expect(c.backtrack(input).matched, `backtrack ${p} ~ "${input}"`).toBe(expected);
    }
  });
});

describe('edge cases: convenience match()', () => {
  it('matches via the minimized DFA', () => {
    expect(match('a+', 'aaa')).toBe(true);
    expect(match('a+', '')).toBe(false);
  });
});

describe('edge cases: adversarial pattern is cheap on the real engine', () => {
  it('(a+)+ answers correctly via the minimized DFA', () => {
    const c = compile('(a+)+');
    const accept = 'a'.repeat(40);
    const reject = `${'a'.repeat(40)}!`;
    // NOTE: we deliberately do NOT consult the host RegExp oracle here. The
    // host is itself a backtracking matcher, so `^(?:(a+)+)$` against 40 a's
    // plus a rejecting char catastrophically backtracks (~2^40) and would hang
    // forever — which is precisely the ReDoS this project exists to defeat. The
    // correct answers are known by construction: `(a+)+` accepts a-only strings.
    expect(c.test(accept)).toBe(true);
    expect(c.test(reject)).toBe(false);
  });
});
