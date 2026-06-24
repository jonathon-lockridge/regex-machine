import { describe, it, expect } from 'vitest';
import { compileNfa } from '../src/engine/nfa.js';
import { buildDfa, simulateDfa } from '../src/engine/dfa.js';
import { minimizeDfa } from '../src/engine/minimize.js';

const minOf = (p: string) => minimizeDfa(buildDfa(compileNfa(p)));
const oracle = (p: string, input: string): boolean => new RegExp(`^(?:${p})$`).test(input);

describe('minimize: behavior is preserved', () => {
  const patterns = ['abc', 'a|b', 'a*', 'a+b', 'ab?c', '(ab)+', '(a|b)*abb', '[a-c]+', 'a.c'];
  const inputs = ['', 'a', 'b', 'abc', 'ab', 'aaa', 'aababb', 'axc', 'abccba', 'abd', 'c'];

  it('minimized DFA matches the host oracle', () => {
    for (const p of patterns) {
      const min = minOf(p);
      for (const s of inputs) {
        expect(simulateDfa(min, s), `min ${p} ~ "${s}"`).toBe(oracle(p, s));
      }
    }
  });

  it('never increases the state count vs the raw DFA', () => {
    for (const p of patterns) {
      const dfa = buildDfa(compileNfa(p));
      expect(minimizeDfa(dfa).numStates).toBeLessThanOrEqual(dfa.numStates);
    }
  });
});

describe('minimize: idempotence / fixpoint invariant (section 2.7)', () => {
  const patterns = ['abc', 'a|b', 'a*', '(a|b)*abb', '(ab)+', '[a-c]+', 'a.c', '', '(a*)*'];
  it('minimize(minimize(D)) has the same state count as minimize(D)', () => {
    for (const p of patterns) {
      const once = minimizeDfa(buildDfa(compileNfa(p)));
      const twice = minimizeDfa(once);
      expect(twice.numStates, p).toBe(once.numStates);
    }
  });
});

describe('minimize: fixed state-count fixtures over {a,b}', () => {
  // Counts include the explicit trap (dead) state; alphabet is {a},{b},{other}
  // unless the pattern mentions fewer literals.
  const fixtures: Array<[string, number]> = [
    ['', 2], // start(accept) + trap
    ['a', 3], // start + accept + trap
    ['ab', 4], // start + after-a + accept + trap
    ['(a|b)*', 2], // accept-everything + trap
    ['(ab)*', 3], // even/odd + trap
    ['a*b*', 3], // reading-a's + reading-b's + trap
  ];
  it('matches hand-computed minimal sizes', () => {
    for (const [p, expected] of fixtures) {
      expect(minOf(p).numStates, p).toBe(expected);
    }
  });
});
