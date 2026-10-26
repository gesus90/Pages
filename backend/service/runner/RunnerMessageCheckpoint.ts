import { applyRunnerMessage } from "./RunnerProtocol";

import type {
  RunnerRecord,
  RunnerRepository,
} from "@/backend/database/repositories/runner/RunnerRepository";
import type {
  RunnerMessage,
  RunnerReply,
  RunnerState,
} from "@/definition/RunnerProtocol";
import type { RunnerPlanEventService } from "./RunnerPlanEventService";

interface CheckpointInput {
  readonly connectionId: string;
  readonly repository: RunnerRepository;
  readonly record: RunnerRecord;
  readonly events: RunnerPlanEventService | undefined;
  readonly message: RunnerMessage;
}

/** Commits control and lossless event custody before independently restoring the public archive. */
export async function checkpointRunnerMessage(
  input: CheckpointInput,
): Promise<{ readonly state: RunnerState; readonly reply: RunnerReply }> {
  const { events, record, message, connectionId, repository } = input;
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
