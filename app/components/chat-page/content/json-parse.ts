/** The outcome of reading JSON: the value, or where it breaks. */
export type JsonReading =
  | { readonly isValid: true; readonly value: unknown }
  | {
      readonly isValid: false;
      /** The message of the parser. */
      readonly message: string;
      /** Line and column of the first error, from 1. */
      readonly line: number;
      readonly column: number;
    };

/** Line and column of a character position in a text, both from 1. */
function positionOf(
  source: string,
  offset: number,
): { readonly line: number; readonly column: number } {
  const before = source.slice(0, Math.max(0, offset));
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

/** A cursor of the scanner that finds where JSON breaks. */
interface JsonScan {
  readonly text: string;
  index: number;
}

const LITERALS: readonly string[] = ["true", "false", "null"];
const NUMBER_AT = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/uy;
const STRING_AT = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/uy;

class JsonBreak extends Error {}

function skipSpace(scan: JsonScan): void {
  while (/\s/u.test(scan.text[scan.index] ?? "")) scan.index += 1;
}

function expectCharacter(scan: JsonScan, character: string): void {
  skipSpace(scan);
  if (scan.text[scan.index] !== character) throw new JsonBreak();
  scan.index += 1;
}

function scanPattern(scan: JsonScan, pattern: RegExp): void {
  pattern.lastIndex = scan.index;
  const match = pattern.exec(scan.text);
  if (!match) throw new JsonBreak();
  scan.index += match[0].length;
}

/** Scans the entries of an object or array up to its closing bracket. */
function scanEntries(scan: JsonScan, close: string, isObject: boolean): void {
  scan.index += 1;
  skipSpace(scan);
  if (scan.text[scan.index] === close) {
    scan.index += 1;
    return;
  }
  for (;;) {
    if (isObject) {
      skipSpace(scan);
      scanPattern(scan, STRING_AT);
      expectCharacter(scan, ":");
    }
    scanValue(scan);
    skipSpace(scan);
    const next = scan.text[scan.index];
    if (next === close) {
      scan.index += 1;
      return;
    }
    if (next !== ",") throw new JsonBreak();
    scan.index += 1;
  }
}

function scanValue(scan: JsonScan): void {
  skipSpace(scan);
  const character = scan.text[scan.index];
  if (character === "{") return scanEntries(scan, "}", true);
  if (character === "[") return scanEntries(scan, "]", false);
  if (character === '"') return scanPattern(scan, STRING_AT);
  const literal = LITERALS.find((word) => scan.text.startsWith(word, scan.index));
  if (literal !== undefined) {
    scan.index += literal.length;
    return;
  }
  scanPattern(scan, NUMBER_AT);
}

/** The offset of the first character where JSON breaks. */
function errorOffset(source: string): number {
  const scan: JsonScan = { text: source, index: 0 };
  try {
    scanValue(scan);
    skipSpace(scan);
  } catch (error: unknown) {
    if (!(error instanceof JsonBreak)) throw error;
  }
  return scan.index;
}

/**
 * Reads JSON for the tree of a JSON card (PAGE-383).
 *
 * @param source - The text of the block.
 * @returns The value, or the message and place of the first error.
 */
export function readJson(source: string): JsonReading {
  try {
    return { isValid: true, value: JSON.parse(source) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { isValid: false, message, ...positionOf(source, errorOffset(source)) };
  }
}

/** The kinds of JSON values, each with its own color in the tree. */
export type JsonValueKind =
  "object" | "array" | "string" | "number" | "boolean" | "null";

/**
 * The kind of a JSON value.
 *
 * @param value - A value read from JSON.
 */
export function jsonKindOf(value: unknown): JsonValueKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  return "boolean";
}

/**
 * The entries of an object or array, as the tree lists them.
 *
 * @param value - An object or array read from JSON.
 * @returns Key and value of each entry; empty for other values.
 */
export function jsonEntries(value: unknown): [string, unknown][] {
  if (Array.isArray(value))
    return value.map((entry: unknown, index) => [String(index), entry]);
  if (typeof value === "object" && value !== null) return Object.entries(value);
  return [];
}
