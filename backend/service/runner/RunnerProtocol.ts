import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { mergeRunnerCatalog } from "./RunnerCatalog";
import type {
  RunnerJob,
  RunnerMessage,
  RunnerReply,
  RunnerState,
} from "@/definition/RunnerProtocol";

const TRANSITIONS: Readonly<
  Record<RunnerJob["status"], readonly RunnerJob["status"][]>
> = {
  queued: ["queued", "accepted", "failed", "interrupted", "lost"],
  accepted: ["running", "failed", "interrupted", "lost"],
  running: ["running", "completed", "failed", "interrupted", "lost"],
  completed: [],
  failed: [],
  interrupted: [],
  lost: [],
};

/** Applies a sequenced event or reconciles a reconnect without replaying work. */
export function applyRunnerMessage(
  state: RunnerState,
  message: RunnerMessage,
): {
  readonly state: RunnerState;
  readonly reply: RunnerReply;
} {
  if (message.sessionId !== state.sessionId)
    throw new Error("Runner session mismatch");
  if (message.type === "catalog")
    return {
      state: { ...state, catalog: mergeRunnerCatalog(state.catalog, message) },
      reply: {
        version: 1,
        type: "catalog-ack",
        sessionId: state.sessionId,
        generation: message.catalog.generation,
      },
    };
  if (message.type === "heartbeat")
    return {
      state,
      reply: { version: 1, type: "heartbeat", sessionId: state.sessionId },
    };
  if (message.type === "reconcile") {
    return reconcileRunner(state, message);
  }
  if (
    message.sequence === state.sequence &&
    message.eventId === state.lastEventId
  ) {
    if (state.lastEventDigest !== planContentDigest(message))
      throw new Error("Runner event requires reconciliation");
    return {
      state,
      reply: {
        version: 1,
        type: "ack",
        eventId: message.eventId,
        sequence: state.sequence,
      },
    };
  }
  if (
    message.sequence !== state.sequence + 1 ||
    message.job.sessionId !== state.sessionId
  )
    throw new Error("Runner event out of sequence");
  requireTransition(state, message);
  const updated = {
    ...state,
    lastContactAt: new Date().toISOString(),
    sequence: message.sequence,
    lastEventId: message.eventId,
    lastEventDigest: planContentDigest(message),
    jobs: state.jobs.map((job) =>
      job.jobId === message.job.jobId
        ? {
            ...message.job,
            ...(job.cancellation
              ? {
                  cancellation: {
                    ...job.cancellation,
                    ...(message.job.cancellation?.requestedAt ===
                    job.cancellation.requestedAt
                      ? message.job.cancellation
                      : {}),
                  },
                }
              : {}),
            ...(message.delta ? { execution: job.execution } : {}),
          }
        : job,
    ),
  };
  return {
    state: updated,
    reply: {
      version: 1,
      type: "ack",
      eventId: message.eventId,
      sequence: message.sequence,
    },
  };
}

function reconcileRunner(
  state: RunnerState,
  message: Extract<RunnerMessage, { type: "reconcile" }>,
): { readonly state: RunnerState; readonly reply: RunnerReply } {
  if (
    message.outputJournalVersion !== 2 &&
    state.jobs.some(requiresChunkExecutor)
  )
    throw new Error("Runner update required for outstanding chunk journals");
  if (message.sequence > state.sequence)
    throw new Error("Runner journal ahead of Pages");
  const reported = new Map(message.jobs.map((job) => [job.jobId, job]));
  if (reported.size !== message.jobs.length)
    throw new Error("Duplicate runner job");
  for (const job of message.jobs)
    if (
      job.sessionId !== state.sessionId ||
      !state.jobs.some(
        (stored) =>
          stored.jobId === job.jobId &&
          planContentDigest(stored.plan ?? null) ===
            planContentDigest(job.plan ?? null),
      )
    )
      throw new Error("Unknown runner job");
  const jobs = state.jobs.map((job): RunnerJob => {
    if (
      (job.status === "running" || job.status === "accepted") &&
      !reported.has(job.jobId)
    )
      return { ...job, status: "lost" };
    return job;
  });
  const reconciled = {
    ...state,
    jobs,
    catalog: mergeRunnerCatalog(state.catalog, message),
    communicationVersion: message.communicationVersion,
    runnerVersion: message.runnerVersion,
    lastContactAt: new Date().toISOString(),
  };
  return {
    state: reconciled,
    reply: {
      version: 1,
      type: "reconcile",
      state: reconciled,
      outputJournalVersion: 2,
      communicationVersion: 1,
    },
  };
}

