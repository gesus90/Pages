import { AgentError, isAgentErrorCode } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";

import type { AgentPlanControlEntry } from "@/definition/AgentPlanOperations";
import type { AgentPlanService } from "./AgentPlanService";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanRun, AgentPlanView } from "@/definition/AgentPlan";

function playBlocker(
  plan: AgentPlanView,
  control: AgentPlanControl,
  issue: string | null,
): string | null {
  if (control.canPlay) return null;
  if (!plan.canEdit) return "plan_read_only";
  if (["running", "pausing", "paused", "stopping"].includes(control.status))
    return "plan_busy";
  return issue ?? "plan_run_unavailable";
}

function runBlocker(
  canAct: boolean,
  run: AgentPlanRun | null,
  reason: string,
  plan: AgentPlanView,
): string | null {
  if (!plan.canEdit) return "plan_read_only";
  if (!run) return "own_run_required";
  return canAct ? null : reason;
}

/** Projects current action availability without exposing another executor's run identity or failure. */
export async function readPlanControlEntry(
  plans: AgentPlanService,
  userId: string,
  planId: string,
): Promise<AgentPlanControlEntry> {
  const plan = await plans.view(userId, planId);
  const control = await plans.control(userId, planId);
  const entries = await plans.runEntries(userId, planId, "newest");
  const ownRun = entries.find((entry) => entry.id === control.runId);
  const run = ownRun ? await readableRun(plans, userId, ownRun.id) : null;
  const isActive = ["running", "pausing", "paused", "stopping"].includes(
    control.status,
  );
  const canDelete = plan.ownerId === userId && !isActive;
  const issue = visibleControlIssue(control);
  return {
    planId,
    revision: plan.revision,
    status: control.status,
    canEdit: plan.canEdit,
    canDelete,
    canPlay: control.canPlay,
    canPause: control.canPause && run !== null,
    canResume: control.canResume && run !== null,
    canStop: control.canStop && run !== null,
    issue: !plan.canEdit ? "plan_read_only" : issue,
    blockers: {
      delete:
        plan.ownerId !== userId
          ? "plan_owner_required"
          : (isActive && "plan_busy") || null,
      play: playBlocker(plan, control, issue),
      pause: runBlocker(control.canPause, run, "run_not_running", plan),
      resume: runBlocker(
        control.canResume,
        run,
        issue ?? "run_not_paused",
        plan,
      ),
      stop: runBlocker(control.canStop, run, "run_terminal_or_stopping", plan),
    },
    ...startIssues(plan, control),
    ...readableRunMetadata(run),
  };
}

/** A start refusal names its nodes and reasons instead of a bare `plan_invalid`. */
function startIssues(
  plan: AgentPlanView,
  control: AgentPlanControl,
): Pick<AgentPlanControlEntry, "issues"> {
  if (!plan.canEdit || !control.issues?.length) return {};
  return {
    issues: control.issues.map((issue) => ({
      nodeId: issue.nodeId,
      port: issue.port,
      problem: issue.reason,
    })),
  };
}

async function readableRun(
  plans: AgentPlanService,
  userId: string,
  runId: string,
): Promise<AgentPlanRun | null> {
  try {
    return await plans.run(userId, runId);
  } catch (error: unknown) {
    if (error instanceof AgentError || error instanceof AgentExecutionError)
      return null;
    throw error;
  }
}

function visibleControlIssue(control: AgentPlanControl): string | null {
  const issue = control.issue;
  if (!issue) return null;
  return isAgentErrorCode(issue) ||
    [
      "accessDenied",
      "connectionUnavailable",
      "accessUnverified",
      "modelUnavailable",
      "reasoningUnsupported",
    ].includes(issue)
    ? issue
    : null;
}

function readableRunMetadata(
  run: AgentPlanRun | null,
): Pick<
  AgentPlanControlEntry,
  "runId" | "planRevision" | "continuationVersion"
> {
  if (!run) return {};
  return {
    runId: run.id,
    planRevision: run.continuation?.planRevision ?? run.planRevision,
    continuationVersion: run.continuation?.version ?? 0,
  };
}
