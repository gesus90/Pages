import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { applyRunnerMessage } from "./RunnerProtocol";

import type {
  RunnerRecord,
  RunnerRepository,
} from "@/backend/database/repositories/runner/RunnerRepository";
import type {
  RunnerJob,
  RunnerMessage,
  RunnerReply,
  RunnerState,
} from "@/definition/RunnerProtocol";
import type { RunnerPlanEventService } from "./RunnerPlanEventService";

interface CheckpointInput {
  readonly closeManaged?: (job: RunnerJob) => Promise<void>;
  readonly connectionId: string;
  readonly repository: Pick<RunnerRepository, "checkpoint"> &
    Partial<Pick<RunnerRepository, "archivedJob">>;
  readonly record: RunnerRecord;
  readonly events: RunnerPlanEventService | undefined;
  readonly message: RunnerMessage;
}

/** Commits control and lossless event custody before independently restoring the public archive. */
export async function checkpointRunnerMessage(
  input: CheckpointInput,
): Promise<{ readonly state: RunnerState; readonly reply: RunnerReply }> {
  const { events, record, connectionId, repository } = input;
  const message = await reconcileArchivedJobs(input);
  const replay = await events?.replay(connectionId, record.state, message);
  if (replay)
    return {
      state: record.state,
      reply: replay,
    };
  const basis =
    message.type === "reconcile" && events
      ? await events.fenceStoppedRuns(record.state)
      : record.state;
  const result = applyRunnerMessage(basis, message);
  await closeManagedMessage(input, result.state, message);
  if (result.state !== record.state) await events?.prepareHistory(message);
  if (result.state !== record.state)
    await repository.checkpoint(
      connectionId,
      result.state,
      (transaction) =>
        events?.apply(transaction, connectionId, {
          previous: record.state,
          state: result.state,
          message,
        }) ?? Promise.resolve(),
    );
  return {
    state: result.state,
    reply: result.reply,
  };
}

async function reconcileArchivedJobs(
  input: CheckpointInput,
): Promise<RunnerMessage> {
  const message = input.message;
  if (message.type !== "reconcile") return message;
  const jobs = [];
  for (const job of message.jobs) {
    if (input.record.state.jobs.some((entry) => entry.jobId === job.jobId)) {
      jobs.push(job);
      continue;
    }
    const archived = await input.repository.archivedJob?.(
      input.connectionId,
      job.jobId,
    );
    if (
      !archived ||
      archived.sessionId !== job.sessionId ||
      archived.status !== job.status ||
      planContentDigest(archived.plan) !== planContentDigest(job.plan)
    )
      throw new Error("Unknown runner job");
  }
  return { ...message, jobs };
}

async function closeManagedMessage(
  input: CheckpointInput,
  state: RunnerState,
  message: RunnerMessage,
): Promise<void> {
  let jobId: string | undefined;
  if (message.type === "event" && message.result?.closeout === "confirmed")
    jobId = message.job.jobId;
  if (
    message.type === "stop-result" &&
    message.cancellation.closeout === "confirmed"
  )
    jobId = message.jobId;
  const job = state.jobs.find((entry) => entry.jobId === jobId);
  if (job?.plan?.managed) await input.closeManaged?.(job);
}
