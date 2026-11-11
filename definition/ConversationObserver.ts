/**
 * Contracts of the group observer (PAGE-296): who answers in a group besides
 * the agents a person mentions, and the stored context of each group.
 *
 * @remarks
 * The observer is no participant. It runs on Pica's chat model, chooses the
 * agents a message needs and keeps one summary per group. Its limits stand
 * here, in one place, and nowhere else.
 */

/**
 * The fixed limits of quiet and cost.
 *
 * @remarks
 * - `automaticRepliesPerOrigin`: answers per message of a person that the
 *   observer or a hand-over of another agent starts; agents the person
 *   mentioned with @ do not count against it and are never cut off.
 * - `repliesPerAgentPerOrigin`: every agent answers a message of a person
 *   once at most, whatever path reaches it again.
 * - `routingCallsPerMessage`: observer calls per new message at most.
 * - `routingContextMessages`/`routingContextCharacters`: the history the
 *   observer reads to choose.
 * - `observerTimeoutMinutes`: the longest observer session.
 */
export const CONVERSATION_OBSERVER_LIMITS = {
  automaticRepliesPerOrigin: 3,
  repliesPerAgentPerOrigin: 1,
  routingCallsPerMessage: 1,
  routingContextMessages: 20,
  routingContextCharacters: 12_000,
  routingReasonCharacters: 300,
  observerTimeoutMinutes: 5,
} as const;

/**
 * The fixed limits of the group summaries.
 *
 * @remarks
 * One window holds at most `windowMessages` new messages with at most
 * `windowCharacters` of their text; a longer message enters as a marked
 * excerpt of at most `messageExcerptCharacters`. The previous summary adds
 * at most `previousSummaryCharacters`, and a new summary may have at most
 * `summaryCharacters`. One tick processes at most `windowsPerTick` windows
 * per group, oldest first; a group with more waiting messages stays behind
 * and goes on at the next tick.
 */
export const CONVERSATION_SUMMARY_LIMITS = {
  intervalMilliseconds: 5 * 60_000,
  windowMessages: 20,
  windowCharacters: 12_000,
  messageExcerptCharacters: 2_000,
  previousSummaryCharacters: 6_000,
  summaryCharacters: 6_000,
  listEntries: 12,
  listEntryCharacters: 400,
  windowsPerTick: 3,
  sourceRanges: 50,
} as const;

/** The most messages and characters one read of `read_conversation_context` returns. */
export const CONVERSATION_CONTEXT_READ_LIMITS = {
  messages: 20,
  characters: 12_000,
} as const;

/**
 * Why an agent answers a message (PAGE-296).
 *
 * - `direct`: the message of a person in a direct conversation with it.
 * - `mention`: a person named it with @ in a group.
 * - `context`: the observer chose it because of its responsibility.
 * - `handoff`: another agent named it with @ in its answer, or the observer
 *   chose it after that answer.
 * - `fallback`: it is the default responder of the group, and it was unclear
 *   who was addressed (PAGE-317).
 */
export type ConversationReplyTrigger =
  "direct" | "mention" | "context" | "handoff" | "fallback";

/**
 * Where the stored context of a group stands.
 *
 * - `current`: every content message up to the newest is summarized.
 * - `behind`: newer messages wait for the next summary.
 * - `unavailable`: no valid summary, for example because Pica is off or the
 *   observer failed; the original messages stay binding.
 * - `rebuilding`: a summarized message changed or vanished, so the summary
 *   is built anew from the remaining messages and is not shown meanwhile.
 */
export type ConversationGroupContextStatus =
  "current" | "behind" | "unavailable" | "rebuilding";

/** The messages one summary was built from, by sequence. */
export interface ConversationSummarySource {
  readonly fromSequence: number;
  readonly toSequence: number;
  /** IDs of the messages of the newest window. */
  readonly messageIds: readonly string[];
}

/** The stored context of a group as a member sees it. */
export interface ConversationGroupContextView {
  readonly conversationId: string;
  readonly status: ConversationGroupContextStatus;
  /** Short summary; empty without a valid one. */
  readonly summary: string;
  readonly decisions: readonly string[];
  readonly openItems: readonly string[];
  readonly responsibilities: readonly string[];
  /** ISO 8601 moment of the last summary; `null` without one. */
  readonly updatedAt: string | null;
  /** Sequence of the newest message the summary contains; 0 without one. */
  readonly throughSequence: number;
  /** Content messages after it that the summary does not contain yet. */
  readonly pendingMessages: number;
  /** Whether a long message entered the summary as an excerpt only. */
  readonly hasExcerpts: boolean;
  readonly sources: readonly ConversationSummarySource[];
  /** Why the context is unavailable, as a stable code; otherwise `null`. */
  readonly errorCode: string | null;
}
