import type {
  ChatJob,
  ChatJobCompactionEvent,
  ChatJobEndEvent,
  ChatJobEvent,
  ChatJobPhase,
  ChatJobToolEvent,
  ChatJobTurnEvent,
  ChatJobUpdate,
  ChatJobUsage,
  ChatSteerStatus,
} from "@/definition/ChatJob";

/** What the panel shows of a Pica job while it runs and after it ended. */
export interface ChatLiveJob {
  readonly job: ChatJob;
  /** The sequence of the last journal entry applied. */
  readonly cursor: number;
  readonly hasMore: boolean;
  /** At least one read of the journal succeeded. */
  readonly hasRead: boolean;
  readonly phase: ChatJobPhase | null;
  /** Answer text of the turn shown last, until its answer is stored. */
  readonly text: string;
  /** The turn the shown text belongs to. */
  readonly textTurn: number;
  /** Calls of Pages tools in the current turn, newest status per call. */
  readonly tools: readonly ChatJobToolEvent[];
  readonly steers: Readonly<Record<string, ChatSteerStatus>>;
  readonly usage: ChatJobUsage;
  /** The latest context compaction of the agent session, apart from tools, steers and stop. */
  readonly compaction: ChatJobCompactionEvent | null;
  readonly isResumed: boolean | null;
  /** Null until the adapter's handshake was journaled. */
  readonly canSteer?: boolean | null;
  readonly ended: ChatJobEndEvent | null;
  /** When the running follow-up turn began; the first turn counts from the job's creation. */
  readonly turnStartedAt?: string;
}

/** The result of applying one read of the journal. */
export interface AppliedChatJobUpdate {
  readonly live: ChatLiveJob;
  /** The read did not continue the cursor; read the journal again from the start. */
  readonly isStale: boolean;
  /** A message was stored or the job ended; read the conversation again. */
  readonly needsReload: boolean;
}

/** The state of a job before any of its journal was read. */
export function startChatLiveJob(job: ChatJob): ChatLiveJob {
  return {
    job,
    cursor: 0,
    hasMore: true,
    hasRead: false,
    phase: null,
    text: "",
    textTurn: 0,
    tools: [],
    steers: {},
    usage: job.usage,
    compaction: null,
    isResumed: null,
    canSteer: null,
    ended: null,
  };
}

function beginTurn(live: ChatLiveJob, event: ChatJobTurnEvent): ChatLiveJob {
  return {
    ...live,
    tools: [],
    ...(event.startedAt === undefined
      ? {}
      : { turnStartedAt: event.startedAt }),
  };
}

function applyEvent(live: ChatLiveJob, event: ChatJobEvent): ChatLiveJob {
  switch (event.kind) {
    case "phase":
      return { ...live, phase: event.phase };
    case "turn":
      return beginTurn(live, event);
    case "text":
      // Text of a later turn replaces what is shown; it may arrive before that turn's entry.
      return {
        ...live,
        text:
          event.isReset || event.turn !== live.textTurn
            ? event.delta
            : live.text + event.delta,
        textTurn: Math.max(live.textTurn, event.turn),
      };
    case "tool":
      return {
        ...live,
        tools: [
          ...live.tools.filter(({ callId }) => callId !== event.callId),
          event,
        ],
      };
    case "steer":
      return {
        ...live,
        steers: { ...live.steers, [event.messageId]: event.status },
      };
    case "answer":
      // A stored answer clears only its own turn; a following turn may already show text.
      return event.turn < live.textTurn
        ? live
        : { ...live, text: "", tools: [] };
    case "usage":
      return { ...live, usage: event.usage };
    case "compaction":
      return { ...live, compaction: event };
    case "session":
      return { ...live, isResumed: event.isResumed };
    case "capabilities":
      return { ...live, canSteer: event.canSteer };
    case "end":
      return { ...live, ended: event };
  }
}

/**
 * Applies a read of the journal after the cursor of the job.
 *
 * @param live - What the panel showed so far.
 * @param update - The job and the entries after the cursor.
 * @returns The new state; a read that does not continue the cursor is stale.
 */
export function applyChatJobUpdate(
  live: ChatLiveJob,
  update: ChatJobUpdate,
): AppliedChatJobUpdate {
  const first = update.events.at(0);
  const isOtherJob = update.job.id !== live.job.id;
  if (isOtherJob || (first !== undefined && first.sequence !== live.cursor + 1))
    return {
      live: startChatLiveJob(update.job),
      isStale: true,
      needsReload: isOtherJob,
    };
  let next: ChatLiveJob = {
    ...live,
    job: update.job,
    cursor: update.cursor,
    hasMore: update.hasMore,
    hasRead: true,
  };
  let needsReload = false;
  for (const { event } of update.events) {
    next = applyEvent(next, event);
    if (event.kind === "answer" || event.kind === "end") needsReload = true;
  }
  return { live: next, isStale: false, needsReload };
}

/** Whether the job still runs, as far as the panel knows. */
export function isChatJobRunning(live: ChatLiveJob | null): boolean {
  return live !== null && live.ended === null && live.job.state === "running";
}
