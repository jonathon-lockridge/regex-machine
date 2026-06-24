/**
 * The catastrophic-backtracking (ReDoS) benchmark.
 *
 * Runs the adversarial pattern `(a+)+` against a^N followed by exactly one
 * non-'a' character ('!') — the worst case is the REJECT path forced by that
 * trailing character, not the (no-op here) `$`. For growing N we time the naive
 * backtracker (exponential) against the linear NFA simulation (flat). The naive
 * runner is capped by BOTH a max N and a per-run wall-clock deadline so the page
 * can never hang; the engine is then shown answering a^5000+'!' essentially
 * instantly.
 *
 * Timings are real `performance.now()` measurements and therefore vary by
 * machine — this is demonstration only, never asserted in CI (CI uses the
 * deterministic step-count proxy instead).
 */
import { compile } from '../engine/index.js';

export interface RedosPoint {
  n: number;
  naiveMs: number | null; // null once the naive runner is capped
  engineMs: number;
}

export interface RedosResult {
  pattern: string;
  points: RedosPoint[];
  naiveCappedAt: number | null;
  bigN: number;
  engineBigMs: number;
}

const NAIVE_MAX_N = 30;
const NAIVE_BUDGET_MS = 120; // per-run wall-clock cap for the naive foil

export function runRedosBenchmark(): RedosResult {
  const pattern = '(a+)+';
  const c = compile(pattern);
  const points: RedosPoint[] = [];
  let naiveCappedAt: number | null = null;

  for (let n = 3; n <= NAIVE_MAX_N; n++) {
    const input = `${'a'.repeat(n)}!`;

    // Linear NFA simulation timing (averaged over a few runs for stability).
    let engineMs = Number.POSITIVE_INFINITY;
    for (let t = 0; t < 5; t++) {
      const e0 = performance.now();
      c.testNfa(input);
      engineMs = Math.min(engineMs, performance.now() - e0);
    }

    // Naive backtracker with a hard wall-clock deadline.
    const t0 = performance.now();
    const res = c.backtrack(input, { deadlineMs: t0 + NAIVE_BUDGET_MS });
    const naiveMs = res.timedOut ? null : performance.now() - t0;
    points.push({ n, naiveMs, engineMs });

    if (res.timedOut) {
      naiveCappedAt = n;
      break;
    }
  }

  // Demonstrate the engine stays flat at a scale the naive foil cannot touch.
  const bigN = 5000;
  const bigInput = `${'a'.repeat(bigN)}!`;
  let engineBigMs = Number.POSITIVE_INFINITY;
  for (let t = 0; t < 5; t++) {
    const b0 = performance.now();
    c.testNfa(bigInput);
    engineBigMs = Math.min(engineBigMs, performance.now() - b0);
  }

  return { pattern, points, naiveCappedAt, bigN, engineBigMs };
}

export function renderRedosChart(result: RedosResult, width = 720, height = 300): string {
  const padL = 56;
  const padR = 20;
  const padT = 18;
  const padB = 40;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const finite = result.points.filter((p) => p.naiveMs !== null) as Array<
    RedosPoint & { naiveMs: number }
  >;
  const nMax = Math.max(...result.points.map((p) => p.n), 1);
  const nMin = Math.min(...result.points.map((p) => p.n), 0);
  const yMax = Math.max(...finite.map((p) => p.naiveMs), 1);

  const xOf = (n: number): number => padL + ((n - nMin) / Math.max(1, nMax - nMin)) * plotW;
  const yOf = (ms: number): number => padT + plotH - (ms / yMax) * plotH;

  const parts: string[] = [];

  // Grid + y labels.
  const yticks = 4;
  for (let i = 0; i <= yticks; i++) {
    const ms = (yMax / yticks) * i;
    const y = yOf(ms);
    parts.push(`<line class="chart-grid" x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}"/>`);
    parts.push(`<text class="chart-text" x="${padL - 8}" y="${y + 3}" text-anchor="end">${ms.toFixed(0)}ms</text>`);
  }
  // Axes.
  parts.push(`<line class="chart-axis" x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}"/>`);
  parts.push(`<line class="chart-axis" x1="${padL}" y1="${padT + plotH}" x2="${width - padR}" y2="${padT + plotH}"/>`);
  // X labels.
  for (const p of result.points) {
    if (p.n % 3 === 0 || p.n === nMax) {
      parts.push(`<text class="chart-text" x="${xOf(p.n)}" y="${padT + plotH + 16}" text-anchor="middle">${p.n}</text>`);
    }
  }
  parts.push(`<text class="chart-text" x="${padL + plotW / 2}" y="${height - 4}" text-anchor="middle">N = number of leading 'a's (input = aᴺ + '!')</text>`);

  // Engine line (flat near zero).
  const engPts = result.points.map((p) => `${xOf(p.n)},${yOf(p.engineMs)}`).join(' ');
  parts.push(`<polyline class="chart-line engine" points="${engPts}"/>`);
  for (const p of result.points) {
    parts.push(`<circle class="chart-dot engine" cx="${xOf(p.n)}" cy="${yOf(p.engineMs)}" r="2.5"/>`);
  }

  // Naive line (exponential).
  const naivePts = finite.map((p) => `${xOf(p.n)},${yOf(p.naiveMs)}`).join(' ');
  parts.push(`<polyline class="chart-line naive" points="${naivePts}"/>`);
  for (const p of finite) {
    parts.push(`<circle class="chart-dot naive" cx="${xOf(p.n)}" cy="${yOf(p.naiveMs)}" r="2.5"/>`);
  }

  // Cap annotation.
  if (result.naiveCappedAt !== null) {
    const x = xOf(result.naiveCappedAt);
    parts.push(`<line class="chart-axis" x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke-dasharray="3 3"/>`);
    parts.push(`<text class="chart-cap" x="${x - 4}" y="${padT + 12}" text-anchor="end">naive capped at N=${result.naiveCappedAt} (&gt;${NAIVE_BUDGET_MS}ms)</text>`);
  }

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}
