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
  context: { readonly plan: AgentPlanView; readonly readError: string | null },
): string | null {
  if (!context.plan.canEdit) return "plan_read_only";
  if (!run) return context.readError ?? "own_run_required";
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
  const readable = ownRun
    ? await readableRun(plans, userId, ownRun.id)
    : { run: null, error: null };
  const run = readable.run;
  const context = { plan, readError: readable.error };
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
    issue: !plan.canEdit ? "plan_read_only" : (readable.error ?? issue),
    blockers: {
      delete:
        plan.ownerId !== userId
          ? "plan_owner_required"
          : (isActive && "plan_busy") || null,
      play: playBlocker(plan, control, issue),
      pause: runBlocker(control.canPause, run, "run_not_running", context),
      resume: runBlocker(
        control.canResume,
        run,
        issue ?? "run_not_paused",
        context,
      ),
      stop: runBlocker(
        control.canStop,
        run,
        "run_terminal_or_stopping",
        context,
      ),
    },
    ...startIssues(plan, control),
    ...workspaceDetails(plan, control),
    ...readableRunMetadata(run),
  };
}

function workspaceDetails(
  plan: AgentPlanView,
  control: AgentPlanControl,
): Pick<AgentPlanControlEntry, "workspaceConflict" | "lastStartRejection"> {
  if (!plan.canEdit) return {};
  return {
    ...(control.workspaceConflict
      ? { workspaceConflict: control.workspaceConflict }
      : {}),
    ...(control.lastStartRejection
      ? { lastStartRejection: control.lastStartRejection }
      : {}),
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
      ...(issue.asset ? { asset: issue.asset } : {}),
    })),
  };
}

async function readableRun(
  plans: AgentPlanService,
  userId: string,
  runId: string,
): Promise<{
  readonly run: AgentPlanRun | null;
  readonly error: string | null;
}> {
  try {
    return { run: await plans.run(userId, runId), error: null };
  } catch (error: unknown) {
    if (error instanceof AgentError || error instanceof AgentExecutionError)
      return { run: null, error: error.code };
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
