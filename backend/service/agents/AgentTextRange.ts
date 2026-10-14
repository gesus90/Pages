import { createHash } from "node:crypto";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AGENT_TEXT_RANGE_LIMITS } from "@/definition/AgentTextRange";

import type {
  AgentTextExcerpt,
  AgentTextPatch,
  AgentTextPatched,
  AgentTextPosition,
  AgentTextRangeRequest,
  AgentTextSize,
} from "@/definition/AgentTextRange";
import type { AgentRejectionReason } from "@/definition/PagesAgentOperations";

const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const VERSION_HEX_LENGTH = 32;

/** One line as UTF-16 offsets: its first unit, the end of its content and the start of the next line. */
interface LineSpan {
  readonly start: number;
  readonly contentEnd: number;
  readonly end: number;
}

/** A text together with its line structure. */
export interface IndexedText {
  readonly text: string;
  readonly lines: readonly LineSpan[];
}

/** A passage together with the size of the text it comes from. */
export type AgentTextRangeRead = AgentTextExcerpt & AgentTextSize;

/** The new text of a patch, where the replacement stands in it, and the passage when it was asked for. */
export interface AppliedTextPatch extends AgentTextPatched {
  readonly text: string;
}

function rangeFailure(reason: AgentRejectionReason["reason"]): never {
  throw new AgentOperationError("INVALID_REQUEST", { reason });
}

/** Where the character at `offset` ends: a CRLF pair and a surrogate pair each count as one. */
function characterEnd(text: string, offset: number): number {
  if (
    text.charCodeAt(offset) === CARRIAGE_RETURN &&
    text.charCodeAt(offset + 1) === LINE_FEED
  )
    return offset + 2;
  return (text.codePointAt(offset) ?? 0) > 0xffff ? offset + 2 : offset + 1;
}

function countCharacters(text: string, from: number, to: number): number {
  let count = 0;
  for (let offset = from; offset < to; offset = characterEnd(text, offset))
    count += 1;
  return count;
}

/**
 * Splits a text into lines at `\n`, `\r\n` and `\r`.
 *
 * @param text - The stored text, unchanged.
 * @returns The text with its lines; a final line break is followed by an empty line.
 */
export function indexText(text: string): IndexedText {
  const lines: LineSpan[] = [];
  let start = 0;
  let offset = 0;
  while (offset < text.length) {
    const unit = text.charCodeAt(offset);
    if (unit !== LINE_FEED && unit !== CARRIAGE_RETURN) {
      offset += 1;
      continue;
    }
    const end = characterEnd(text, offset);
    lines.push({ start, contentEnd: offset, end });
    start = end;
    offset = end;
  }
  lines.push({ start, contentEnd: text.length, end: text.length });
  return { text, lines };
}

/**
 * Names the exact text a range was read from, compactly.
 *
 * @param text - The stored text.
 * @returns The first 128 bits of the SHA-256 of its UTF-8 bytes, as 32 lower-case hex digits.
 *
 * @remarks
 * The server derives it from the stored text on every call, so it needs no
 * stored counter and cannot drift: two texts share a version only when they
 * are equal.
 */
export function agentTextVersion(text: string): string {
  return createHash("sha256")
    .update(text, "utf8")
    .digest("hex")
    .slice(0, VERSION_HEX_LENGTH);
}

/**
 * Measures a whole text without returning it.
 *
 * @param indexed - The indexed text.
 * @returns Lines, characters (a line break counted once) and UTF-8 bytes.
 */
export function measureText(indexed: IndexedText): AgentTextSize {
  return {
    lineCount: indexed.lines.length,
    characterCount: countCharacters(indexed.text, 0, indexed.text.length),
    byteCount: Buffer.byteLength(indexed.text, "utf8"),
  };
}

/**
 * Turns a position into the UTF-16 offset it names.
 *
 * @param indexed - The indexed text.
 * @param position - A line and column, both counting from 1.
 * @returns The offset of the character at the position, or of the end of the line content.
 * @throws {AgentOperationError} `INVALID_REQUEST` with `line_out_of_range` or `column_out_of_range`.
 */
export function offsetOf(
  indexed: IndexedText,
  position: AgentTextPosition,
): number {
  if (position.line < 1 || position.line > indexed.lines.length)
    return rangeFailure("line_out_of_range");
  const line = indexed.lines[position.line - 1];
  let offset = line.start;
  for (let column = 1; column < position.column; column += 1) {
    if (offset >= line.contentEnd) return rangeFailure("column_out_of_range");
    offset = characterEnd(indexed.text, offset);
  }
  return offset;
}

