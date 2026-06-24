/**
 * SVG rendering for the four diagrams.
 *
 * Converts engine artifacts (AST, NFA, DFA, minimized DFA) into node/edge
 * models, lays them out (layout.ts), and emits SVG markup. The NFA renderer
 * takes an optional highlight set so the step-through can light up the current
 * active states.
 */
import type { AstNode } from '../engine/ast.js';
import type { Nfa } from '../engine/nfa.js';
import type { Dfa } from '../engine/dfa.js';
import {
  layeredLayout,
  treeLayout,
  type Point,
  type TreeNode,
} from './layout.js';

const R = 16; // automaton node radius

interface VizNode {
  id: string;
  label: string;
  accepting: boolean;
  start: boolean;
  trap: boolean;
}
interface VizEdge {
  from: string;
  to: string;
  label: string;
  epsilon: boolean;
  toTrap: boolean;
}
interface VizGraph {
  nodes: VizNode[];
  edges: VizEdge[];
  startId: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Model builders ---

export function nfaToGraph(nfa: Nfa): VizGraph {
  const nodes: VizNode[] = nfa.states.map((s) => ({
    id: String(s.id),
    label: String(s.id),
    accepting: s.id === nfa.accept,
    start: s.id === nfa.start,
    trap: false,
  }));
  const edges: VizEdge[] = [];
  for (const st of nfa.states) {
    for (const tr of st.transitions) {
      edges.push({
        from: String(st.id),
        to: String(tr.to),
        label: tr.set === null ? 'ε' : tr.label,
        epsilon: tr.set === null,
        toTrap: false,
      });
    }
  }
  return { nodes, edges, startId: String(nfa.start) };
}

export function dfaToGraph(dfa: Dfa): VizGraph {
  const numClasses = dfa.alphabet.numClasses;
  const nodes: VizNode[] = [];
  for (let s = 0; s < dfa.numStates; s++) {
    nodes.push({
      id: String(s),
      label: String(s),
      accepting: dfa.accepting[s] ?? false,
      start: s === dfa.start,
      trap: s === dfa.trap,
    });
  }
  const edges: VizEdge[] = [];
  for (let s = 0; s < dfa.numStates; s++) {
    const row = dfa.transitions[s] as readonly number[];
    const byTarget = new Map<number, string[]>();
    for (let c = 0; c < numClasses; c++) {
      const to = row[c] as number;
      const lbl = dfa.alphabet.classes[c]?.label ?? '?';
      const arr = byTarget.get(to);
      if (arr) arr.push(lbl);
      else byTarget.set(to, [lbl]);
    }
    for (const [to, labels] of byTarget) {
      const label = labels.length === numClasses ? 'Σ' : combineLabels(labels);
      edges.push({
        from: String(s),
        to: String(to),
        label,
        epsilon: false,
        toTrap: to === dfa.trap,
      });
    }
  }
  return { nodes, edges, startId: String(dfa.start) };
}

function combineLabels(labels: string[]): string {
  const unique = [...new Set(labels)];
  const joined = unique.join(',');
  return joined.length > 14 ? `${joined.slice(0, 13)}…` : joined;
}

// --- Automaton SVG ---

const DEFS = `
<defs>
  <marker id="arrow" markerWidth="9" markerHeight="9" refX="7.5" refY="4.5" orient="auto" markerUnits="userSpaceOnUse">
    <path d="M0,1 L8,4.5 L0,8 z" fill="#a39d8e"/>
  </marker>
  <marker id="arrow-start" markerWidth="9" markerHeight="9" refX="7.5" refY="4.5" orient="auto" markerUnits="userSpaceOnUse">
    <path d="M0,1 L8,4.5 L0,8 z" fill="#0f766e"/>
  </marker>
</defs>`;

export function renderAutomaton(graph: VizGraph, highlight?: ReadonlySet<string>): string {
  const layout = layeredLayout(
    graph.nodes.map((n) => n.id),
    graph.edges,
    graph.startId,
    { dx: 116, dy: 84, marginX: 54, marginY: 60 },
  );
  const pos = layout.positions;

  // Group parallel edges (same ordered pair) into one, joining labels.
  const grouped = new Map<string, VizEdge>();
  for (const e of graph.edges) {
    const key = `${e.from}->${e.to}`;
    const existing = grouped.get(key);
    if (existing) {
      const labels = new Set(existing.label.split(',').concat(e.label.split(',')));
      existing.label = combineLabels([...labels]);
    } else {
      grouped.set(key, { ...e });
    }
  }

  // Render in z-order: edge paths, then nodes, then edge labels on top — so a
  // label's background plate masks any line crossing under it and is never
  // hidden by a node.
  const paths: string[] = [];
  const labels: string[] = [];
  for (const e of grouped.values()) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const geom = e.from === e.to ? selfLoop(a, e) : edgePath(a, b, e);
    paths.push(geom.path);
    labels.push(geom.label);
  }

