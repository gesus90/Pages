/**
 * Contracts of the memory of agents across chats (PAGE-305).
 *
 * @remarks
 * `MEMORY.md` keeps the current topics of an agent, one entry per topic
 * with its source, and is updated after every answer. `DREAM.md` keeps the
 * lessons of the nightly dream run, each with evidence and date. Both have
 * a character limit per agent and are data, never instructions. Entries
 * that leave `MEMORY.md` move into the searchable archive with their source,
 * so the rules of sharing can be checked for every entry.
 */

/** Limits of `MEMORY.md` and `DREAM.md` in characters. */
export const AGENT_MEMORY_CHARACTERS = {
  /** The start value of `MEMORY.md`. */
  memoryDefault: 8_000,
  memoryMinimum: 1_000,
  memoryMaximum: 100_000,
  /** The start value of `DREAM.md`. */
  dreamDefault: 4_000,
  dreamMinimum: 500,
  dreamMaximum: 50_000,
} as const;

/** The default time of day of the dream run, in the time zone of the server. */
export const AGENT_DREAM_DEFAULT_TIME = "03:00";

/** A time of day as `HH:MM`, 00:00 to 23:59. */
export const AGENT_DREAM_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

/** The character limits of one agent. */
export interface AgentMemoryLimits {
  readonly memoryCharacters: number;
  readonly dreamCharacters: number;
}

/**
 * The chat a piece of knowledge comes from: the direct chat of a person
 * with the agent, or a stored conversation with its members.
 */
export type AgentMemoryChat =
  | { readonly kind: "person"; readonly personId: string }
  | { readonly kind: "conversation"; readonly conversationId: string };

/** Where an entry of `MEMORY.md` or of the archive comes from. */
export interface AgentMemorySource {
  /** The chat; `null` for an entry written by hand without one. */
  readonly chat: AgentMemoryChat | null;
  /** Ticket keys such as `PAGE-12` the entry is about. */
  readonly tickets: readonly string[];
  /** IDs of wiki pages the entry is about. */
  readonly wikiPages: readonly string[];
}

/**
 * Counts the characters of a text as the memory limits count them.
 *
 * @param text - Markdown text.
 * @returns The number of Unicode code points.
 */
export function countCharacters(text: string): number {
  return Array.from(text).length;
}