/**
 * Turns a UTF-16 offset into the position that names it.
 *
 * @param indexed - The indexed text.
 * @param offset - An offset between 0 and the length of the text.
 * @returns The position; an offset inside a line break reads as the start of the next line.
 */
export function positionOf(
  indexed: IndexedText,
  offset: number,
): AgentTextPosition {
  let low = 0;
  let high = indexed.lines.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (indexed.lines[middle].start <= offset) low = middle;
    else high = middle - 1;
  }
  const line = indexed.lines[low];
  if (offset > line.contentEnd) return { line: low + 2, column: 1 };
  return {
    line: low + 1,
    column: countCharacters(indexed.text, line.start, offset) + 1,
  };
}

function requireOrdered(startOffset: number, endOffset: number): void {
  if (endOffset < startOffset) rangeFailure("range_reversed");
}

/** Reads from `startOffset` up to `limitOffset`, at most `maxCharacters` characters. */
function excerptBetween(
  indexed: IndexedText,
  startOffset: number,
  limitOffset: number,
  maxCharacters: number,
): AgentTextExcerpt {
  let endOffset = startOffset;
  let taken = 0;
  while (endOffset < limitOffset && taken < maxCharacters) {
    endOffset = characterEnd(indexed.text, endOffset);
    taken += 1;
  }
  const isTruncated = endOffset < limitOffset;
  const end = positionOf(indexed, endOffset);
  return {
    text: indexed.text.slice(startOffset, endOffset),
    start: positionOf(indexed, startOffset),
    end,
    truncated: isTruncated,
    next: isTruncated ? end : null,
  };
}

/**
 * Reads one passage of a text.
 *
 * @param indexed - The indexed text.
 * @param request - Start, optional end and the character budget.
 * @returns The passage, its absolute positions and the size of the whole text.
 * @throws {AgentOperationError} `INVALID_REQUEST` for an unusable position, `PAYLOAD_TOO_LARGE` for an explicit range over the budget.
 *
 * @remarks
 * Nothing is cut silently: an explicit range over the budget is refused, and
 * an open range reports `truncated` with the position to continue from.
 */
export function readTextRange(
  indexed: IndexedText,
  request: AgentTextRangeRequest,
): AgentTextRangeRead {
  const startOffset = offsetOf(indexed, request.start);
  let limitOffset = indexed.text.length;
  if (request.end !== null) {
    limitOffset = offsetOf(indexed, request.end);
    requireOrdered(startOffset, limitOffset);
    if (
      countCharacters(indexed.text, startOffset, limitOffset) >
      request.maxCharacters
    )
      throw new AgentOperationError("PAYLOAD_TOO_LARGE", {
        constraint: "textRangeCharacters",
        limit: request.maxCharacters,
      });
  }
  return {
    ...excerptBetween(indexed, startOffset, limitOffset, request.maxCharacters),
    ...measureText(indexed),
  };
}

/**
 * Replaces exactly one range of a text.
 *
 * @param indexed - The indexed current text.
 * @param patch - The range, the text it must hold and its replacement.
 * @returns The new text, where the replacement stands in it and, when asked for, the changed passage.
 * @throws {AgentOperationError} `INVALID_REQUEST` for an unusable position, `CONFLICT` when the range holds other text.
 *
 * @remarks
 * Everything before and after the range is kept as it is, line endings
 * included. The replacement is inserted as sent; nothing is searched,
 * normalized or moved.
 */
export function applyTextPatch(
  indexed: IndexedText,
  patch: AgentTextPatch,
): AppliedTextPatch {
  const startOffset = offsetOf(indexed, patch.start);
  const endOffset = offsetOf(indexed, patch.end);
  requireOrdered(startOffset, endOffset);
  if (indexed.text.slice(startOffset, endOffset) !== patch.expectedText)
    throw new AgentOperationError("CONFLICT", {
      reason: "range_text_mismatch",
    });
  const text =
    indexed.text.slice(0, startOffset) +
    patch.replacementText +
    indexed.text.slice(endOffset);
  const next = indexText(text);
  const replacementEnd = startOffset + patch.replacementText.length;
  return {
    text,
    start: positionOf(next, startOffset),
    end: positionOf(next, replacementEnd),
    ...(patch.includeAfter
      ? {
          after: excerptBetween(
            next,
            startOffset,
            replacementEnd,
            AGENT_TEXT_RANGE_LIMITS.defaultCharacters,
          ),
        }
      : {}),
  };
}