  const nodes: string[] = [];
  for (const n of graph.nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    nodes.push(renderNode(n, p, highlight?.has(n.id) ?? false));
  }

  const width = Math.max(layout.width, 120);
  const height = Math.max(layout.height + 24, 120);
  const body = [...paths, ...nodes, ...labels].join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${DEFS}${body}</svg>`;
}

/** A backgrounded edge label so it stays legible over crossing lines. */
function edgeLabel(x: number, y: number, text: string, epsilon: boolean): string {
  const n = [...text].length;
  const w = Math.max(14, n * 6.7 + 8);
  const cls = epsilon ? 'edge-label epsilon' : 'edge-label';
  return (
    `<rect class="edge-label-bg" x="${(x - w / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" width="${w.toFixed(1)}" height="16" rx="4"/>` +
    `<text class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${escapeXml(text)}</text>`
  );
}

function renderNode(n: VizNode, p: Point, active: boolean): string {
  const cls = ['node-circle', active ? 'active' : '', n.trap ? 'trap' : ''].filter(Boolean).join(' ');
  const labelCls = ['node-label', active ? 'active' : ''].filter(Boolean).join(' ');
  const parts: string[] = [];
  if (n.start) {
    parts.push(
      `<path class="start-arrow" d="M ${p.x - R - 22} ${p.y} L ${p.x - R - 3} ${p.y}" marker-end="url(#arrow-start)"/>`,
    );
  }
  parts.push(`<circle class="${cls}" cx="${p.x}" cy="${p.y}" r="${R}"/>`);
  if (n.accepting) {
    parts.push(
      `<circle class="node-circle accepting-ring ${active ? 'active' : ''}" cx="${p.x}" cy="${p.y}" r="${R - 4}"/>`,
    );
  }
  parts.push(`<text class="${labelCls}" x="${p.x}" y="${p.y}">${escapeXml(n.label)}</text>`);
  return parts.join('');
}

interface EdgeRender {
  path: string;
  label: string;
}

function edgePath(a: Point, b: Point, e: VizEdge): EdgeRender {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Bow consistently to the left of each edge's own direction. Because a
  // reverse edge travels the opposite way, the pair automatically separates;
  // forward edges arc upward. Back/level edges bow more to clear nodes.
  const forward = dx > 1;
  const mag = forward ? 22 : 40;
  const perp = unit(dy, -dx); // left normal, biased "up" for forward edges
  const mx = (a.x + b.x) / 2 + perp.x * mag;
  const my = (a.y + b.y) / 2 + perp.y * mag;

  // Trim endpoints to the node boundary along the curve tangents.
  const startDir = unit(mx - a.x, my - a.y);
  const endDir = unit(b.x - mx, b.y - my);
  const sx = a.x + startDir.x * R;
  const sy = a.y + startDir.y * R;
  const ex = b.x - endDir.x * (R + 2);
  const ey = b.y - endDir.y * (R + 2);

  const cls = ['edge-path', e.epsilon ? 'epsilon' : '', e.toTrap ? 'to-trap' : ''].filter(Boolean).join(' ');
  const lx = quadAt(sx, mx, ex, 0.5) + perp.x * 8;
  const ly = quadAt(sy, my, ey, 0.5) + perp.y * 8;
  return {
    path: `<path class="${cls}" d="M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}" marker-end="url(#arrow)"/>`,
    label: edgeLabel(lx, ly, e.label, e.epsilon),
  };
}

function selfLoop(p: Point, e: VizEdge): EdgeRender {
  const x1 = p.x - R * 0.55;
  const x2 = p.x + R * 0.55;
  const y = p.y - R * 0.8;
  const top = p.y - R * 2.9;
  const cls = ['edge-path', e.epsilon ? 'epsilon' : ''].filter(Boolean).join(' ');
  return {
    path: `<path class="${cls}" d="M ${x1.toFixed(1)} ${y.toFixed(1)} C ${(p.x - R * 1.5).toFixed(1)} ${top.toFixed(1)} ${(p.x + R * 1.5).toFixed(1)} ${top.toFixed(1)} ${x2.toFixed(1)} ${y.toFixed(1)}" marker-end="url(#arrow)"/>`,
    label: edgeLabel(p.x, top + 1, e.label, e.epsilon),
  };
}

function unit(x: number, y: number): Point {
  const d = Math.hypot(x, y) || 1;
  return { x: x / d, y: y / d };
}
function quadAt(p0: number, p1: number, p2: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
}

// --- AST tree SVG ---

export function astToTree(ast: AstNode): TreeNode {
  let counter = 0;
  const make = (label: string, leaf: boolean, children: TreeNode[]): TreeNode => ({
    id: `n${counter++}`,
    label,
    leaf,
    children,
  });
  const build = (node: AstNode): TreeNode => {
    switch (node.type) {
      case 'empty':
        return make('ε', true, []);
      case 'charset':
        return make(node.label, true, []);
      case 'concat':
        return make('·', false, node.parts.map(build));
      case 'alt':
        return make('|', false, node.options.map(build));
      case 'star':
        return make('*', false, [build(node.node)]);
      case 'plus':
        return make('+', false, [build(node.node)]);
      case 'optional':
        return make('?', false, [build(node.node)]);
    }
  };
  return build(ast);
}

export function renderAst(ast: AstNode): string {
  const root = astToTree(ast);
  const layout = treeLayout(root, { dx: 52, dy: 60, marginX: 30, marginY: 26 });
  const pos = layout.positions;
  const boxH = 26;

  const parts: string[] = [];
  // Edges first (under boxes).
  const walkEdges = (node: TreeNode): void => {
    const p = pos.get(node.id);
    if (!p) return;
    for (const c of node.children) {
      const cp = pos.get(c.id);
      if (!cp) continue;
      parts.push(
        `<path class="ast-edge" d="M ${p.x} ${p.y + boxH / 2} C ${p.x} ${(p.y + cp.y) / 2} ${cp.x} ${(p.y + cp.y) / 2} ${cp.x} ${cp.y - boxH / 2}"/>`,
      );
      walkEdges(c);
    }
  };
  walkEdges(root);

  const walkNodes = (node: TreeNode): void => {
    const p = pos.get(node.id);
    if (!p) return;
    const w = Math.max(28, node.label.length * 8 + 14);
    parts.push(
      `<rect class="ast-box ${node.leaf ? 'leaf' : ''}" x="${p.x - w / 2}" y="${p.y - boxH / 2}" width="${w}" height="${boxH}" rx="7"/>` +
        `<text class="ast-label" x="${p.x}" y="${p.y}">${escapeXml(node.label)}</text>`,
    );
    for (const c of node.children) walkNodes(c);
  };
  walkNodes(root);

  const width = Math.max(layout.width, 120);
  const height = Math.max(layout.height + boxH, 100);
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}
