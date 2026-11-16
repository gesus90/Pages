import type {
  RunnerMessage,
  RunnerReply,
  RunnerState,
} from "@/definition/RunnerProtocol";

/** Accepts only the current pause request of the exact attempt; a stop always wins. */
export function applyExecutionState(
  state: RunnerState,
  message: Extract<RunnerMessage, { type: "execution-state" }>,
): { readonly state: RunnerState; readonly reply: RunnerReply } {
  const job = state.jobs.find((entry) => entry.jobId === message.jobId);
  if (
    !job?.plan ||
    job.plan.attemptId !== message.attemptId ||
    state.executionControlVersion !== 1
  )
    throw new Error("Runner execution control binding mismatch");
  const reply: RunnerReply = {
    version: 1,
    type: "heartbeat",
    sessionId: state.sessionId,
  };
  const isCurrent =
    !job.cancellation &&
    job.executionPauseRequestedAt === message.control.requestedAt &&
    job.isPaused === message.control.isPaused;
  if (!isCurrent) return { state, reply };
  return {
    state: {
      ...state,
      jobs: state.jobs.map((entry) =>
        entry.jobId === job.jobId
          ? { ...entry, executionControl: message.control }
          : entry,
      ),
    },
    reply,
  };
}
