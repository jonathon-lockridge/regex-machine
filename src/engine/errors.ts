/**
 * The single error type raised for any malformed pattern, at any pipeline
 * stage (tokenizer or parser). Keeping one type makes "does the engine reject
 * this?" trivial to assert in tests and in the fuzzer's parse-error parity
 * check against the host `RegExp` constructor.
 */
export class RegexSyntaxError extends Error {
  readonly index: number | undefined;

  constructor(message: string, index?: number) {
    super(message);
    this.name = 'RegexSyntaxError';
    this.index = index;
  }
}
