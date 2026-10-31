import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";

import type { RunnerService } from "@/backend/service/runner/RunnerService";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { RunnerJob } from "@/definition/RunnerProtocol";
import type { RemotePlanStep } from "./AgentPlanRemoteExecution";

interface RemoteClaim {
  readonly runners: Pick<RunnerService, "enqueue"> &
    Partial<Pick<RunnerService, "enqueueRetry">>;
  readonly run: AgentPlanRun;
  readonly remote: RemotePlanStep;
  readonly attemptId: string;
  readonly signal: AbortSignal;
  readonly allowTerminalRerun?: boolean;
}

/** Enqueues one frozen attempt; only an exact durable Stop fence proves no job was persisted. */
export async function claimRemoteJob(
  input: RemoteClaim,
): Promise<RunnerJob | null> {
  const { run, remote, attemptId, signal, allowTerminalRerun } = input;
  if (signal.aborted) return null;
  const binding = {
    planId: run.planId,
    runId: run.id,
    stepId: remote.step.id,
    attemptId,
    planRevision: run.planRevision,
  };
  const retry = allowTerminalRerun ? input.runners.enqueueRetry : undefined;
  try {
    return retry
      ? await retry(
          run.userId,
          remote.target.connectionId,
          binding,
          remote.command,
        )
      : await input.runners.enqueue(
          run.userId,
          remote.target.connectionId,
          binding,
          remote.command,
        );
  } catch (error: unknown) {
    if (error instanceof AgentPlanCancelledError) return null;
    throw error;
  }
}
