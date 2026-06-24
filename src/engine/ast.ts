/**
 * The typed AST produced by the parser and consumed by Thompson construction
 * and the naive backtracker.
 *
 * `empty` is the epsilon node — it matches the empty string. It is produced by
 * an empty group `()`, an empty alternation branch `(a|)`, and the empty
 * pattern. Anchors `^`/`$` are NOT AST nodes: they are accepted no-ops handled
 * (and validated) entirely by the parser, since a full-string matcher is
 * already anchored.
 */
import type { CharSet } from './charset.js';

export type AstNode =
  | EmptyNode
  | CharSetNode
  | ConcatNode
  | AltNode
  | StarNode
  | PlusNode
  | OptionalNode;

/** Matches the empty string (epsilon). */
export interface EmptyNode {
  readonly type: 'empty';
}

/** Matches a single input symbol described by a CharSet. */
export interface CharSetNode {
  readonly type: 'charset';
  readonly set: CharSet;
  readonly label: string;
}

/** Sequence: all parts in order. */
export interface ConcatNode {
  readonly type: 'concat';
  readonly parts: readonly AstNode[];
}

/** Alternation: any one option. */
export interface AltNode {
  readonly type: 'alt';
  readonly options: readonly AstNode[];
}

/** Kleene star: zero or more. */
export interface StarNode {
  readonly type: 'star';
  readonly node: AstNode;
}

/** Plus: one or more. */
export interface PlusNode {
  readonly type: 'plus';
  readonly node: AstNode;
}

/** Optional: zero or one. */
export interface OptionalNode {
  readonly type: 'optional';
  readonly node: AstNode;
}

/** A compact, parenthesized rendering of an AST — handy for tests and labels. */
export function astToString(node: AstNode): string {
  switch (node.type) {
    case 'empty':
      return 'ε';
    case 'charset':
      return node.label;
    case 'concat':
      return node.parts.map(astToString).join('');
    case 'alt':
      return `(${node.options.map(astToString).join('|')})`;
    case 'star':
      return `${wrap(node.node)}*`;
    case 'plus':
      return `${wrap(node.node)}+`;
    case 'optional':
      return `${wrap(node.node)}?`;
  }
}

function wrap(node: AstNode): string {
  // Parenthesize multi-symbol subexpressions so the rendering is unambiguous.
  // `alt` already self-parenthesizes, so only `concat` needs wrapping here.
  if (node.type === 'concat') return `(${astToString(node)})`;
  return astToString(node);
}
