/**
 * Stage 2 — Parser.
 *
 * Tokens -> typed AST. Grammar, lowest precedence first:
 *
 *   alternation   := concatenation ('|' concatenation)*
 *   concatenation := quantified*
 *   quantified    := atom quantifier?            // at most ONE quantifier
 *   atom          := ATOM | '(' alternation ')'
 *
 * Anchors are validated here (see {@link splitAnchors}). All structural error
 * cases from the spec are raised as `RegexSyntaxError`, matching the host
 * `RegExp`: "Nothing to repeat" (a leading or stacked quantifier), unmatched
 * parentheses, and interior `^`/`$`.
 */
import type { AstNode } from './ast.js';
import type { Token } from './tokenizer.js';
import { tokenize } from './tokenizer.js';
import { RegexSyntaxError } from './errors.js';

/** True if the token stream has a `|` at parenthesis depth 0. */
function hasTopLevelAlternation(tokens: readonly Token[]): boolean {
  let depth = 0;
  for (const t of tokens) {
    if (t.kind === 'lparen') depth++;
    else if (t.kind === 'rparen') depth = Math.max(0, depth - 1);
    else if (t.kind === 'pipe' && depth === 0) return true;
  }
  return false;
}

/**
 * Strip a leading `^` and/or trailing `$` when — and only when — they anchor
 * the WHOLE pattern. If the pattern has a top-level alternation, a leading `^`
 * or trailing `$` would bind to a single branch (`^a|b` === `(^a)|b`), which is
 * a true zero-width assertion the host honors but this engine cannot model, so
 * it is rejected. Any `^`/`$` left in the body is an interior anchor -> error.
 */
function splitAnchors(tokens: readonly Token[]): Token[] {
  const topLevelAlt = hasTopLevelAlternation(tokens);
  let lo = 0;
  let hi = tokens.length;

  if (tokens[lo]?.kind === 'anchorStart') {
    if (topLevelAlt) {
      throw new RegexSyntaxError(
        '"^" may only anchor the whole pattern, not a single alternation branch',
        0,
      );
    }
    lo++;
  }
  if (hi - 1 >= lo && tokens[hi - 1]?.kind === 'anchorEnd') {
    if (topLevelAlt) {
      throw new RegexSyntaxError(
        '"$" may only anchor the whole pattern, not a single alternation branch',
        hi - 1,
      );
    }
    hi--;
  }
  return tokens.slice(lo, hi);
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: readonly Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  parse(): AstNode {
    const node = this.parseAlternation();
    const leftover = this.peek();
    if (leftover) {
      if (leftover.kind === 'rparen') {
        throw new RegexSyntaxError('Unmatched ")"', this.pos);
      }
      throw new RegexSyntaxError(`Unexpected token "${leftover.kind}"`, this.pos);
    }
    return node;
  }

  private parseAlternation(): AstNode {
    const options: AstNode[] = [this.parseConcatenation()];
    while (this.peek()?.kind === 'pipe') {
      this.pos++; // consume '|'
      options.push(this.parseConcatenation());
    }
    return options.length === 1 ? (options[0] as AstNode) : { type: 'alt', options };
  }

  private parseConcatenation(): AstNode {
    const parts: AstNode[] = [];
    while (true) {
      const t = this.peek();
      if (!t || t.kind === 'pipe' || t.kind === 'rparen') break;

      if (t.kind === 'star' || t.kind === 'plus' || t.kind === 'question') {
        throw new RegexSyntaxError(`Nothing to repeat before "${quantChar(t.kind)}"`, this.pos);
      }
      if (t.kind === 'anchorStart' || t.kind === 'anchorEnd') {
        throw new RegexSyntaxError(
          'Anchors "^" and "$" are only allowed at the very start/end of the pattern',
          this.pos,
        );
      }

      parts.push(this.parseQuantified());
    }
    if (parts.length === 0) return { type: 'empty' };
    if (parts.length === 1) return parts[0] as AstNode;
    return { type: 'concat', parts };
  }

  private parseQuantified(): AstNode {
    let node = this.parseAtom();
    const q = this.peek();
    if (q && (q.kind === 'star' || q.kind === 'plus' || q.kind === 'question')) {
      this.pos++; // consume the quantifier
      node =
        q.kind === 'star'
          ? { type: 'star', node }
          : q.kind === 'plus'
            ? { type: 'plus', node }
            : { type: 'optional', node };

      // A quantifier immediately following another quantifier is "Nothing to
      // repeat" in the host (no lazy/possessive support): a hard parse error.
      const next = this.peek();
      if (next && (next.kind === 'star' || next.kind === 'plus' || next.kind === 'question')) {
        throw new RegexSyntaxError(
          `Nothing to repeat before "${quantChar(next.kind)}" (stacked quantifier)`,
          this.pos,
        );
      }
    }
    return node;
  }

  private parseAtom(): AstNode {
    const t = this.peek();
    if (!t) {
      throw new RegexSyntaxError('Unexpected end of pattern', this.pos);
    }
    if (t.kind === 'atom') {
      this.pos++;
      return { type: 'charset', set: t.set, label: t.label };
    }
    if (t.kind === 'lparen') {
      this.pos++; // consume '('
      const inner = this.parseAlternation();
      const close = this.peek();
      if (!close || close.kind !== 'rparen') {
        throw new RegexSyntaxError('Unmatched "("', this.pos);
      }
      this.pos++; // consume ')'
      return inner;
    }
    // star/plus/question/pipe/rparen/anchors are all handled by callers.
    throw new RegexSyntaxError(`Unexpected token "${t.kind}"`, this.pos);
  }
}

function quantChar(kind: 'star' | 'plus' | 'question'): string {
  return kind === 'star' ? '*' : kind === 'plus' ? '+' : '?';
}

/** Parse a token stream into an AST. */
export function parseTokens(tokens: readonly Token[]): AstNode {
  return new Parser(splitAnchors(tokens)).parse();
}

/** Tokenize and parse a pattern string into an AST. */
export function parse(pattern: string): AstNode {
  return parseTokens(tokenize(pattern));
}