function requiresChunkExecutor(job: RunnerJob): boolean {
  return (
    job.outputJournalVersion === 2 &&
    (["queued", "accepted", "running"].includes(job.status) ||
      (job.historyCursor ?? 0) < (job.historyLength ?? 0))
  );
}

function requireTransition(
  state: RunnerState,
  message: Extract<RunnerMessage, { type: "event" }>,
): void {
  const previous = state.jobs.find((job) => job.jobId === message.job.jobId);
  if (
    !previous ||
    (!TRANSITIONS[previous.status].includes(message.job.status) &&
      !isTerminalHistory(previous, message))
  )
    throw new Error("Invalid runner job transition");
  requireHistory(previous, message);
  requireCommand(previous, message);
  if (
    planContentDigest(previous.plan ?? null) !==
    planContentDigest(message.job.plan ?? null)
  )
    throw new Error("Runner context changed");
  if (
    previous.launch &&
    planContentDigest(previous.launch) !== planContentDigest(message.job.launch)
  )
    throw new Error("Runner launch changed");
  requireLaunch(previous, message);
}

function requireLaunch(
  previous: RunnerJob,
  message: Extract<RunnerMessage, { type: "event" }>,
): void {
  if (
    !previous.execution ||
    message.job.status === "lost" ||
    message.job.launch ||
    isUnlaunchedQueueReport(previous, message)
  )
    return;
  throw new Error("Runner launch confirmation required");
}

/** Without a worker, a queued job may only keep waiting, end by its stop or be refused with a named reason. */
function isUnlaunchedQueueReport(
  previous: RunnerJob,
  message: Extract<RunnerMessage, { type: "event" }>,
): boolean {
  if (previous.status !== "queued") return false;
  const status = message.job.status;
  return (
    status === "queued" ||
    (status === "interrupted" && previous.cancellation !== undefined) ||
    (status === "failed" && message.result?.failureCode !== undefined)
  );
}

function requireCommand(
  previous: RunnerJob,
  message: Extract<RunnerMessage, { type: "event" }>,
): void {
  if (message.delta) {
    if (message.job.execution !== undefined)
      throw new Error("Runner delta must reuse the stored command");
    return;
  }
  if (
    planContentDigest(previous.execution ?? null) !==
    planContentDigest(message.job.execution ?? null)
  )
    throw new Error("Runner command changed");
}

function requireHistory(
  previous: RunnerJob,
  message: Extract<RunnerMessage, { type: "event" }>,
): void {
  if (
    previous.liveHistoryVersion !== message.job.liveHistoryVersion ||
    previous.outputJournalVersion !== message.job.outputJournalVersion
  )
    throw new Error("Runner history capability changed");
  let cursor = previous.historyCursor ?? 0;
  const history = message.history ?? [];
  requireFinalHistoryLength(previous, message.job);
  if (history.length && previous.liveHistoryVersion !== 1)
    throw new Error("Runner history not enabled");
  if (Buffer.byteLength(JSON.stringify(history)) > 32_768)
    throw new Error("Runner history packet too large");
  for (const event of history) {
    if (event.sequence !== cursor + 1)
      throw new Error("Runner history out of sequence");
    cursor = event.sequence;
  }
  if ((message.job.historyCursor ?? 0) !== cursor)
    throw new Error("Runner history cursor mismatch");
}

function requireFinalHistoryLength(previous: RunnerJob, next: RunnerJob): void {
  if (
    previous.historyLength !== undefined &&
    previous.historyLength !== next.historyLength &&
    next.historyFailure !== "journal_unreadable"
  )
    throw new Error("Runner final history count changed");
  if (
    next.historyLength !== undefined &&
    !["completed", "failed", "interrupted", "lost"].includes(next.status)
  )
    throw new Error("Runner final history count requires a terminal job");
  const maximum =
    previous.outputJournalVersion === 2 ? Number.MAX_SAFE_INTEGER : 2_000;
  if (
    (next.historyLength ?? 0) > maximum ||
    (next.historyCursor ?? 0) > (next.historyLength ?? maximum)
  )
    throw new Error("Runner history exceeds its final count");
}

/** Only missing diagnostics may advance a terminal job; its result and plan remain immutable. */
export function isTerminalHistory(
  previous: RunnerJob,
  message: Extract<RunnerMessage, { type: "event" }>,
): boolean {
  return (
    previous.status === message.job.status &&
    ["completed", "failed", "interrupted", "lost"].includes(previous.status) &&
    previous.liveHistoryVersion === 1 &&
    previous.historyLength !== undefined &&
    message.delta === true &&
    message.result === undefined &&
    (message.history?.length ?? 0) > 0
  );
}
