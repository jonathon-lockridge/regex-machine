import { describe, it, expect } from 'vitest';
import { compileNfa, simulateNfa, runTrace, buildNfa } from '../src/engine/nfa.js';
import { parse } from '../src/engine/parser.js';

const m = (pattern: string, input: string): boolean => simulateNfa(compileNfa(pattern), input);

/** Host oracle with the engine's anchored full-match semantics. */
const oracle = (pattern: string, input: string): boolean =>
  new RegExp(`^(?:${pattern})$`).test(input);

describe('nfa: core operators', () => {
  it('literals and concatenation', () => {
    expect(m('abc', 'abc')).toBe(true);
    expect(m('abc', 'ab')).toBe(false);
    expect(m('abc', 'abcd')).toBe(false);
    expect(m('abc', '')).toBe(false);
  });

  it('alternation', () => {
    expect(m('a|b', 'a')).toBe(true);
    expect(m('a|b', 'b')).toBe(true);
    expect(m('a|b', 'c')).toBe(false);
    expect(m('a|b', '')).toBe(false);
  });

  it('star, plus, optional', () => {
    expect(m('a*', '')).toBe(true);
    expect(m('a*', 'aaaa')).toBe(true);
    expect(m('a*', 'b')).toBe(false);

    expect(m('a+', '')).toBe(false);
    expect(m('a+', 'aaa')).toBe(true);

    expect(m('ab?c', 'ac')).toBe(true);
    expect(m('ab?c', 'abc')).toBe(true);
    expect(m('ab?c', 'abbc')).toBe(false);
  });

  it('groups with quantifiers', () => {
    expect(m('(ab)+', 'ab')).toBe(true);
    expect(m('(ab)+', 'abab')).toBe(true);
    expect(m('(ab)+', 'aba')).toBe(false);
    expect(m('(a|b)*abb', 'aababb')).toBe(true);
    expect(m('(a|b)*abb', 'aababa')).toBe(false);
  });

  it('character classes and dot', () => {
    expect(m('[a-c]+', 'abccba')).toBe(true);
    expect(m('[a-c]+', 'abd')).toBe(false);
    expect(m('a.c', 'axc')).toBe(true);
    expect(m('a.c', 'ac')).toBe(false);
    expect(m('a.c', 'a\nc')).toBe(false); // dot excludes LF
  });
});

describe('nfa: epsilon-loop patterns terminate with correct results', () => {
  const cases: Array<[string, string, boolean]> = [
    ['(a*)*', '', true],
    ['(a*)*', 'aaa', true],
    ['(a*)*', 'b', false],
    ['(a?)*', '', true],
    ['(a?)*', 'aaa', true],
    ['(|a)*', '', true],
    ['(|a)*', 'aaa', true],
    ['()*', '', true],
    ['()*', 'a', false],
  ];
  it('matches the host oracle without hanging', () => {
    for (const [p, input, expected] of cases) {
      expect(m(p, input), `${p} ~ "${input}"`).toBe(expected);
      expect(oracle(p, input), `oracle ${p} ~ "${input}"`).toBe(expected);
    }
  });
});

describe('nfa: runTrace', () => {
  it('produces one frame per input position and agrees on acceptance', () => {
    const nfa = compileNfa('(a|b)*abb');
    const input = 'aababb';
    const trace = runTrace(nfa, input);
    expect(trace.frames.length).toBe(input.length + 1);
    expect(trace.frames[0]?.consumed).toBe(null);
    expect(trace.accepted).toBe(simulateNfa(nfa, input));
    expect(trace.accepted).toBe(true);
  });
});

describe('nfa: build from AST directly', () => {
  it('builds an equivalent automaton from a parsed AST', () => {
    const nfa = buildNfa(parse('a+b'));
    expect(simulateNfa(nfa, 'aaab')).toBe(true);
    expect(simulateNfa(nfa, 'b')).toBe(false);
  });
});
