import { AgentError } from "@/backend/error/AgentErrors";

import type { RunnerExecution } from "@/definition/RunnerExecution";

/** Requires the live runner capabilities that the requested execution uses. */
export function requireRunnerOutputExecutor(input: {
  readonly execution: RunnerExecution | undefined;
  readonly executionLeaseVersion: 1 | undefined;
  readonly isOnline: boolean;
  readonly hasCommunication: boolean;
  readonly hasExactPayload: boolean;
  readonly hasOutputJournal: boolean;
  readonly hasLiveHistory: boolean;
}): void {
  const { execution } = input;
  if (!input.isOnline) throw new AgentError("plan_remote_unavailable");
  if (
    execution &&
    (input.executionLeaseVersion !== 1 || !input.hasCommunication)
  )
    throw new AgentError("plan_runner_update_required");
  if (execution?.program.kind !== "cli") return;
  if (execution.resultPayloadVersion !== 1 || !input.hasExactPayload)
    throw new AgentError("plan_runner_payload_update_required");
  if (!input.hasOutputJournal || !input.hasLiveHistory)
    throw new AgentError("plan_runner_update_required");
}
