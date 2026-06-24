import { describe, it, expect } from 'vitest';
import { parse } from '../src/engine/parser.js';
import { runBacktracker, backtrackMatch } from '../src/engine/backtracker.js';
import { compile } from '../src/engine/index.js';

const oracle = (p: string, input: string): boolean => new RegExp(`^(?:${p})$`).test(input);

describe('backtracker: agrees with the engine on small inputs', () => {
  const patterns = ['abc', 'a|b', 'a*', 'a+b', 'ab?c', '(ab)+', '(a|b)*abb', '[a-c]+', 'a.c'];
  const inputs = ['', 'a', 'abc', 'ab', 'aaa', 'aababb', 'axc', 'abccba', 'abd'];
  it('matches the host oracle', () => {
    for (const p of patterns) {
      for (const s of inputs) {
        expect(backtrackMatch(p, s), `${p} ~ "${s}"`).toBe(oracle(p, s));
      }
    }
  });
});

describe('backtracker: empty-match progress guard guarantees termination', () => {
  // These would loop forever WITHOUT the guard. With it they terminate; we add
  // a generous step ceiling purely so a regression fails fast instead of hanging.
  const cases: Array<[string, string, boolean]> = [
    ['(a*)*', 'aaa', true],
    ['(a*)*', 'b', false],
    ['(a?)*', 'aaa', true],
    ['(|a)*', 'aaa', true],
    ['(a*)+', '', true],
    ['()*', '', true],
  ];
  it('terminates with correct results on nullable loops', () => {
    for (const [p, input, expected] of cases) {
      const res = runBacktracker(parse(p), input, { maxSteps: 5_000_000 });
      expect(res.timedOut, `${p} ~ "${input}" should not time out`).toBe(false);
      expect(res.matched, `${p} ~ "${input}"`).toBe(expected);
      expect(res.matched).toBe(oracle(p, input));
    }
  });
});

describe('backtracker: deterministic ReDoS step-count proxy (section 3)', () => {
  const N = 25;
  const adversarial = `${'a'.repeat(N)}!`; // a^N followed by one non-'a' -> reject path

  it('the naive foil blows past a fixed step budget on (a+)+', () => {
    const STEP_BUDGET = 1_000_000;
    const res = runBacktracker(parse('(a+)+'), adversarial, { maxSteps: STEP_BUDGET });
    expect(res.timedOut).toBe(true); // exceeded the budget => exponential
    expect(res.steps).toBeGreaterThan(STEP_BUDGET);
  });

  it('the real engine answers the same case correctly and cheaply', () => {
    const c = compile('(a+)+');
    // "Cheap" is asserted structurally: a tiny minimized DFA + one linear scan,
    // not millions of steps. We do NOT call the host RegExp oracle on this
    // input — the host backtracks and would itself ReDoS-hang on a^25 + '!'.
    // The correct answer is known: `(a+)+` rejects any string containing '!'.
    expect(c.test(adversarial)).toBe(false);
    expect(c.test('a'.repeat(N))).toBe(true);
    expect(c.minDfa.numStates).toBeLessThan(10);
  });

  it('the foil is correct (just slow) on a smaller instance', () => {
    const small = `${'a'.repeat(8)}!`;
    const res = runBacktracker(parse('(a+)+'), small);
    expect(res.timedOut).toBe(false);
    expect(res.matched).toBe(false);
    expect(res.matched).toBe(oracle('(a+)+', small));
  });
});
