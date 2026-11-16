import { isOriginalRemoteJob } from "@/backend/service/agents/AgentPlanRemoteCancellation";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { RunnerService } from "./RunnerService";

/** The audit target of a Pages tool call, or `null` when it names no ticket, page or project. */
export function auditTarget(
  parameters: Readonly<Record<string, unknown>>,
): string | null {
  const target =
    parameters.ticketId ?? parameters.pageId ?? parameters.projectId;
  return typeof target === "string" &&
    /^(?:[a-f0-9-]{36}|[A-Z][A-Z0-9]{0,15}-[0-9]{1,10})$/u.test(target)
    ? target
    : null;
}

/** Whether a remote job may restore the Pages access of a running step. */
export function canRestoreRemoteJob(
  run: AgentPlanRun,
  step: AgentPlanRun["steps"][number],
  job: Awaited<ReturnType<RunnerService["progress"]>>,
): boolean {
  return (
    isOriginalRemoteJob(run, step, job) &&
    !job.cancellation &&
    ["queued", "accepted", "running"].includes(job.status)
  );
}
