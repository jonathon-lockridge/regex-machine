/**
 * Stage 5 — Subset construction (NFA -> total DFA).
 *
 * The DFA alphabet is a set of EQUIVALENCE CLASSES of code points: the universe
 * [0, 0xFFFF] is carved into the coarsest partition such that, within each
 * class, every CharSet in the NFA gives the same answer. This is the general
 * form of the spec's alphabet convention (section 2.7) — for a pattern over
 * `{a, b}` it produces exactly three classes `{a}`, `{b}`, `{other}` — and it
 * makes the DFA correct for ALL possible inputs, not merely a representative
 * sample.
 *
 * The DFA is TOTAL: every (state, class) pair has a transition, and a single
 * explicit trap (dead) state absorbs everything that cannot reach an accept.
 * That totality is what makes the minimality invariant in section 2.7
 * well-defined.
 */
import { CP_MAX, CharSet, type Interval } from './charset.js';
import { charLabel } from './tokenizer.js';
import { epsilonClosure, type Nfa } from './nfa.js';

/** One symbol of the DFA alphabet: a set of code points treated identically. */
export interface AlphabetClass {
  readonly index: number;
  /** Merged code-point intervals this class covers (for display). */
  readonly intervals: readonly Interval[];
  /** A representative code point inside the class. */
  readonly representative: number;
  /** Membership bitstring across the NFA's distinct CharSets (internal). */
  readonly signature: string;
  /** Readable edge label for the visualizer. */
  readonly label: string;
}

export interface Alphabet {
  readonly classes: readonly AlphabetClass[];
  readonly numClasses: number;
  /** Map any code point to its alphabet-class index. */
  classOf(cp: number): number;
}

export interface Dfa {
  readonly start: number;
  readonly numStates: number;
  /** transitions[state][classIndex] = target state (always defined; total). */
  readonly transitions: readonly (readonly number[])[];
  readonly accepting: readonly boolean[];
  readonly trap: number;
  readonly alphabet: Alphabet;
}

function renderClassLabel(intervals: readonly Interval[], hasMembership: boolean): string {
  const size = intervals.reduce((acc, [lo, hi]) => acc + (hi - lo + 1), 0);
  if (intervals.length === 1) {
    const iv = intervals[0] as Interval;
    if (iv[0] === iv[1]) return charLabel(iv[0]);
  }
  if (size > 12) return hasMembership ? '[…]' : 'other';
  const parts = intervals.map(([lo, hi]) =>
    lo === hi ? charLabel(lo) : `${charLabel(lo)}-${charLabel(hi)}`,
  );
  return `[${parts.join('')}]`;
}

/** Partition the code-point universe into the NFA's alphabet classes. */
function buildAlphabet(nfa: Nfa): Alphabet {
  // Distinct CharSets used on symbol transitions.
  const csMap = new Map<string, CharSet>();
  for (const st of nfa.states) {
    for (const tr of st.transitions) {
      if (tr.set !== null) csMap.set(tr.set.key(), tr.set);
    }
  }
  const charsets = [...csMap.values()];

  // Boundary points where membership can change, plus universe sentinels.
  const boundarySet = new Set<number>([0, CP_MAX + 1]);
  for (const cs of charsets) {
    for (const b of cs.boundaries()) boundarySet.add(b);
  }
  const bounds = [...boundarySet].sort((a, b) => a - b);

  // Elementary intervals [bounds[k], bounds[k+1]-1]; group by membership sig.
  const sigToClassIndex = new Map<string, number>();
  const classIntervals: Interval[][] = [];
  const elemClass: number[] = [];

  for (let k = 0; k < bounds.length - 1; k++) {
    const lo = bounds[k] as number;
    const hi = (bounds[k + 1] as number) - 1;
    let signature = '';
    for (const cs of charsets) signature += cs.test(lo) ? '1' : '0';

    let ci = sigToClassIndex.get(signature);
    if (ci === undefined) {
      ci = classIntervals.length;
      sigToClassIndex.set(signature, ci);
      classIntervals.push([]);
    }
    (classIntervals[ci] as Interval[]).push([lo, hi]);
    elemClass.push(ci);
  }

  const classes: AlphabetClass[] = [];
  for (const [signature, ci] of sigToClassIndex) {
    const merged = new CharSet(classIntervals[ci] as Interval[]).intervals;
    const rep = (merged[0] as Interval)[0];
    classes.push({
      index: ci,
      intervals: merged,
      representative: rep,
      signature,
      label: renderClassLabel(merged, signature.includes('1')),
    });
  }
  classes.sort((a, b) => a.index - b.index);

  const classOf = (cp: number): number => {
    let lo = 0;
    let hi = bounds.length - 2;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((bounds[mid] as number) <= cp) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return elemClass[ans] as number;
  };

  return { classes, numClasses: classes.length, classOf };
}

