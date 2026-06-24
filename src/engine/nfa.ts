/**
 * Stage 3 + 4 — Thompson construction and linear-time NFA simulation.
 *
 * `build` turns an AST into an NFA with epsilon transitions using the classic
 * Thompson rules (one fresh start and one fresh accept per fragment). `simulate`
 * runs it in O(states x input) by tracking the active state SET — never
 * backtracking — so there is no catastrophic blow-up. `runTrace` exposes the
 * per-character active sets that the visualizer steps through.
 *
 * epsilon-closure uses a visited set (mark-on-push), so epsilon CYCLES — which
 * arise from nullable quantifiers like `(a*)*`, `()*`, `(|a)*` — terminate
 * instead of looping forever.
 */
import type { AstNode } from './ast.js';
import type { CharSet } from './charset.js';
import { parse } from './parser.js';

/** A transition is either epsilon (`set === null`) or on a CharSet. */
export interface NfaTransition {
  readonly set: CharSet | null;
  readonly to: number;
  /** Display label (the source text of the atom, or "ε"). */
  readonly label: string;
}

export interface NfaState {
  readonly id: number;
  readonly transitions: NfaTransition[];
}

export interface Nfa {
  readonly start: number;
  readonly accept: number;
  readonly states: readonly NfaState[];
}

interface Fragment {
  readonly start: number;
  readonly accept: number;
}

class NfaBuilder {
  readonly states: NfaState[] = [];

  newState(): number {
    const id = this.states.length;
    this.states.push({ id, transitions: [] });
    return id;
  }

  private push(from: number, tr: NfaTransition): void {
    const st = this.states[from];
    if (st === undefined) throw new Error(`invalid NFA state ${from}`);
    st.transitions.push(tr);
  }

  epsilon(from: number, to: number): void {
    this.push(from, { set: null, to, label: 'ε' });
  }

  symbol(from: number, to: number, set: CharSet, label: string): void {
    this.push(from, { set, to, label });
  }

  build(node: AstNode): Fragment {
    switch (node.type) {
      case 'empty': {
        // A single state that is both entry and exit matches the empty string.
        const s = this.newState();
        return { start: s, accept: s };
      }
      case 'charset': {
        const s = this.newState();
        const a = this.newState();
        this.symbol(s, a, node.set, node.label);
        return { start: s, accept: a };
      }
      case 'concat': {
        if (node.parts.length === 0) {
          const s = this.newState();
          return { start: s, accept: s };
        }
        let frag = this.build(node.parts[0] as AstNode);
        const first = frag.start;
        for (let i = 1; i < node.parts.length; i++) {
          const next = this.build(node.parts[i] as AstNode);
          this.epsilon(frag.accept, next.start);
          frag = next;
        }
        return { start: first, accept: frag.accept };
      }
      case 'alt': {
        const s = this.newState();
        const a = this.newState();
        for (const opt of node.options) {
          const frag = this.build(opt);
          this.epsilon(s, frag.start);
          this.epsilon(frag.accept, a);
        }
        return { start: s, accept: a };
      }
      case 'star': {
        const s = this.newState();
        const a = this.newState();
        const frag = this.build(node.node);
        this.epsilon(s, frag.start); // enter the body
        this.epsilon(s, a); // skip (zero occurrences)
        this.epsilon(frag.accept, frag.start); // loop
        this.epsilon(frag.accept, a); // exit
        return { start: s, accept: a };
      }
      case 'plus': {
        const s = this.newState();
        const a = this.newState();
        const frag = this.build(node.node);
        this.epsilon(s, frag.start); // must enter at least once
        this.epsilon(frag.accept, frag.start); // loop
        this.epsilon(frag.accept, a); // exit
        return { start: s, accept: a };
      }
      case 'optional': {
        const s = this.newState();
        const a = this.newState();
        const frag = this.build(node.node);
        this.epsilon(s, frag.start); // one occurrence
        this.epsilon(s, a); // zero occurrences
        this.epsilon(frag.accept, a);
        return { start: s, accept: a };
      }
    }
  }
}

/** Build a Thompson NFA from an AST. */
export function buildNfa(ast: AstNode): Nfa {
  const b = new NfaBuilder();
  const frag = b.build(ast);
  return { start: frag.start, accept: frag.accept, states: b.states };
}

/** Tokenize + parse + build an NFA from a pattern string. */
export function compileNfa(pattern: string): Nfa {
  return buildNfa(parse(pattern));
}

/**
 * Epsilon-closure of a set of states. Uses a visited set so epsilon cycles
 * (from nullable quantifiers) terminate.
 */
export function epsilonClosure(nfa: Nfa, states: Iterable<number>): Set<number> {
  const closure = new Set<number>(states);
  const stack = [...closure];
  while (stack.length > 0) {
    const s = stack.pop() as number;
    const st = nfa.states[s];
    if (st === undefined) continue;
    for (const tr of st.transitions) {
      if (tr.set === null && !closure.has(tr.to)) {
        closure.add(tr.to);
        stack.push(tr.to);
      }
    }
  }
  return closure;
}

/** Code units of a string (matching host `RegExp` without the `u` flag). */
function codeUnits(input: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) out.push(input.charCodeAt(i));
  return out;
}

/** Step the active set by one input symbol, then take the epsilon-closure. */
function step(nfa: Nfa, active: Set<number>, cp: number): Set<number> {
  const moved = new Set<number>();
  for (const s of active) {
    const st = nfa.states[s];
    if (st === undefined) continue;
    for (const tr of st.transitions) {
      if (tr.set !== null && tr.set.test(cp)) moved.add(tr.to);
    }
  }
  return epsilonClosure(nfa, moved);
}

/** Linear-time recognition: does the WHOLE input match? */
export function simulateNfa(nfa: Nfa, input: string): boolean {
  let active = epsilonClosure(nfa, [nfa.start]);
  for (const cp of codeUnits(input)) {
    if (active.size === 0) return false;
    active = step(nfa, active, cp);
  }
  return active.has(nfa.accept);
}

/** One frame of an NFA run: the active set, and the symbol just consumed. */
export interface NfaTraceFrame {
  /** State ids active at this point (sorted for stable display). */
  readonly active: number[];
  /** The code unit consumed to reach this frame, or null for the initial frame. */
  readonly consumed: number | null;
}

/** The full step-by-step trace the visualizer animates. */
export interface NfaTrace {
  readonly frames: NfaTraceFrame[];
  readonly accepted: boolean;
}

/** Produce the per-character active sets for the visualizer's step-through. */
export function runTrace(nfa: Nfa, input: string): NfaTrace {
  const frames: NfaTraceFrame[] = [];
  let active = epsilonClosure(nfa, [nfa.start]);
  frames.push({ active: [...active].sort((a, b) => a - b), consumed: null });
  for (const cp of codeUnits(input)) {
    active = step(nfa, active, cp);
    frames.push({ active: [...active].sort((a, b) => a - b), consumed: cp });
  }
  return { frames, accepted: active.has(nfa.accept) };
}
