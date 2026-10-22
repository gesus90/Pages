import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import type {
  RunnerJob,
  RunnerMessage,
  RunnerReply,
  RunnerState,
} from "@/definition/RunnerProtocol";

const TRANSITIONS: Readonly<
  Record<RunnerJob["status"], readonly RunnerJob["status"][]>
> = {
  queued: ["accepted", "lost"],
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
    sequence: message.sequence,
    lastEventId: message.eventId,
    lastEventDigest: planContentDigest(message),
    jobs: state.jobs.map((job) =>
      job.jobId === message.job.jobId ? message.job : job,
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
  const reconciled = { ...state, jobs };
  return {
    state: reconciled,
    reply: { version: 1, type: "reconcile", state: reconciled },
  };
}

function requireTransition(
  state: RunnerState,
  message: Extract<RunnerMessage, { type: "event" }>,
): void {
  const previous = state.jobs.find((job) => job.jobId === message.job.jobId);
  if (!previous || !TRANSITIONS[previous.status].includes(message.job.status))
    throw new Error("Invalid runner job transition");
  if (
    planContentDigest(previous.execution ?? null) !==
      planContentDigest(message.job.execution ?? null) ||
    planContentDigest(previous.plan ?? null) !==
      planContentDigest(message.job.plan ?? null)
  )
    throw new Error("Runner context changed");
  if (
    previous.launch &&
    planContentDigest(previous.launch) !== planContentDigest(message.job.launch)
  )
    throw new Error("Runner launch changed");
  if (
    previous.execution &&
    message.job.status !== "lost" &&
    !message.job.launch
  )
    throw new Error("Runner launch confirmation required");
}
