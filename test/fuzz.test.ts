import { describe, it, expect } from 'vitest';
import { Rng } from './rng.js';
import { compile } from '../src/engine/index.js';
import { RegexSyntaxError } from '../src/engine/errors.js';

/**
 * The centerpiece: differential fuzzing against the host `RegExp` oracle.
 *
 * For thousands of seeded random patterns and inputs we assert that ALL FOUR
 * recognizers — the linear NFA simulation, the subset-construction DFA, the
 * minimized DFA, and (on small inputs) the naive backtracker — return the same
 * boolean as `new RegExp('^(?:'+pattern+')$').test(input)`. That single oracle
 * pins behavior to a battle-tested reference and the cross-automaton check
 * directly substantiates "the minimal DFA recognizes the same language".
 *
 * Generator design (every choice is a deliberate safely-comparable narrowing):
 *  - Strings are ASCII, length <= 12, and exclude the four line terminators, so
 *    `.` and `[^...]` semantics never diverge (sections 2.1) and `\d \w \s`
 *    differences are never exercised (section 2.2). Those shorthands are not
 *    generated at all by default (section 2.2).
 *  - Anchors are emitted ONLY as a whole-pattern prefix/suffix and never around
 *    a top-level alternation (section 2.3); quantifiers are never stacked
 *    (section 2.4); classes are always non-empty with lo<=hi (section 2.5).
 *  - In the host-checked generator, quantifier BODIES are quantifier-free. This
 *    is a ReDoS-safety narrowing, not a correctness shortcut: the host oracle is
 *    itself a backtracking matcher, so a generated `(a+)+` against an adversarial
 *    input would hang V8 for ~2^n steps. Bounding bodies + alternation arity (<=3)
 *    + |string| <= 12 caps worst-case host work at ~3^12. The engine's nested-
 *    quantifier handling is fuzzed separately below (NFA/DFA/min-DFA agreement,
 *    no host) and pinned in nfa/edge-case unit tests.
 */

const PLAIN = ['a', 'b', 'c', 'd'];
const ESCAPABLE = ['.', '*', '+', '?', '|', '(', ')', '[', ']', '^', '$', '\\', '-'];
const RANGE_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];
// Printable ASCII subset + TAB. Never any of LF/CR/LS/PS (the four terminators).
const TEST_CHARS = ['a', 'b', 'c', 'd', 'e', '!', '.', '*', '(', ')', '\t'];
const QUANTIFIERS = ['*', '+', '?'];

interface Budget {
  depth: number;
  atoms: number;
}

class PatternGen {
  private budget: Budget = { depth: 0, atoms: 0 };
  constructor(
    private readonly rng: Rng,
    private readonly nested: boolean,
  ) {}

  pattern(maxDepth: number, maxAtoms: number): string {
    this.budget = { depth: maxDepth, atoms: maxAtoms };
    if (this.rng.bool(0.3)) {
      // Top-level alternation (>=2 branches) — no anchors here.
      const branches = this.rng.intBetween(2, 3);
      const parts: string[] = [];
      for (let i = 0; i < branches; i++) parts.push(this.maybeEmptyConcat(false));
      return parts.join('|');
    }
    // Top-level concatenation: there is no depth-0 '|', so anchors are legal.
    let p = this.concat(false);
    if (this.rng.bool(0.2)) p = `^${p}`;
    if (this.rng.bool(0.2)) p = `${p}$`;
    return p;
  }

  private maybeEmptyConcat(quantFree: boolean): string {
    return this.rng.bool(0.1) ? '' : this.concat(quantFree);
  }

  private alt(quantFree: boolean): string {
    const branches = this.rng.intBetween(1, 3);
    const parts: string[] = [];
    for (let i = 0; i < branches; i++) parts.push(this.maybeEmptyConcat(quantFree));
    return parts.join('|');
  }

  private concat(quantFree: boolean): string {
    const n = this.rng.int(4); // 0..3 units
    let s = '';
    for (let i = 0; i < n && this.budget.atoms > 0; i++) s += this.unit(quantFree);
    return s;
  }

  private unit(quantFree: boolean): string {
    const willQuantify = (this.nested || !quantFree) && this.rng.bool(0.4);
    // In host-safe mode the body of a quantifier must be quantifier-free.
    const bodyQuantFree = this.nested ? false : quantFree || willQuantify;
    const atom = this.atom(bodyQuantFree);
    return willQuantify ? atom + this.rng.pick(QUANTIFIERS) : atom;
  }

  private atom(quantFree: boolean): string {
    this.budget.atoms--;
    const canGroup = this.budget.depth > 0 && this.budget.atoms > 0;
    if (!canGroup || this.rng.next() < 0.5) {
      const r = this.rng.next();
      if (r < 0.5) return this.charLiteral();
      if (r < 0.7) return '.';
      return this.charClass();
    }
    this.budget.depth--;
    const inner = this.alt(quantFree);
    this.budget.depth++;
    return `(${inner})`;
  }

