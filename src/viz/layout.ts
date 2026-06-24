/**
 * Hand-rolled graph layout — no external dependency.
 *
 * `layeredLayout` ranks states by BFS distance from the start (a simple
 * Sugiyama-style layering), centers each rank vertically, and reports the
 * canvas size. `treeLayout` places an AST top-down, giving each leaf its own
 * column and centering parents over their children. Both are intentionally
 * small and good enough for the bounded automata the visualizer renders.
 */

export interface Point {
  x: number;
  y: number;
}

export interface LayeredOptions {
  dx: number;
  dy: number;
  marginX: number;
  marginY: number;
}

export interface LayeredResult {
  positions: Map<string, Point>;
  width: number;
  height: number;
}

export function layeredLayout(
  nodeIds: readonly string[],
  edges: readonly { from: string; to: string }[],
  startId: string,
  opts: LayeredOptions,
): LayeredResult {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    if (e.from !== e.to) adj.get(e.from)?.push(e.to);
  }

  // Rank = BFS distance from the start state.
  const rank = new Map<string, number>();
  if (nodeIds.includes(startId)) {
    rank.set(startId, 0);
    const queue = [startId];
    while (queue.length > 0) {
      const u = queue.shift() as string;
      const r = rank.get(u) as number;
      for (const v of adj.get(u) ?? []) {
        if (!rank.has(v)) {
          rank.set(v, r + 1);
          queue.push(v);
        }
      }
    }
  }
  // Anything unreachable from the start goes in a trailing column.
  let maxReached = 0;
  for (const r of rank.values()) maxReached = Math.max(maxReached, r);
  for (const id of nodeIds) {
    if (!rank.has(id)) rank.set(id, maxReached + 1);
  }

  const layers = new Map<number, string[]>();
  for (const id of nodeIds) {
    const r = rank.get(id) as number;
    const arr = layers.get(r);
    if (arr) arr.push(id);
    else layers.set(r, [id]);
  }

  let maxCount = 1;
  let maxLayer = 0;
  for (const [r, arr] of layers) {
    maxCount = Math.max(maxCount, arr.length);
    maxLayer = Math.max(maxLayer, r);
  }

  const positions = new Map<string, Point>();
  const totalHeight = (maxCount - 1) * opts.dy;
  for (const [r, arr] of [...layers.entries()].sort((a, b) => a[0] - b[0])) {
    const layerHeight = (arr.length - 1) * opts.dy;
    const offset = (totalHeight - layerHeight) / 2;
    arr.forEach((id, i) => {
      positions.set(id, {
        x: opts.marginX + r * opts.dx,
        y: opts.marginY + offset + i * opts.dy,
      });
    });
  }

  return {
    positions,
    width: opts.marginX * 2 + maxLayer * opts.dx,
    height: opts.marginY * 2 + totalHeight,
  };
}

export interface TreeNode {
  id: string;
  label: string;
  leaf: boolean;
  children: TreeNode[];
}

export interface TreeLayoutOptions {
  dx: number;
  dy: number;
  marginX: number;
  marginY: number;
}

export interface TreeLayoutResult {
  positions: Map<string, Point>;
  width: number;
  height: number;
}

export function treeLayout(root: TreeNode, opts: TreeLayoutOptions): TreeLayoutResult {
  const positions = new Map<string, Point>();
  let nextLeafX = 0;
  let maxDepth = 0;

  const assign = (node: TreeNode, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    const y = opts.marginY + depth * opts.dy;
    if (node.children.length === 0) {
      const x = opts.marginX + nextLeafX * opts.dx;
      nextLeafX++;
      positions.set(node.id, { x, y });
      return x;
    }
    const childXs = node.children.map((c) => assign(c, depth + 1));
    const x = (Math.min(...childXs) + Math.max(...childXs)) / 2;
    positions.set(node.id, { x, y });
    return x;
  };

  assign(root, 0);

  const leafSpan = Math.max(0, nextLeafX - 1) * opts.dx;
  return {
    positions,
    width: opts.marginX * 2 + leafSpan,
    height: opts.marginY * 2 + maxDepth * opts.dy,
  };
}
