import { isAgentErrorCode } from "@/backend/error/AgentErrors";
import {
  controlOnlyPlanControl,
  readPlanControlRun,
} from "./AgentPlanControlAccess";

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
  const { control, run, readable, context, continuationVersion } =
    await controlAccess(plans, userId, plan);
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
    canRestart: control.canRestart === true && run !== null,
    resumeAction: control.resumeAction,
    cleanup: control.cleanup,
    workspaceWait: control.workspaceWait,
    canPause: control.canPause && readable !== null,
    canResume: control.canResume && readable !== null,
    canStop: control.canStop && run !== null,
    issue: !plan.canEdit ? "plan_read_only" : (context.readError ?? issue),
    blockers: {
      delete:
        plan.ownerId !== userId
          ? "plan_owner_required"
          : (isActive && "plan_busy") || null,
      play: playBlocker(plan, control, issue),
      pause: runBlocker(control.canPause, readable, "run_not_running", context),
      resume: runBlocker(
        control.canResume,
        readable,
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
    ...readableRunMetadata(run, continuationVersion),
  };
}

async function controlAccess(
  plans: AgentPlanService,
  userId: string,
  plan: AgentPlanView,
): Promise<{
  readonly control: AgentPlanControl;
  readonly run: AgentPlanRun | null;
  readonly readable: AgentPlanRun | null;
  readonly context: {
    readonly plan: AgentPlanView;
    readonly readError: string | null;
  };
  readonly continuationVersion: number;
}> {
  const initialControl = await plans.control(userId, plan.id);
  const access =
    plan.canEdit && initialControl.runId
      ? await readPlanControlRun(plans, userId, plan.id, initialControl.runId)
      : null;
  const control =
    access && !access.hasHistoryAccess
      ? controlOnlyPlanControl(initialControl, access)
      : initialControl;
  const run = access?.run ?? null;
  const readable = access?.hasHistoryAccess ? run : null;
  const context = {
    plan,
    readError: run && !readable ? "plan_access_denied" : null,
  };
  return {
    control,
    run,
    readable,
    context,
    continuationVersion: access?.continuationVersion ?? 0,
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
  continuationVersion: number,
): Pick<
  AgentPlanControlEntry,
  "runId" | "planRevision" | "continuationVersion"
> {
  if (!run) return {};
  return {
    runId: run.id,
    planRevision: run.continuation?.planRevision ?? run.planRevision,
    continuationVersion,
  };
}
