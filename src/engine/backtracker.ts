/**
 * The naive backtracking matcher — a deliberate FOIL, not the engine.
 *
 * It walks the SAME AST with greedy, recursive, continuation-passing
 * backtracking. On adversarial patterns like `(a+)+` it exhibits genuine
 * exponential blow-up — that is the whole point: it exists to demonstrate, by
 * contrast, why the automaton-based engine is linear and ReDoS-proof. The real
 * matcher is `compile().test` (minimized DFA); never route production matching
 * through here.
 *
 * MANDATORY empty-match progress guard: when a quantified subexpression matches
 * zero width, it does NOT recurse another iteration at the same input index.
 * Without it, nullable loops like `(a*)*` would recurse forever; with it, the
 * foil ALWAYS terminates — turning an infinite hang into finite (if explosive)
 * work.
 */
import type { AstNode } from './ast.js';
import { parse } from './parser.js';

/** Thrown internally when a step/time budget is exceeded; caught at the top. */
class BudgetExceeded extends Error {}

export interface BacktrackOptions {
  /** Abort after this many matcher steps (deterministic — used by tests). */
  readonly maxSteps?: number;
  /** Abort once this wall-clock time (ms, performance.now scale) is reached. */
  readonly deadlineMs?: number;
}

export interface BacktrackResult {
  /** Whether the whole input matched (meaningless if `timedOut`). */
  readonly matched: boolean;
  /** Number of matcher steps taken — the deterministic ReDoS proxy metric. */
  readonly steps: number;
  /** True if a budget aborted the run before it completed. */
  readonly timedOut: boolean;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

type Cont = (pos: number) => boolean;

/** Run the naive backtracker over an AST. Counts steps; honors budgets. */
export function runBacktracker(
  ast: AstNode,
  input: string,
  options: BacktrackOptions = {},
): BacktrackResult {
  const len = input.length;
  const maxSteps = options.maxSteps ?? Number.POSITIVE_INFINITY;
  const deadlineMs = options.deadlineMs;
  let steps = 0;

  const tick = (): void => {
    steps++;
    if (steps > maxSteps) throw new BudgetExceeded();
    // Check the wall clock only occasionally to keep the hot path cheap.
    if (deadlineMs !== undefined && (steps & 0x3ff) === 0 && nowMs() >= deadlineMs) {
      throw new BudgetExceeded();
    }
  };

  const match = (node: AstNode, pos: number, k: Cont): boolean => {
    tick();
    switch (node.type) {
      case 'empty':
        return k(pos);

      case 'charset':
        if (pos < len && node.set.test(input.charCodeAt(pos))) return k(pos + 1);
        return false;

      case 'concat':
        return matchSeq(node.parts, 0, pos, k);

      case 'alt': {
        for (const opt of node.options) {
          if (match(opt, pos, k)) return true;
        }
        return false;
      }

      case 'optional':
        // Greedy: try one occurrence before falling back to zero.
        return match(node.node, pos, k) || k(pos);

      case 'star': {
        const child = node.node;
        const loop = (p: number): boolean => {
          const more = match(child, p, (next) =>
            // Empty-match progress guard: a zero-width child match must not
            // trigger another iteration at the same index.
            next === p ? false : loop(next),
          );
          return more || k(p);
        };
        return loop(pos);
      }

      case 'plus': {
        const child = node.node;
        const loop = (p: number): boolean => {
          const more = match(child, p, (next) => (next === p ? false : loop(next)));
          return more || k(p);
        };
        // Require at least one occurrence, then behave like a star.
        return match(child, pos, (next) => loop(next));
      }
    }
  };

  const matchSeq = (parts: readonly AstNode[], idx: number, pos: number, k: Cont): boolean => {
    if (idx === parts.length) return k(pos);
    return match(parts[idx] as AstNode, pos, (next) => matchSeq(parts, idx + 1, next, k));
  };

  let matched = false;
  let timedOut = false;
  try {
    matched = match(ast, 0, (pos) => pos === len);
  } catch (e) {
    if (e instanceof BudgetExceeded) timedOut = true;
    else throw e;
  }
  return { matched, steps, timedOut };
}

/** Simple boolean foil API: does the whole input match (no budget)? */
export function backtrackMatch(pattern: string, input: string): boolean {
  return runBacktracker(parse(pattern), input).matched;
}
