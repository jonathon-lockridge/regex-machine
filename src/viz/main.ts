/**
 * regex-machine visualizer — entry point.
 *
 * A single-page app over the engine: it compiles the pattern, draws the AST,
 * NFA, DFA and minimized DFA, steps the linear NFA simulation character by
 * character with the active state-set highlighted, and runs the live ReDoS
 * benchmark. The engine modules are imported here; nothing in the engine
 * depends on the DOM.
 */
import './styles.css';
import { compile, type Compiled } from '../engine/index.js';
import { RegexSyntaxError } from '../engine/errors.js';
import type { NfaTrace } from '../engine/nfa.js';
import { renderAutomaton, renderAst, nfaToGraph, dfaToGraph } from './render.js';
import { runRedosBenchmark, renderRedosChart } from './redos.js';

const EXAMPLES = ['(a|b)*abb', 'a(b|c)+d', '[a-z]+@[a-z]+', 'colou?r', '(ab)*', '(a+)+'];

const app = document.getElementById('app');
if (!app) throw new Error('#app not found');

app.innerHTML = `
  <header class="masthead">
    <div>
      <h1><span class="mono">regex-machine</span></h1>
      <p>A from-scratch finite-automaton regex engine. Linear-time recognition, no
         catastrophic backtracking — visualized end to end.</p>
    </div>
  </header>

  <div class="controls">
    <div class="field">
      <label for="pattern">Pattern</label>
      <input id="pattern" spellcheck="false" autocomplete="off" autocapitalize="off" />
      <div class="error-msg" id="pattern-error"></div>
    </div>
    <div class="field">
      <label for="input">Test string (full-string match)</label>
      <input id="input" spellcheck="false" autocomplete="off" autocapitalize="off" />
      <div class="error-msg"></div>
    </div>
  </div>

  <div class="examples" id="examples"><span>try:</span></div>

  <section class="stepper">
    <div class="stepper-head">
      <h2 class="section-title">NFA simulation — step through the input</h2>
      <span class="verdict" id="verdict">—</span>
    </div>
    <div class="tape" id="tape"></div>
    <div class="buttons">
      <button class="btn" id="reset">Reset</button>
      <button class="btn" id="back">‹ Back</button>
      <button class="btn primary" id="forward">Step ›</button>
      <button class="btn" id="toend">To end »</button>
      <span class="step-readout" id="readout"></span>
    </div>
  </section>

  <div class="graphs">
    <div class="panel">
      <div class="panel-head"><h2 class="section-title">AST</h2><span class="count" id="ast-count"></span></div>
      <div class="scroll" id="ast"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2 class="section-title">NFA (Thompson)</h2><span class="count" id="nfa-count"></span></div>
      <div class="scroll" id="nfa"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2 class="section-title">DFA (subset construction)</h2><span class="count" id="dfa-count"></span></div>
      <div class="scroll" id="dfa"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2 class="section-title">Minimized DFA (Hopcroft)</h2><span class="count" id="mindfa-count"></span></div>
      <div class="scroll" id="mindfa"></div>
    </div>
  </div>

  <section class="redos">
    <div class="redos-head">
      <h2 class="section-title">Catastrophic backtracking (ReDoS) benchmark</h2>
      <button class="btn primary" id="run-redos">Run benchmark</button>
    </div>
    <p class="note">
      Pattern <code>(a+)+</code> against <code>aᴺ + '!'</code>. The naive backtracker
      (red) blows up exponentially on the reject path; the linear NFA engine (teal)
      stays flat. The naive runner is capped by N and a wall-clock budget so this
      page can never hang.
    </p>
    <div class="legend">
      <span class="key"><span class="swatch naive"></span> naive backtracker</span>
      <span class="key"><span class="swatch engine"></span> linear NFA engine</span>
    </div>
    <div id="redos-chart"></div>
    <p class="note" id="redos-summary"></p>
  </section>

  <footer class="colophon">
    Built with TypeScript + Vite. Engine, automata and layout are all hand-rolled —
    no regex or graph-layout libraries. See the repository README for the supported
    syntax and the self-verification (differential fuzzing) story.
  </footer>
`;

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element #${id}`);
  return found as T;
}

