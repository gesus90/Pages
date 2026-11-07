import { PlanNotationError, planNotationIssue } from "./PlanNotationIssue";

import type { PlanNotationLocation } from "./PlanNotationIssue";

/** The punctuation of the notation; `--`, `:` and `+` only exist to be refused. */
const PUNCTUATION = ["->", "--", "{", "}", "[", "]", "=", ";", ",", ":", "+"];

const IDENTIFIER_START = /[\p{L}_]/u;
const IDENTIFIER_PART = /[\p{L}\p{N}_.]/u;
const DIGIT = /[0-9]/u;

/** What kind of token the lexer read. */
export type PlanNotationTokenKind =
  "identifier" | "number" | "string" | "punctuation" | "end";

/** One token with the place it starts. */
export interface PlanNotationToken extends PlanNotationLocation {
  readonly kind: PlanNotationTokenKind;
  /** The identifier, the number as written, the text of a string without quotes, or the punctuation. */
  readonly text: string;
}

/** Splits a notation into tokens, skipping blanks and the three kinds of comments. */
class PlanNotationScanner {
  private readonly source: string;
  private index = 0;
  private line = 1;
  private column = 1;

  public constructor(source: string) {
    this.source = source;
  }

  /** Reads every token up to the end, which is the last token. */
  public tokens(): readonly PlanNotationToken[] {
    const tokens: PlanNotationToken[] = [];
    for (;;) {
      this.skipIgnored();
      const token = this.next();
      tokens.push(token);
      if (token.kind === "end") return tokens;
    }
  }

  private peek(offset = 0): string {
    return this.source.charAt(this.index + offset);
  }

  private advance(): string {
    const character = this.peek();
    this.index += 1;
    if (character === "\n") {
      this.line += 1;
      this.column = 1;
    } else this.column += 1;
    return character;
  }

  private location(): PlanNotationLocation {
    return { line: this.line, column: this.column };
  }

  private fail(location: PlanNotationLocation): never {
    throw new PlanNotationError([planNotationIssue(location, "syntax")]);
  }

  private skipIgnored(): void {
    for (;;) {
      const character = this.peek();
      if (character !== "" && /\s/u.test(character)) this.advance();
      else if (character === "#" || (character === "/" && this.peek(1) === "/"))
        this.skipLine();
      else if (character === "/" && this.peek(1) === "*") this.skipBlock();
      else return;
    }
  }

  private skipLine(): void {
    while (this.peek() !== "" && this.peek() !== "\n") this.advance();
  }

  private skipBlock(): void {
    const start = this.location();
    this.advance();
    this.advance();
    while (!(this.peek() === "*" && this.peek(1) === "/")) {
      if (this.peek() === "") this.fail(start);
      this.advance();
    }
    this.advance();
    this.advance();
  }

  private next(): PlanNotationToken {
    const start = this.location();
    const character = this.peek();
    if (character === "") return { ...start, kind: "end", text: "" };
    if (character === '"') return this.string(start);
    if (character === "<") return this.html(start);
    if (DIGIT.test(character) || this.startsNumber(character))
      return this.number(start);
    if (IDENTIFIER_START.test(character)) return this.identifier(start);
    const punctuation = PUNCTUATION.find((entry) =>
      this.source.startsWith(entry, this.index),
    );
    if (punctuation === undefined) this.fail(start);
    for (let count = 0; count < punctuation.length; count += 1) this.advance();
    return { ...start, kind: "punctuation", text: punctuation };
  }

  private startsNumber(character: string): boolean {
    const next = this.peek(1);
    if (character === ".") return DIGIT.test(next);
    return (
      character === "-" &&
      (DIGIT.test(next) || (next === "." && DIGIT.test(this.peek(2))))
    );
  }

  private identifier(start: PlanNotationLocation): PlanNotationToken {
    let text = "";
    while (this.peek() !== "" && IDENTIFIER_PART.test(this.peek()))
      text += this.advance();
    return { ...start, kind: "identifier", text };
  }

  private number(start: PlanNotationLocation): PlanNotationToken {
    let text = "";
    if (this.peek() === "-") text += this.advance();
    while (DIGIT.test(this.peek())) text += this.advance();
    if (this.peek() === ".") {
      text += this.advance();
      while (DIGIT.test(this.peek())) text += this.advance();
    }
    // A number glued to letters, such as `3a`, is no DOT identifier.
    if (this.peek() !== "" && IDENTIFIER_PART.test(this.peek()))
      this.fail(this.location());
    return { ...start, kind: "number", text };
  }

  private string(start: PlanNotationLocation): PlanNotationToken {
    this.advance();
    let text = "";
    for (;;) {
      const character = this.advance();
      if (character === "") this.fail(start);
      if (character === '"') return { ...start, kind: "string", text };
      text += character === "\\" ? this.escape(start) : character;
    }
  }

  /** `\"`, `\\` and `\n` stand for their character; any other backslash stays as written. */
  private escape(start: PlanNotationLocation): string {
    const character = this.advance();
    if (character === "") this.fail(start);
    if (character === "n") return "\n";
    if (character === '"' || character === "\\") return character;
    return `\\${character}`;
  }

  /** An HTML label is refused at its start; the notation has no other use for `<`. */
  private html(start: PlanNotationLocation): never {
    throw new PlanNotationError([
      planNotationIssue(start, "unsupported_element"),
    ]);
  }
}

/**
 * Splits a plan notation into tokens.
 *
 * @param source - The notation.
 * @returns The tokens; the last one has the kind `end`.
 * @throws {PlanNotationError} `syntax` for an unterminated string or comment
 * or a character the notation does not know, `unsupported_element` for an
 * HTML label.
 */
export function readPlanNotationTokens(
  source: string,
): readonly PlanNotationToken[] {
  return new PlanNotationScanner(source).tokens();
}
