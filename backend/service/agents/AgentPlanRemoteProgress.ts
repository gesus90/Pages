import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { RunnerJob } from "@/definition/RunnerProtocol";
import type { RunnerService } from "@/backend/service/runner/RunnerService";

/** The runner calls a remote job that is needed for transport health; the rest of the runner stays out of this view. */
export type AgentPlanRemoteProgressSource = Pick<
  RunnerService,
  "progress" | "historyPending" | "contact"
>;

const OBSERVATION_STALE_MILLISECONDS = 45_000;

/**
 * Adds current transport health to confirmed job facts without mutating the stored execution state.
 *
 * @param run - The plan run whose remote steps are observed.
 * @param runners - The runner view that reports the progress of each remote job.
 * @returns A copy of the run with the observed remote facts on its steps.
 */
export async function withRemoteProgress(
  run: AgentPlanRun,
  runners: AgentPlanRemoteProgressSource,
): Promise<AgentPlanRun> {
  const steps = await Promise.all(
    run.steps.map(async (step) => {
      const execution = step.execution;
      if (execution?.target.kind !== "remote") return step;
      const job = await runners.progress(
        execution.target.connectionId,
        run.id,
        execution.attemptId,
      );
      if (!job) return step;
      return {
        ...step,
        remote: {
          ...step.remote,
          jobId: job.jobId,
          sessionId: job.sessionId,
          status: job.status,
          cancellation: job.cancellation,
          queueReason: job.queueReason,
          historyPending: await runners.historyPending(job.jobId),
          observedAt: job.observedAt,
          isObservationStale: isObservationStale(job),
          startedAt: step.remote?.startedAt ?? null,
          endedAt: step.remote?.endedAt ?? null,
          closeout: step.remote?.closeout ?? ("pending" as const),
          contact: runners.contact(execution.target.connectionId),
        },
      };
    }),
  );
  return { ...run, steps };
}

/** The runner confirms a quiet worker every 15 to 30 seconds; 45 seconds without it leave the process state unknown. */
function isObservationStale(job: RunnerJob): boolean {
  if (job.status !== "accepted" && job.status !== "running") return false;
  const observedAt = Date.parse(job.observedAt ?? "");
  return (
    !Number.isFinite(observedAt) ||
    Date.now() - observedAt > OBSERVATION_STALE_MILLISECONDS
  );
}
