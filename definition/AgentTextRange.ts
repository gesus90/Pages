/** Reads of one bounded passage of a stored text, never of the whole text. */
export const AGENT_TEXT_RANGE_READ_OPERATIONS = [
  "wiki.page.readRange",
  "ticket.description.readRange",
] as const;

/** Writes that replace exactly one range of a stored text. */
export const AGENT_TEXT_RANGE_WRITE_OPERATIONS = [
  "wiki.page.patchContent",
  "ticket.patchDescription",
] as const;

/** An implemented passage read. */
export type AgentTextRangeReadOperation =
  (typeof AGENT_TEXT_RANGE_READ_OPERATIONS)[number];

/** An implemented range replacement. */
export type AgentTextRangeWriteOperation =
  (typeof AGENT_TEXT_RANGE_WRITE_OPERATIONS)[number];

/** Response budget of a passage: the default and the largest value a call may ask for. */
export const AGENT_TEXT_RANGE_LIMITS = {
  defaultCharacters: 4_096,
  maximumCharacters: 16_384,
} as const;

/**
 * A place between two characters of a text.
 *
 * @remarks
 * Lines and columns start at 1. A column counts Unicode code points of its
 * line; a line break (`\n`, `\r\n` or `\r`) counts as one column at the end of
 * its line, and the position after it is column 1 of the next line. The
 * largest column of a line is the position right before its line break, or
 * the end of the text on the last line.
 */
export interface AgentTextPosition {
  readonly line: number;
  readonly column: number;
}

/** What a passage read asks for. */
export interface AgentTextRangeRequest {
  readonly start: AgentTextPosition;
  /** Exclusive; `null` reads on from `start` for at most `maxCharacters`. */
  readonly end: AgentTextPosition | null;
  readonly maxCharacters: number;
}

/** A passage of a text with its absolute positions. */
export interface AgentTextExcerpt {
  readonly text: string;
  readonly start: AgentTextPosition;
  /** Exclusive. */
  readonly end: AgentTextPosition;
  /** Whether more text follows `end` within the requested range. */
  readonly truncated: boolean;
  /** Where to continue when `truncated`, otherwise `null`. */
  readonly next: AgentTextPosition | null;
}

/** Size of the whole text a passage was read from; the text itself is never returned. */
export interface AgentTextSize {
  readonly lineCount: number;
  /** Code points, a line break counted once. */
  readonly characterCount: number;
  readonly byteCount: number;
}

/** The exact range to replace and what to replace it with. */
export interface AgentTextPatch {
  readonly start: AgentTextPosition;
  /** Exclusive; equal to `start` for an insertion. */
  readonly end: AgentTextPosition;
  /** The text the range holds now; empty for an insertion. */
  readonly expectedText: string;
  /** Inserted verbatim; empty removes the range. */
  readonly replacementText: string;
  /** Whether the result carries the changed passage back. */
  readonly includeAfter: boolean;
}

/** Where the replacement text stands in the new text, and the passage when it was asked for. */
export interface AgentTextPatched {
  readonly start: AgentTextPosition;
  readonly end: AgentTextPosition;
  readonly after?: AgentTextExcerpt;
}

/** A passage of a visible wiki page and the revision it was read from. */
export interface AgentWikiPageRange extends AgentTextExcerpt, AgentTextSize {
  readonly pageId: string;
  readonly link: string;
  readonly revision: number;
}

/** A passage of the description of a visible ticket and the version it was read from. */
export interface AgentTicketDescriptionRange
  extends AgentTextExcerpt, AgentTextSize {
  readonly ticketId: string;
  readonly key: string;
  readonly link: string;
  /** Names the exact description; pass it back as `expectedDescriptionVersion`. */
  readonly descriptionVersion: string;
}
