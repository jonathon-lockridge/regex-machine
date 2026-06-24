/**
 * Stage 1 — Tokenizer.
 *
 * Turns a pattern string into a flat token stream. It fully resolves escapes
 * and character-class internals: every "matches one input symbol" construct
 * (literal char, `.`, `[...]`, `\d \w \s \D \W \S`) collapses into a single
 * `atom` token carrying a `CharSet`. The parser therefore never has to know
 * where an atom came from — it just has a set to match — which keeps the
 * grammar small.
 *
 * Structural errors that the host `RegExp` constructor also rejects are raised
 * here as `RegexSyntaxError`: unterminated class, empty class `[]`/`[^]`,
 * reversed range `[z-a]`, trailing/unsupported escapes.
 */
import {
  CharSet,
  DIGIT,
  WORD,
  SPACE,
  NOT_DIGIT,
  NOT_WORD,
  NOT_SPACE,
} from './charset.js';
import { RegexSyntaxError } from './errors.js';

export type Token =
  | { kind: 'atom'; set: CharSet; label: string }
  | { kind: 'star' }
  | { kind: 'plus' }
  | { kind: 'question' }
  | { kind: 'pipe' }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'anchorStart' }
  | { kind: 'anchorEnd' };

/** Metacharacters that may be backslash-escaped to mean their literal self. */
const ESCAPABLE_METACHARS = new Set<string>([
  '(', ')', '[', ']', '{', '}', '.', '*', '+', '?', '|', '^', '$', '\\', '-',
]);

/** A human-readable label for a single code point (for the visualizer / tests). */
export function charLabel(cp: number): string {
  switch (cp) {
    case 0x09:
      return '\\t';
    case 0x0a:
      return '\\n';
    case 0x0d:
      return '\\r';
    case 0x20:
      return '␣';
  }
  if (cp >= 0x21 && cp <= 0x7e) return String.fromCharCode(cp);
  return `\\u${cp.toString(16).padStart(4, '0')}`;
}

/** Result of reading one item inside a character class. */
type ClassAtom = { type: 'char'; cp: number } | { type: 'set'; set: CharSet };

class Tokenizer {
  private i = 0;
  constructor(private readonly src: string) {}

  tokenize(): Token[] {
    const tokens: Token[] = [];
    const src = this.src;
    while (this.i < src.length) {
      const start = this.i;
      const c = src[this.i] as string;
      switch (c) {
        case '*':
          tokens.push({ kind: 'star' });
          this.i++;
          break;
        case '+':
          tokens.push({ kind: 'plus' });
          this.i++;
          break;
        case '?':
          tokens.push({ kind: 'question' });
          this.i++;
          break;
        case '|':
          tokens.push({ kind: 'pipe' });
          this.i++;
          break;
        case '(':
          tokens.push({ kind: 'lparen' });
          this.i++;
          break;
        case ')':
          tokens.push({ kind: 'rparen' });
          this.i++;
          break;
        case '^':
          tokens.push({ kind: 'anchorStart' });
          this.i++;
          break;
        case '$':
          tokens.push({ kind: 'anchorEnd' });
          this.i++;
          break;
        case '.':
          tokens.push({ kind: 'atom', set: CharSet.dot(), label: '.' });
          this.i++;
          break;
        case '[':
          tokens.push(this.readClass(start));
          break;
        case '\\':
          tokens.push(this.readTopLevelEscape());
          break;
        default: {
          // Any other character — including unescaped `{`, `}`, `]` — is a
          // literal, matching the host's lenient non-`u` behavior.
          const cp = src.charCodeAt(this.i);
          this.i++;
          tokens.push({ kind: 'atom', set: CharSet.char(cp), label: charLabel(cp) });
        }
      }
    }
    return tokens;
  }

