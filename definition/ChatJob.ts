/**
 * How a server-side Pica job (PAGE-68) ended or whether it still runs.
 *
 * @remarks
 * `interrupted` marks a job the server ended by shutting down; it is never
 * repeated on its own.
 */
export const CHAT_JOB_STATES = [
  "running",
  "completed",
  "failed",
  "stopped",
  "interrupted",
] as const;
export type ChatJobState = (typeof CHAT_JOB_STATES)[number];

/**
 * What became of a message sent while Pica was answering.
 *
 * @remarks
 * `pending` is stored, `delivered` went to the adapter, `accepted` joined the
 * running turn, `followUp` is answered in a turn of its own, `failed` did not
 * reach the agent.
 */
export const CHAT_STEER_STATUSES = [
  "pending",
  "delivered",
  "accepted",
  "followUp",
  "failed",
] as const;
export type ChatSteerStatus = (typeof CHAT_STEER_STATUSES)[number];

/**
 * How a selected attachment reached the agent.
 *
 * @remarks
 * `extracted` is the complete text of a document such as a PDF or an Office
 * file, without its layout and images; `encrypted` and `noText` are documents
 * whose text could not be read (PAGE-92).
 */
export const CHAT_SELECTION_TRANSFERS = [
  "full",
  "extracted",
  "truncated",
  "unsupported",
  "tooLarge",
  "unreadable",
  "encrypted",
  "noText",
] as const;
export type ChatSelectionTransfer = (typeof CHAT_SELECTION_TRANSFERS)[number];

/** How much of a cut text reached the agent. */
export interface ChatSelectionScope {
  /** Characters that reached the agent. */
  readonly characters: number;
  /** Pages of a PDF that were read, and how many it has. */
  readonly pages?: { readonly read: number; readonly total: number };
}

/** One attachment of an immutable selection snapshot. */
export interface ChatSelectionItem {
  readonly attachmentId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly size: number;
  readonly transfer: ChatSelectionTransfer;
  /** For a cut text: how much reached the agent (PAGE-92). */
  readonly scope?: ChatSelectionScope;
}

/** Context occupancy exactly as the adapter reported it. */
export interface ChatContextUsage {
  readonly used: number;
  readonly size: number;
}

/** Tokens of the answer as the adapter reported them. */
export interface ChatTokenUsage {
  readonly input: number;
  readonly output: number;
  readonly total: number;
  /** A turn of the job reported no tokens, so the sum lacks it. */
  readonly isPartial: boolean;
}

/**
 * Costs as the adapter reported them.
 *
 * @remarks
 * `isEstimated` marks an amount the adapter computed itself from token counts
 * and list prices, as Claude Code does (PAGE-90); it is no billed amount and,
 * for a subscription sign-in, not charged at all.
 */
export interface ChatCost {
  readonly amount: number;
  readonly currency: string;
  readonly isEstimated: boolean;
  /** OpenCode reports the cumulative native session cost, including earlier jobs. */
  readonly scope?: "session";
}

/** Consumption of a job; `null` means the adapter did not report it, never zero. */
export interface ChatJobUsage {
  readonly context: ChatContextUsage | null;
  readonly tokens: ChatTokenUsage | null;
  readonly cost: ChatCost | null;
}

/** The stage of a job before and around its turns. */
export type ChatJobPhase = "starting" | "running" | "finishing";

/** The job reached another stage. */
export interface ChatJobPhaseEvent {
  readonly kind: "phase";
  readonly phase: ChatJobPhase;
}

/** A turn began, for the message of the job or for a follow-up message. */
export interface ChatJobTurnEvent {
  readonly kind: "turn";
  readonly turn: number;
  readonly origin: "message" | "followUp";
  /** UTC instant a follow-up turn began, so its elapsed time is its own; absent for the first turn. */
  readonly startedAt?: string;
}

/** New answer text of the running turn; `isReset` starts a new message of the agent. */
export interface ChatJobTextEvent {
  readonly kind: "text";
  readonly turn: number;
  readonly isReset: boolean;
  readonly delta: string;
}