/** Subset construction: build a total DFA (with explicit trap) from an NFA. */
export function buildDfa(nfa: Nfa): Dfa {
  const alphabet = buildAlphabet(nfa);
  const numClasses = alphabet.numClasses;

  // For each distinct CharSet, which alphabet classes it matches.
  const csToClasses = new Map<string, number[]>();
  for (const st of nfa.states) {
    for (const tr of st.transitions) {
      if (tr.set === null) continue;
      const key = tr.set.key();
      if (csToClasses.has(key)) continue;
      const list: number[] = [];
      for (const cls of alphabet.classes) {
        if (tr.set.test(cls.representative)) list.push(cls.index);
      }
      csToClasses.set(key, list);
    }
  }

  const stateKey = (s: Set<number>): string =>
    [...s].sort((a, b) => a - b).join(',');

  const idOf = new Map<string, number>();
  const stateSets: Set<number>[] = [];
  const getId = (s: Set<number>): number => {
    const k = stateKey(s);
    let id = idOf.get(k);
    if (id === undefined) {
      id = stateSets.length;
      idOf.set(k, id);
      stateSets.push(s);
    }
    return id;
  };

  const startId = getId(epsilonClosure(nfa, [nfa.start]));

  const transitions: number[][] = [];
  const accepting: boolean[] = [];
  const processed = new Set<number>();
  const worklist = [startId];

  while (worklist.length > 0) {
    const id = worklist.pop() as number;
    if (processed.has(id)) continue;
    processed.add(id);

    const S = stateSets[id] as Set<number>;
    accepting[id] = S.has(nfa.accept);

    const targets: Set<number>[] = Array.from({ length: numClasses }, () => new Set<number>());
    for (const s of S) {
      const st = nfa.states[s];
      if (st === undefined) continue;
      for (const tr of st.transitions) {
        if (tr.set === null) continue;
        const classesForSet = csToClasses.get(tr.set.key());
        if (classesForSet === undefined) continue;
        for (const c of classesForSet) (targets[c] as Set<number>).add(tr.to);
      }
    }

    const row: number[] = new Array<number>(numClasses).fill(-1);
    for (let c = 0; c < numClasses; c++) {
      const raw = targets[c] as Set<number>;
      if (raw.size === 0) continue; // -> trap (filled in below)
      const closed = epsilonClosure(nfa, raw);
      const tid = getId(closed);
      row[c] = tid;
      if (!processed.has(tid)) worklist.push(tid);
    }
    transitions[id] = row;
  }

  // Append an explicit trap state and route every missing transition to it.
  const trapId = stateSets.length;
  for (let id = 0; id < trapId; id++) {
    const row = transitions[id] as number[];
    for (let c = 0; c < numClasses; c++) {
      if (row[c] === -1) row[c] = trapId;
    }
  }
  transitions[trapId] = new Array<number>(numClasses).fill(trapId);
  accepting[trapId] = false;

  return {
    start: startId,
    numStates: trapId + 1,
    transitions,
    accepting,
    trap: trapId,
    alphabet,
  };
}

/** Run an input string through a DFA. */
export function simulateDfa(dfa: Dfa, input: string): boolean {
  let s = dfa.start;
  for (let i = 0; i < input.length; i++) {
    const c = dfa.alphabet.classOf(input.charCodeAt(i));
    s = (dfa.transitions[s] as readonly number[])[c] as number;
  }
  return dfa.accepting[s] as boolean;
}
