/**
 * Stage 6 — Hopcroft DFA minimization.
 *
 * Partition refinement on the total DFA: start from {accepting, non-accepting},
 * then repeatedly split any block whose members behave differently under some
 * alphabet class (computed efficiently via inverse transitions). Unreachable
 * states are dropped first, so the result is the canonical minimal DFA for the
 * language — unique up to renaming, relative to this alphabet (section 2.7).
 *
 * Because the input DFA is total, the output is total too, which is what makes
 * the idempotence invariant `|minimize(minimize(D))| === |minimize(D)|` exact.
 */
import type { Dfa } from './dfa.js';

export function minimizeDfa(dfa: Dfa): Dfa {
  const k = dfa.alphabet.numClasses;

  // 1. Reachable states from the start.
  const reachable = new Set<number>([dfa.start]);
  const stack = [dfa.start];
  while (stack.length > 0) {
    const s = stack.pop() as number;
    const row = dfa.transitions[s] as readonly number[];
    for (let c = 0; c < k; c++) {
      const t = row[c] as number;
      if (!reachable.has(t)) {
        reachable.add(t);
        stack.push(t);
      }
    }
  }

  // 2. Inverse transitions among reachable states: inv[c].get(target) = sources.
  const inv: Array<Map<number, number[]>> = Array.from({ length: k }, () => new Map());
  for (const p of reachable) {
    const row = dfa.transitions[p] as readonly number[];
    for (let c = 0; c < k; c++) {
      const t = row[c] as number;
      const m = inv[c] as Map<number, number[]>;
      const arr = m.get(t);
      if (arr) arr.push(p);
      else m.set(t, [p]);
    }
  }

  // 3. Initial partition: accepting vs non-accepting.
  const accept = new Set<number>();
  const reject = new Set<number>();
  for (const s of reachable) {
    if (dfa.accepting[s]) accept.add(s);
    else reject.add(s);
  }
  const partition: Set<number>[] = [];
  if (accept.size > 0) partition.push(accept);
  if (reject.size > 0) partition.push(reject);

  const worklist: Set<number>[] = [...partition];

  // 4. Refine.
  while (worklist.length > 0) {
    const A = worklist.pop() as Set<number>;
    for (let c = 0; c < k; c++) {
      // X = states whose c-transition lands inside A.
      const X = new Set<number>();
      const m = inv[c] as Map<number, number[]>;
      for (const q of A) {
        const sources = m.get(q);
        if (sources) for (const p of sources) X.add(p);
      }
      if (X.size === 0) continue;

      for (let yi = 0; yi < partition.length; yi++) {
        const Y = partition[yi] as Set<number>;
        const inter = new Set<number>();
        const diff = new Set<number>();
        for (const s of Y) {
          if (X.has(s)) inter.add(s);
          else diff.add(s);
        }
        if (inter.size === 0 || diff.size === 0) continue;

        partition[yi] = inter;
        partition.push(diff);

        const widx = worklist.indexOf(Y);
        if (widx !== -1) {
          worklist[widx] = inter;
          worklist.push(diff);
        } else {
          worklist.push(inter.size <= diff.size ? inter : diff);
        }
      }
    }
  }

  // 5. Rebuild a DFA, one state per block. Number blocks so the start is 0.
  const blockOf = new Map<number, number>();
  partition.forEach((block, idx) => {
    for (const s of block) blockOf.set(s, idx);
  });
  const startBlock = blockOf.get(dfa.start) as number;

  // Stable renumbering with the start block first.
  const order: number[] = [startBlock];
  const seen = new Set<number>([startBlock]);
  for (let i = 0; i < partition.length; i++) {
    if (!seen.has(i)) {
      seen.add(i);
      order.push(i);
    }
  }
  const newId = new Map<number, number>();
  order.forEach((oldIdx, newIdx) => newId.set(oldIdx, newIdx));

  const numStates = partition.length;
  const transitions: number[][] = Array.from({ length: numStates }, () => []);
  const accepting: boolean[] = new Array<boolean>(numStates).fill(false);

  for (let oldIdx = 0; oldIdx < partition.length; oldIdx++) {
    const block = partition[oldIdx] as Set<number>;
    const rep = block.values().next().value as number;
    const nid = newId.get(oldIdx) as number;
    accepting[nid] = dfa.accepting[rep] as boolean;
    const repRow = dfa.transitions[rep] as readonly number[];
    const row: number[] = new Array<number>(k);
    for (let c = 0; c < k; c++) {
      const target = repRow[c] as number;
      row[c] = newId.get(blockOf.get(target) as number) as number;
    }
    transitions[nid] = row;
  }

  const trap = reachable.has(dfa.trap)
    ? (newId.get(blockOf.get(dfa.trap) as number) as number)
    : -1;

  return {
    start: 0,
    numStates,
    transitions,
    accepting,
    trap,
    alphabet: dfa.alphabet,
  };
}
