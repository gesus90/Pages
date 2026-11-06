import { AgentError } from "@/backend/error/AgentErrors";

import { isOriginalRemoteJob } from "./AgentPlanRemoteCancellation";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { RunnerJob } from "@/definition/RunnerProtocol";
import type { RunnerService } from "@/backend/service/runner/RunnerService";
import type { RunnerPagesAccessService } from "@/backend/service/runner/RunnerPagesAccessService";
import type { RemotePlanStep } from "./AgentPlanRemoteExecution";

interface RestoredRemoteObservation {
  readonly runners: Pick<RunnerService, "progress">;
  readonly pages?: Pick<RunnerPagesAccessService, "close">;
  readonly wait: (job: RunnerJob) => Promise<Partial<AgentPlanStepResult>>;
  readonly settle: (
    result: Partial<AgentPlanStepResult>,
    attemptId: string,
  ) => Promise<Partial<AgentPlanStepResult>>;
}

/** Observes the exact existing claim after an engine crash without enqueuing a replacement job. */
export async function observeRemoteAttempt(
  run: AgentPlanRun,
  remote: RemotePlanStep,
  observation: RestoredRemoteObservation,
): Promise<Partial<AgentPlanStepResult>> {
  const step = run.steps.find((entry) => entry.id === remote.step.id);
  const execution = step?.execution;
  if (!step || execution?.target.kind !== "remote")
    throw new AgentError("plan_context_changed");
  const job = await observation.runners.progress(
    execution.target.connectionId,
    run.id,
    execution.attemptId,
  );
  if (!isOriginalRemoteJob(run, step, job))
    throw new AgentError("plan_context_changed");
  let result: Partial<AgentPlanStepResult>;
  try {
    result = await observation.wait(job);
  } finally {
    await observation.pages?.close(run.id, step.id, execution.attemptId);
  }
  return observation.settle(result, execution.attemptId);
}