const patternInput = el<HTMLInputElement>('pattern');
const stringInput = el<HTMLInputElement>('input');
const patternError = el('pattern-error');
const tapeEl = el('tape');
const verdictEl = el('verdict');
const readoutEl = el('readout');
const astEl = el('ast');
const nfaEl = el('nfa');
const dfaEl = el('dfa');
const mindfaEl = el('mindfa');

const resetBtn = el<HTMLButtonElement>('reset');
const backBtn = el<HTMLButtonElement>('back');
const forwardBtn = el<HTMLButtonElement>('forward');
const toEndBtn = el<HTMLButtonElement>('toend');
const runRedosBtn = el<HTMLButtonElement>('run-redos');

interface State {
  compiled: Compiled | null;
  trace: NfaTrace | null;
  step: number;
}
const state: State = { compiled: null, trace: null, step: 0 };

// Example chips.
const examplesEl = el('examples');
for (const ex of EXAMPLES) {
  const chip = document.createElement('button');
  chip.className = 'chip';
  chip.textContent = ex;
  chip.addEventListener('click', () => {
    patternInput.value = ex;
    recompile();
  });
  examplesEl.appendChild(chip);
}

function recompile(): void {
  const pattern = patternInput.value;
  try {
    const compiled = compile(pattern);
    state.compiled = compiled;
    patternInput.classList.remove('invalid');
    patternError.textContent = '';
    renderArtifacts(compiled);
    rebuildTrace();
  } catch (e) {
    state.compiled = null;
    state.trace = null;
    patternInput.classList.add('invalid');
    patternError.textContent =
      e instanceof RegexSyntaxError ? e.message : `Error: ${String(e)}`;
    astEl.innerHTML = '';
    nfaEl.innerHTML = '';
    dfaEl.innerHTML = '';
    mindfaEl.innerHTML = '';
    el('ast-count').textContent = '';
    el('nfa-count').textContent = '';
    el('dfa-count').textContent = '';
    el('mindfa-count').textContent = '';
    renderStepper();
  }
}

function renderArtifacts(c: Compiled): void {
  astEl.innerHTML = renderAst(c.ast);
  nfaEl.innerHTML = renderAutomaton(nfaToGraph(c.nfa));
  dfaEl.innerHTML = renderAutomaton(dfaToGraph(c.dfa));
  mindfaEl.innerHTML = renderAutomaton(dfaToGraph(c.minDfa));
  el('nfa-count').textContent = `${c.nfa.states.length} states`;
  el('dfa-count').textContent = `${c.dfa.numStates} states`;
  el('mindfa-count').textContent = `${c.minDfa.numStates} states`;
}

function rebuildTrace(): void {
  if (!state.compiled) return;
  state.trace = state.compiled.trace(stringInput.value);
  state.step = 0;
  renderStepper();
}

function renderStepper(): void {
  const c = state.compiled;
  const trace = state.trace;
  if (!c || !trace) {
    tapeEl.innerHTML = '<span class="tape-empty">Enter a valid pattern to step through the NFA.</span>';
    verdictEl.textContent = '—';
    verdictEl.className = 'verdict';
    readoutEl.textContent = '';
    setButtons(false);
    return;
  }

  const input = stringInput.value;
  const lastStep = trace.frames.length - 1;
  const frame = trace.frames[state.step];

  // Tape: consumed cells before the cursor, the cursor on the next char.
  if (input.length === 0) {
    tapeEl.innerHTML = '<span class="tape-empty">(empty input)</span>';
  } else {
    const cells = [...input].map((ch, i) => {
      const consumed = i < state.step;
      const cursor = i === state.step;
      const cls = ['cell', consumed ? 'consumed' : '', cursor ? 'cursor' : ''].filter(Boolean).join(' ');
      return `<span class="${cls}">${displayChar(ch)}</span>`;
    });
    tapeEl.innerHTML = cells.join('');
  }

  // Re-render the NFA with the active set highlighted.
  const highlight = new Set((frame?.active ?? []).map((id) => String(id)));
  nfaEl.innerHTML = renderAutomaton(nfaToGraph(c.nfa), highlight);

  readoutEl.textContent = `step ${state.step} / ${lastStep} · active: {${(frame?.active ?? []).join(', ')}}`;

  if (state.step === lastStep) {
    verdictEl.textContent = trace.accepted ? 'ACCEPTED' : 'REJECTED';
    verdictEl.className = `verdict ${trace.accepted ? 'accept' : 'reject'}`;
  } else {
    verdictEl.textContent = `stepping (${state.step}/${lastStep})`;
    verdictEl.className = 'verdict';
  }

  setButtons(true);
  backBtn.disabled = state.step === 0;
  forwardBtn.disabled = state.step === lastStep;
  toEndBtn.disabled = state.step === lastStep;
}

