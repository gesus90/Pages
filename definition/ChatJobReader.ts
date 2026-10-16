import {
  CHAT_JOB_STATES,
  CHAT_SELECTION_TRANSFERS,
  CHAT_STEER_STATUSES,
} from "./ChatJob";

import type {
  ChatCost,
  ChatJob,
  ChatJobEntry,
  ChatJobEvent,
  ChatJobUpdate,
  ChatJobUsage,
  ChatSelectionItem,
  ChatSteer,
  ChatTokenUsage,
} from "./ChatJob";

type Fields = Readonly<Record<string, unknown>>;

function invalid(): TypeError {
  return new TypeError("Invalid chat job data");
}

function fields(value: unknown): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw invalid();
  return Object.fromEntries(Object.entries(value));
}

function text(value: unknown): string {
  if (typeof value !== "string") throw invalid();
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw invalid();
  return value;
}

function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw invalid();
  return value;
}

function oneOf<Value extends string>(
  value: unknown,
  values: readonly Value[],
): Value {
  const match = values.find((entry) => entry === value);
  if (match === undefined) throw invalid();
  return match;
}

function readTokens(value: unknown): ChatTokenUsage | null {
  if (value === null || value === undefined) return null;
  const tokens = fields(value);
  if (typeof tokens.isPartial !== "boolean") throw invalid();
  return {
    input: count(tokens.input),
    output: count(tokens.output),
    total: count(tokens.total),
    isPartial: tokens.isPartial,
  };
}

function nullableCount(value: unknown): number | null {
  return value === null || value === undefined ? null : count(value);
}

function readCost(value: unknown): ChatCost | null {
  if (value === null || value === undefined) return null;
  const cost = fields(value);
  if (typeof cost.amount !== "number" || !Number.isFinite(cost.amount))
    throw invalid();
  // Entries written before PAGE-90 carry no flag; no adapter estimated a cost then.
  if (cost.isEstimated !== undefined && typeof cost.isEstimated !== "boolean")
    throw invalid();
  return {
    amount: cost.amount,
    currency: text(cost.currency),
    isEstimated: cost.isEstimated === true,
    ...(cost.scope === "session" ? { scope: "session" as const } : {}),
  };
}

/** Reads the consumption of a job; missing values stay `null`. */
export function readChatJobUsage(value: unknown): ChatJobUsage {
  const usage = fields(value);
  const context =
    usage.context === null || usage.context === undefined
      ? null
      : fields(usage.context);
  return {
    context:
      context === null
        ? null
        : { used: count(context.used), size: count(context.size) },
    tokens: readTokens(usage.tokens),
    cost: readCost(usage.cost),
  };
}

function readProgressEvent(event: Fields): ChatJobEvent | null {
  switch (event.kind) {
    case "phase":
      return {
        kind: "phase",
        phase: oneOf(event.phase, ["starting", "running", "finishing"]),
      };
    case "turn":
      return {
        kind: "turn",
        turn: count(event.turn),
        origin: oneOf(event.origin, ["message", "followUp"]),
      };
    case "text":
      if (typeof event.isReset !== "boolean") throw invalid();
      return {
        kind: "text",
        turn: count(event.turn),
        isReset: event.isReset,
        delta: text(event.delta),
      };
    case "tool":
      return {
        kind: "tool",
        callId: text(event.callId),
        tool: text(event.tool),
        status: oneOf(event.status, ["running", "completed", "failed"]),
        error: nullableText(event.error),
      };
    default:
      return null;
  }
}

function readOutcomeEvent(event: Fields): ChatJobEvent {
  switch (event.kind) {
    case "steer":
      return {
        kind: "steer",
        messageId: text(event.messageId),
        status: oneOf(event.status, CHAT_STEER_STATUSES),
      };
    case "answer":
      return {
        kind: "answer",
        turn: count(event.turn),
        messageId: text(event.messageId),
      };
    case "usage":
      return { kind: "usage", usage: readChatJobUsage(event.usage) };
    case "compaction":
      return {
        kind: "compaction",
        status: oneOf(event.status, ["running", "completed", "failed"]),
        tokensBefore: nullableCount(event.tokensBefore),
        tokensAfter: nullableCount(event.tokensAfter),
      };
    case "session":
      if (typeof event.isResumed !== "boolean") throw invalid();
      return { kind: "session", isResumed: event.isResumed };
    case "capabilities":
      if (typeof event.canSteer !== "boolean") throw invalid();
      return { kind: "capabilities", canSteer: event.canSteer };
    case "end":
      return {
        kind: "end",
        state: oneOf(event.state, [
          "completed",
          "failed",
          "stopped",
          "interrupted",
        ]),
        errorCode: nullableText(event.errorCode),
      };
    default:
      throw invalid();
  }
}

/**
 * Reads one journal entry of a job.
 *
 * @throws {TypeError} For anything that is no known entry.
 */
export function readChatJobEvent(value: unknown): ChatJobEvent {
  const event = fields(value);
  return readProgressEvent(event) ?? readOutcomeEvent(event);
}

/** Reads a job without its journal. */
export function readChatJob(value: unknown): ChatJob {
  const job = fields(value);
  return {
    id: text(job.id),
    sessionId: text(job.sessionId),
    state: oneOf(job.state, CHAT_JOB_STATES),
    errorCode: nullableText(job.errorCode),
    createdAt: text(job.createdAt),
    endedAt: nullableText(job.endedAt),
    usage: readChatJobUsage(job.usage),
  };
}

function readEntry(value: unknown): ChatJobEntry {
  const entry = fields(value);
  return {
    sequence: count(entry.sequence),
    event: readChatJobEvent(entry.event),
  };
}

/** Reads a job with the journal after a cursor. */
export function readChatJobUpdate(value: unknown): ChatJobUpdate {
  const update = fields(value);
  if (typeof update.hasMore !== "boolean") throw invalid();
  return {
    job: readChatJob(update.job),
    events: list(update.events).map(readEntry),
    cursor: count(update.cursor),
    hasMore: update.hasMore,
  };
}

/** Reads the attachments of a selection snapshot. */
export function readChatSelectionItems(
  value: unknown,
): readonly ChatSelectionItem[] {
  return list(value).map((entry) => {
    const item = fields(entry);
    return {
      attachmentId: text(item.attachmentId),
      fileName: text(item.fileName),
      contentType: text(item.contentType),
      size: count(item.size),
      transfer: oneOf(item.transfer, CHAT_SELECTION_TRANSFERS),
    };
  });
}

/** Reads a stored message that was sent while Pica answered. */
export function readChatSteer(value: unknown): ChatSteer {
  const steer = fields(value);
  return {
    messageId: text(steer.messageId),
    jobId: text(steer.jobId),
    status: oneOf(steer.status, CHAT_STEER_STATUSES),
  };
}