/** A call of a Pages tool through the bridge; parameters and results stay out. */
export interface ChatJobToolEvent {
  readonly kind: "tool";
  readonly callId: string;
  readonly tool: string;
  readonly status: "running" | "completed" | "failed";
  readonly error: string | null;
}

/** A message sent while the job ran changed its status. */
export interface ChatJobSteerEvent {
  readonly kind: "steer";
  readonly messageId: string;
  readonly status: ChatSteerStatus;
}

/** The answer of a turn was stored as a message of the conversation. */
export interface ChatJobAnswerEvent {
  readonly kind: "answer";
  readonly turn: number;
  readonly messageId: string;
}

/** The consumption of the job changed. */
export interface ChatJobUsageEvent {
  readonly kind: "usage";
  readonly usage: ChatJobUsage;
}

/**
 * The agent compacted the context of its session on its own (PAGE-90).
 *
 * @remarks
 * Compaction is neither a stop nor a steer and ends no turn. The token counts
 * are the adapter's report, `null` where it named none.
 */
export interface ChatJobCompactionEvent {
  readonly kind: "compaction";
  readonly status: "running" | "completed" | "failed";
  readonly tokensBefore: number | null;
  readonly tokensAfter: number | null;
}

/** Whether the job continued the earlier agent session or had to start a new one. */
export interface ChatJobSessionEvent {
  readonly kind: "session";
  readonly isResumed: boolean;
}

/** Negotiated capabilities; a follow-up queue never establishes steering support. */
export interface ChatJobCapabilitiesEvent {
  readonly kind: "capabilities";
  readonly canSteer: boolean;
}

/** The job ended. */
export interface ChatJobEndEvent {
  readonly kind: "end";
  readonly state: Exclude<ChatJobState, "running">;
  readonly errorCode: string | null;
}

/** One entry of the journal of a job. */
export type ChatJobEvent =
  | ChatJobPhaseEvent
  | ChatJobTurnEvent
  | ChatJobTextEvent
  | ChatJobToolEvent
  | ChatJobSteerEvent
  | ChatJobAnswerEvent
  | ChatJobUsageEvent
  | ChatJobCompactionEvent
  | ChatJobSessionEvent
  | ChatJobCapabilitiesEvent
  | ChatJobEndEvent;

/** A journal entry with its position; positions of a job are contiguous from 1. */
export interface ChatJobEntry {
  readonly sequence: number;
  readonly event: ChatJobEvent;
}

/** A job of one conversation, without its journal. */
export interface ChatJob {
  readonly id: string;
  readonly sessionId: string;
  readonly state: ChatJobState;
  readonly errorCode: string | null;
  readonly createdAt: string;
  readonly endedAt: string | null;
  readonly usage: ChatJobUsage;
}

/**
 * A consistent read of a job: its state and the journal after a cursor.
 *
 * @remarks
 * `cursor` is the sequence of the last returned entry; the next read asks for
 * the entries after it, so nothing is skipped or repeated.
 */
export interface ChatJobUpdate {
  readonly job: ChatJob;
  readonly events: readonly ChatJobEntry[];
  readonly cursor: number;
  /** Further entries exist beyond this page. */
  readonly hasMore: boolean;
}

/** A message sent while Pica answered, as the server stored it. */
export interface ChatSteer {
  readonly messageId: string;
  readonly jobId: string;
  readonly status: ChatSteerStatus;
}

/** The immutable selection snapshot of one message. */
export interface ChatSelection {
  readonly messageId: string;
  readonly items: readonly ChatSelectionItem[];
}

/** What a conversation shows beyond its messages on the shared ACP path. */
export interface ChatSessionActivity {
  /** The newest job, running or ended. */
  readonly job: ChatJob | null;
  readonly steers: readonly ChatSteer[];
  readonly selections: readonly ChatSelection[];
}

/** What the server did with a sent message on the shared ACP path. */
export interface ChatJobStart {
  readonly job: ChatJob;
  /** The stored message that started the job. */
  readonly messageId: string;
}

/** Narrows an external job ID without interpreting it. */
export function isChatJobId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9-]{36}$/u.test(value);
}
