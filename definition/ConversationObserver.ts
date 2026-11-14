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
 * - `automaticRepliesPerOrigin`: contributions per group round that nobody
 *   asked for with @, chosen by the observer or the decision model
 *   (PAGE-349). Explicit @ hand-overs are not counted and not limited per
 *   round or per agent; only the chain pause of
 *   `CONVERSATION_DECISION_LIMITS.agentStreak` stops them.
 * - `routingCallsPerMessage`: observer calls per new message at most.
 * - `routingContextMessages`/`routingContextCharacters`: the history the
 *   observer reads to choose.
 * - `observerTimeoutMinutes`: the longest observer session.
 */
export const CONVERSATION_OBSERVER_LIMITS = {
  automaticRepliesPerOrigin: 8,
  followUpTimeoutMilliseconds: 3 * 60_000,
  routingCallsPerMessage: 1,
  routingContextMessages: 20,
  routingContextCharacters: 12_000,
  routingReasonCharacters: 300,
  observerTimeoutMinutes: 5,
} as const;

/** The range a group may set for contributions without @ per round (PAGE-349). */
export const CONVERSATION_ROUND_LIMITS_RANGE = {
  minimum: 1,
  automaticRepliesMaximum: 9,
} as const;

/** The effective limits of one group's round. */
export interface ConversationRoundLimits {
  /** Contributions without @ (observer, decision model) per round. */
  readonly automaticRepliesPerOrigin: number;
}

/** Resolves missing settings and clamps every caller to the safe round limits. */
export function conversationRoundLimits(
  settings: Partial<ConversationRoundLimits>,
): ConversationRoundLimits {
  return {
    automaticRepliesPerOrigin: clampLimit(
      settings.automaticRepliesPerOrigin,
      CONVERSATION_OBSERVER_LIMITS.automaticRepliesPerOrigin,
      CONVERSATION_ROUND_LIMITS_RANGE.automaticRepliesMaximum,
    ),
  };
}

function clampLimit(
  input: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (input === undefined || !Number.isFinite(input)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(input)));
}

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
  /** How the observer of this group fared lately; only in a member's view (PAGE-340). */
  readonly observer?: ConversationObserverStatus;
}

/** One observer call that gave no result, without prompt, answer or provider text. */
export interface ConversationObserverFailure {
  readonly kind: "routing" | "summary";
  /** `failed` when the model call failed, `refused` when no model was asked. */
  readonly state: "failed" | "refused";
  /** The stable error code of the call. */
  readonly code: string;
  /** ISO 8601 end of the call. */
  readonly at: string;
}

/** The latest observer calls of one group, for its members (PAGE-340). */
export interface ConversationObserverStatus {
  /** Calls without result in a row since the last success, counted among the latest calls. */
  readonly consecutiveFailures: number;
  /** The newest call without result while no later call succeeded; otherwise `null`. */
  readonly lastFailure: ConversationObserverFailure | null;
}

/** How the group observer fared across the instance, for administrators (PAGE-340). */
export interface ConversationObserverHealth {
  /** ISO 8601 start of the counted window. */
  readonly since: string;
  readonly succeeded: number;
  readonly failed: number;
  readonly refused: number;
  readonly lastSuccessAt: string | null;
  /** The newest call without result in the window; otherwise `null`. */
  readonly lastFailure: ConversationObserverFailure | null;
}
