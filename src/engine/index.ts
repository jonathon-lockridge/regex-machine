/**
 * Public API for the regex-machine engine.
 *
 * `compile(pattern)` runs the whole pipeline and hands back every intermediate
 * artifact (AST, NFA, DFA, minimized DFA) plus matchers for each. The canonical
 * `test()` evaluates via the MINIMIZED DFA — the fastest, smallest recognizer —
 * while `testNfa`/`testDfa` expose the other automata so callers (the fuzzer's
 * cross-automaton check, the visualizer) can confirm they all agree.
 */
import { parse } from './parser.js';
import type { AstNode } from './ast.js';
import { buildNfa, simulateNfa, runTrace, type Nfa, type NfaTrace } from './nfa.js';
import { buildDfa, simulateDfa, type Dfa } from './dfa.js';
import { minimizeDfa } from './minimize.js';
import { runBacktracker, type BacktrackOptions, type BacktrackResult } from './backtracker.js';

export interface Compiled {
  readonly pattern: string;
  readonly ast: AstNode;
  readonly nfa: Nfa;
  readonly dfa: Dfa;
  readonly minDfa: Dfa;
  /** Canonical recognizer: full-string match via the minimized DFA. */
  test(input: string): boolean;
  /** Match via the linear NFA simulation (what the visualizer steps through). */
  testNfa(input: string): boolean;
  /** Match via the subset-construction DFA (before minimization). */
  testDfa(input: string): boolean;
  /** Per-character NFA active-set trace for the step-through view. */
  trace(input: string): NfaTrace;
  /** Run the naive backtracking foil over this pattern (with optional budget). */
  backtrack(input: string, options?: BacktrackOptions): BacktrackResult;
}

/** Compile a pattern through the full pipeline. Throws `RegexSyntaxError`. */
export function compile(pattern: string): Compiled {
  const ast = parse(pattern);
  const nfa = buildNfa(ast);
  const dfa = buildDfa(nfa);
  const minDfa = minimizeDfa(dfa);
  return {
    pattern,
    ast,
    nfa,
    dfa,
    minDfa,
    test: (input) => simulateDfa(minDfa, input),
    testNfa: (input) => simulateNfa(nfa, input),
    testDfa: (input) => simulateDfa(dfa, input),
    trace: (input) => runTrace(nfa, input),
    backtrack: (input, options) => runBacktracker(ast, input, options),
  };
}

/** Convenience: does `input` fully match `pattern`? (via the minimized DFA). */
export function match(pattern: string, input: string): boolean {
  return compile(pattern).test(input);
}

// --- Re-exports of the pipeline stages and types. ---
export { tokenize, charLabel } from './tokenizer.js';
export type { Token } from './tokenizer.js';
export { parse, parseTokens } from './parser.js';
export { astToString } from './ast.js';
export type {
  AstNode,
  EmptyNode,
  CharSetNode,
  ConcatNode,
  AltNode,
  StarNode,
  PlusNode,
  OptionalNode,
} from './ast.js';
export { CharSet, CP_MAX, LINE_TERMINATORS } from './charset.js';
export type { Interval } from './charset.js';
export { RegexSyntaxError } from './errors.js';
export {
  buildNfa,
  compileNfa,
  simulateNfa,
  epsilonClosure,
  runTrace,
} from './nfa.js';
export type { Nfa, NfaState, NfaTransition, NfaTrace, NfaTraceFrame } from './nfa.js';
export { buildDfa, simulateDfa } from './dfa.js';
export type { Dfa, Alphabet, AlphabetClass } from './dfa.js';
export { minimizeDfa } from './minimize.js';
export { runBacktracker, backtrackMatch } from './backtracker.js';
export type { BacktrackOptions, BacktrackResult } from './backtracker.js';