  private charLiteral(): string {
    if (this.rng.bool(0.8)) return this.rng.pick(PLAIN);
    return `\\${this.rng.pick(ESCAPABLE)}`;
  }

  private charClass(): string {
    const negated = this.rng.bool(0.3);
    const count = this.rng.intBetween(1, 3);
    let body = '';
    for (let i = 0; i < count; i++) {
      const r = this.rng.next();
      if (r < 0.35) {
        const a = this.rng.int(RANGE_LETTERS.length);
        const b = this.rng.int(RANGE_LETTERS.length);
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        body += `${RANGE_LETTERS[lo]}-${RANGE_LETTERS[hi]}`;
      } else if (r < 0.75) {
        body += this.rng.pick(PLAIN);
      } else {
        body += `\\${this.rng.pick(ESCAPABLE)}`;
      }
    }
    return `[${negated ? '^' : ''}${body}]`;
  }
}

function genString(rng: Rng, maxLen: number): string {
  const len = rng.int(maxLen + 1);
  let s = '';
  for (let i = 0; i < len; i++) s += rng.pick(TEST_CHARS);
  return s;
}

const SEED = 0x9e3779b9;
const MAX_STRING = 12;

describe('fuzz: differential test against host RegExp + cross-automaton agreement', () => {
  it('5000 seeded patterns: all four recognizers agree with the host oracle', () => {
    const rng = new Rng(SEED);
    const gen = new PatternGen(rng, /* nested */ false);
    const ITERATIONS = 5000;
    let bothRejectedInvalid = 0;

    for (let i = 0; i < ITERATIONS; i++) {
      const pattern = gen.pattern(4, 8);
      const input = genString(rng, MAX_STRING);

      // Host oracle with anchored full-match semantics + parse-error parity.
      let re: RegExp | null = null;
      try {
        re = new RegExp(`^(?:${pattern})$`);
      } catch {
        // The host rejected this as a syntax error; the engine must too.
        let engineRejected = false;
        try {
          compile(pattern);
        } catch (e) {
          if (e instanceof RegexSyntaxError) engineRejected = true;
          else throw e;
        }
        expect(
          engineRejected,
          `host threw for pattern=${JSON.stringify(pattern)} but engine accepted it`,
        ).toBe(true);
        bothRejectedInvalid++;
        continue;
      }

      const expected = re.test(input);

      let c: ReturnType<typeof compile>;
      try {
        c = compile(pattern);
      } catch (e) {
        throw new Error(
          `engine failed to compile host-valid pattern=${JSON.stringify(pattern)}: ${String(e)}`,
        );
      }

      const ctx = `pattern=${JSON.stringify(pattern)} input=${JSON.stringify(input)} expected=${expected} (seed=${SEED}, iter=${i})`;
      expect(c.testNfa(input), `NFA diverged: ${ctx}`).toBe(expected);
      expect(c.testDfa(input), `DFA diverged: ${ctx}`).toBe(expected);
      expect(c.test(input), `min-DFA diverged: ${ctx}`).toBe(expected);

      const bt = c.backtrack(input, { maxSteps: 50_000_000 });
      if (!bt.timedOut) {
        expect(bt.matched, `backtracker diverged: ${ctx}`).toBe(expected);
      }
    }

    // Sanity: the generator overwhelmingly produces valid, comparable patterns.
    expect(bothRejectedInvalid).toBeLessThan(ITERATIONS * 0.1);
  });
});

describe('fuzz: nested-quantifier patterns — internal automaton agreement', () => {
  it('NFA, DFA and minimized DFA agree on adversarial-shaped patterns', () => {
    // This block exercises nested quantifiers ((a*)*, (a+)+, ...), which the
    // host oracle cannot evaluate safely. We instead assert that the three
    // automata agree with each other on every input — catching subset-construction
    // and Hopcroft bugs on exactly the shapes the host-checked block avoids.
    const rng = new Rng(SEED ^ 0x5bd1e995);
    const gen = new PatternGen(rng, /* nested */ true);
    const ITERATIONS = 2000;

    for (let i = 0; i < ITERATIONS; i++) {
      const pattern = gen.pattern(3, 6);
      const input = genString(rng, MAX_STRING);

      let c: ReturnType<typeof compile>;
      try {
        c = compile(pattern);
      } catch (e) {
        if (e instanceof RegexSyntaxError) continue;
        throw e;
      }

      const nfa = c.testNfa(input);
      const ctx = `pattern=${JSON.stringify(pattern)} input=${JSON.stringify(input)} (seed=${SEED}, iter=${i})`;
      expect(c.testDfa(input), `DFA != NFA: ${ctx} nfa=${nfa}`).toBe(nfa);
      expect(c.test(input), `min-DFA != NFA: ${ctx} nfa=${nfa}`).toBe(nfa);
    }
  });
});