  /** Read a top-level `\X` escape into an atom token. */
  private readTopLevelEscape(): Token {
    const src = this.src;
    const start = this.i;
    this.i++; // consume backslash
    if (this.i >= src.length) {
      throw new RegexSyntaxError('Trailing backslash in pattern', start);
    }
    const e = src[this.i] as string;
    this.i++;
    const shorthand = shorthandSet(e);
    if (shorthand) {
      return { kind: 'atom', set: shorthand, label: `\\${e}` };
    }
    if (e === 'n') return { kind: 'atom', set: CharSet.char(0x0a), label: '\\n' };
    if (e === 't') return { kind: 'atom', set: CharSet.char(0x09), label: '\\t' };
    if (e === 'r') return { kind: 'atom', set: CharSet.char(0x0d), label: '\\r' };
    if (ESCAPABLE_METACHARS.has(e)) {
      const cp = e.charCodeAt(0);
      return { kind: 'atom', set: CharSet.char(cp), label: charLabel(cp) };
    }
    throw new RegexSyntaxError(`Unsupported escape \\${e}`, start);
  }

  /** Read a `[...]` character class starting at `startIndex` (the `[`). */
  private readClass(startIndex: number): Token {
    const src = this.src;
    this.i++; // consume '['
    let negated = false;
    if (src[this.i] === '^') {
      negated = true;
      this.i++;
    }

    const members: CharSet[] = [];
    let sawMember = false;

    while (true) {
      if (this.i >= src.length) {
        throw new RegexSyntaxError('Unterminated character class', startIndex);
      }
      if (src[this.i] === ']') {
        if (!sawMember) {
          throw new RegexSyntaxError(
            'Empty character class is not allowed (a class must contain at least one member; escape "]" as "\\]")',
            startIndex,
          );
        }
        this.i++; // consume ']'
        break;
      }

      const atomA = this.readClassAtom(startIndex);
      sawMember = true;

      if (
        atomA.type === 'char' &&
        src[this.i] === '-' &&
        this.i + 1 < src.length &&
        src[this.i + 1] !== ']'
      ) {
        // Potential range "a-b".
        this.i++; // consume '-'
        const atomB = this.readClassAtom(startIndex);
        if (atomB.type === 'char') {
          if (atomA.cp > atomB.cp) {
            throw new RegexSyntaxError(
              `Character class range out of order: [${charLabel(atomA.cp)}-${charLabel(atomB.cp)}]`,
              startIndex,
            );
          }
          members.push(CharSet.range(atomA.cp, atomB.cp));
        } else {
          // e.g. `[a-\d]` — host treats the dash as a literal here.
          members.push(CharSet.char(atomA.cp));
          members.push(CharSet.char(0x2d)); // '-'
          members.push(atomB.set);
        }
      } else if (atomA.type === 'char') {
        members.push(CharSet.char(atomA.cp));
      } else {
        members.push(atomA.set);
      }
    }

    const union = CharSet.union(members);
    const set = negated ? union.complement() : union;
    const label = src.slice(startIndex, this.i);
    return { kind: 'atom', set, label };
  }

  /** Read one member (char or shorthand set) inside a character class. */
  private readClassAtom(classStart: number): ClassAtom {
    const src = this.src;
    if (src[this.i] === '\\') {
      const escStart = this.i;
      this.i++; // consume backslash
      if (this.i >= src.length) {
        throw new RegexSyntaxError('Trailing backslash in character class', classStart);
      }
      const e = src[this.i] as string;
      this.i++;
      const shorthand = shorthandSet(e);
      if (shorthand) return { type: 'set', set: shorthand };
      if (e === 'n') return { type: 'char', cp: 0x0a };
      if (e === 't') return { type: 'char', cp: 0x09 };
      if (e === 'r') return { type: 'char', cp: 0x0d };
      if (ESCAPABLE_METACHARS.has(e)) return { type: 'char', cp: e.charCodeAt(0) };
      throw new RegexSyntaxError(`Unsupported escape \\${e} in character class`, escStart);
    }
    const cp = src.charCodeAt(this.i);
    this.i++;
    return { type: 'char', cp };
  }
}

/** Map a shorthand escape letter to its CharSet, or null if not a shorthand. */
function shorthandSet(e: string): CharSet | null {
  switch (e) {
    case 'd':
      return DIGIT;
    case 'w':
      return WORD;
    case 's':
      return SPACE;
    case 'D':
      return NOT_DIGIT;
    case 'W':
      return NOT_WORD;
    case 'S':
      return NOT_SPACE;
    default:
      return null;
  }
}

/** Tokenize a pattern string. Throws `RegexSyntaxError` on malformed input. */
export function tokenize(pattern: string): Token[] {
  return new Tokenizer(pattern).tokenize();
}