function setButtons(enabled: boolean): void {
  resetBtn.disabled = !enabled;
  backBtn.disabled = !enabled;
  forwardBtn.disabled = !enabled;
  toEndBtn.disabled = !enabled;
}

function displayChar(ch: string): string {
  const cp = ch.charCodeAt(0);
  if (cp === 0x09) return '\\t';
  if (cp === 0x20) return '␣';
  if (cp < 0x20) return `\\x${cp.toString(16).padStart(2, '0')}`;
  return ch === '<' ? '&lt;' : ch === '&' ? '&amp;' : ch;
}

function stepBy(delta: number): void {
  if (!state.trace) return;
  const last = state.trace.frames.length - 1;
  state.step = Math.max(0, Math.min(last, state.step + delta));
  renderStepper();
}

resetBtn.addEventListener('click', () => {
  state.step = 0;
  renderStepper();
});
backBtn.addEventListener('click', () => stepBy(-1));
forwardBtn.addEventListener('click', () => stepBy(1));
toEndBtn.addEventListener('click', () => {
  if (!state.trace) return;
  state.step = state.trace.frames.length - 1;
  renderStepper();
});

patternInput.addEventListener('input', recompile);
stringInput.addEventListener('input', rebuildTrace);

// ReDoS benchmark (deferred so the button can show its disabled state first).
runRedosBtn.addEventListener('click', () => {
  runRedosBtn.disabled = true;
  runRedosBtn.textContent = 'Running…';
  window.setTimeout(() => {
    const result = runRedosBenchmark();
    el('redos-chart').innerHTML = renderRedosChart(result);
    const cap = result.naiveCappedAt;
    el('redos-summary').innerHTML =
      `The naive matcher was halted${cap !== null ? ` at N=${cap}` : ''} once a single run exceeded the wall-clock budget. ` +
      `The linear NFA engine matched <code>a<sup>${result.bigN}</sup> + '!'</code> in ` +
      `${result.engineBigMs.toFixed(2)}ms — flat, no backtracking.`;
    runRedosBtn.disabled = false;
    runRedosBtn.textContent = 'Run benchmark';
  }, 30);
});

// Programmatic API for screenshots / automation.
(window as unknown as Record<string, unknown>).__viz = {
  setPattern(p: string): void {
    patternInput.value = p;
    recompile();
  },
  setInput(s: string): void {
    stringInput.value = s;
    rebuildTrace();
  },
  step(n: number): void {
    if (!state.trace) return;
    state.step = Math.max(0, Math.min(state.trace.frames.length - 1, n));
    renderStepper();
  },
  runBenchmark(): void {
    const result = runRedosBenchmark();
    el('redos-chart').innerHTML = renderRedosChart(result);
    const cap = result.naiveCappedAt;
    el('redos-summary').innerHTML =
      `The naive matcher was halted${cap !== null ? ` at N=${cap}` : ''} once a single run exceeded the wall-clock budget. ` +
      `The linear NFA engine matched <code>a<sup>${result.bigN}</sup> + '!'</code> in ` +
      `${result.engineBigMs.toFixed(2)}ms — flat, no backtracking.`;
  },
};

// Initial sample.
patternInput.value = '(a|b)*abb';
stringInput.value = 'aababb';
recompile();
