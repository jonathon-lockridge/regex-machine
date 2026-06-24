import { describe, it, expect } from 'vitest';
import { compileNfa, simulateNfa } from '../src/engine/nfa.js';
import { buildDfa, simulateDfa } from '../src/engine/dfa.js';

const dfaOf = (p: string) => buildDfa(compileNfa(p));
const oracle = (p: string, input: string): boolean => new RegExp(`^(?:${p})$`).test(input);

describe('dfa: agreement with oracle and NFA', () => {
  const patterns = ['abc', 'a|b', 'a*', 'a+b', 'ab?c', '(ab)+', '(a|b)*abb', '[a-c]+', 'a.c'];
  const inputs = ['', 'a', 'b', 'abc', 'ab', 'aaa', 'aababb', 'aababa', 'axc', 'abccba', 'abd'];

  it('DFA result equals NFA result equals host oracle', () => {
    for (const p of patterns) {
      const nfa = compileNfa(p);
      const dfa = buildDfa(nfa);
      for (const s of inputs) {
        const expected = oracle(p, s);
        expect(simulateNfa(nfa, s), `nfa ${p} ~ "${s}"`).toBe(expected);
        expect(simulateDfa(dfa, s), `dfa ${p} ~ "${s}"`).toBe(expected);
      }
    }
  });
});

describe('dfa: alphabet partition (section 2.7 convention)', () => {
  it('a pattern over {a,b} yields exactly {a},{b},{other}', () => {
    expect(dfaOf('(a|b)*abb').alphabet.numClasses).toBe(3);
    expect(dfaOf('a|b').alphabet.numClasses).toBe(3);
  });

  it('three distinct literals plus other => four classes', () => {
    expect(dfaOf('abc').alphabet.numClasses).toBe(4);
  });

  it('a pattern with no symbols has a single catch-all class', () => {
    expect(dfaOf('').alphabet.numClasses).toBe(1);
  });
});

describe('dfa: totality and trap state', () => {
  it('is total with a non-accepting self-looping trap', () => {
    const dfa = dfaOf('(a|b)*abb');
    expect(dfa.accepting[dfa.trap]).toBe(false);
    for (const target of dfa.transitions[dfa.trap] as readonly number[]) {
      expect(target).toBe(dfa.trap);
    }
    // Every state has a transition for every alphabet class.
    for (const row of dfa.transitions) {
      expect(row.length).toBe(dfa.alphabet.numClasses);
      for (const t of row) expect(t).toBeGreaterThanOrEqual(0);
    }
  });
});
