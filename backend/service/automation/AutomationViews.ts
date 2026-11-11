import type {
  Automation,
  AutomationAction,
  AutomationDelivery,
  AutomationPermissions,
  AutomationRunDetail,
  AutomationRunSummary,
} from "@/definition/Automation";
import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type { StoredAutomationAgentJob } from "@/backend/database/repositories/automation/AutomationAgentJobRepository";
import type { StoredAutomationRun } from "@/backend/database/repositories/automation/AutomationRunRepository";
import type { AutomationAccount } from "./AutomationDirectory";

/** What a view of an automation is built from besides the stored row. */
export interface AutomationViewContext {
  readonly creator: AutomationAccount | null;
  readonly permissions: AutomationPermissions;
  readonly canSeeScript: boolean;
  readonly lastRun: StoredAutomationRun | null;
}

function visibleAction(
  action: AutomationAction,
  canSeeScript: boolean,
): AutomationAction {
  if (action.type !== "script" || canSeeScript) return action;
  return { ...action, content: null };
}

function durationOf(run: StoredAutomationRun): number | null {
  if (!run.startedAt || !run.endedAt) return null;
  const duration = Date.parse(run.endedAt) - Date.parse(run.startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

/**
 * The list entry of a run.
 *
 * @param run - The stored run.
 * @param automationName - The name of its automation.
 */
export function automationRunSummary(
  run: StoredAutomationRun,
  automationName: string,
): AutomationRunSummary {
  return {
    runId: run.id,
    automationId: run.automationId,
    automationName,
    queuedAt: run.queuedAt,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    trigger: {
      kind: run.triggerKind,
      ...(run.eventType ? { eventType: run.eventType } : {}),
      subject: run.triggerSubject,
    },
    status: run.status,
    result: run.outcome
      ? {
          outcome: run.outcome,
          exitCode: run.exitCode,
          forward: run.forwardState,
          planRunId: run.planRunId,
          planRunStatus: run.planRunStatus,
          paused: run.paused,
          errorCode: run.errorCode,
          summary: run.summary,
        }
      : null,
    duration: durationOf(run),
  };
}

function readTriggerData(
  value: string | null,
): Readonly<Record<string, unknown>> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return null;
    return Object.fromEntries(Object.entries(parsed));
  } catch {
    return null;
  }
}

function deliveryOf(job: StoredAutomationAgentJob): AutomationDelivery {
  return {
    agentId: job.agentId,
    kind: job.kind,
    state: job.state,
    queuedAt: job.queuedAt,
    deliveredAt: job.deliveredAt,
    completedAt: job.completedAt,
    errorCode: job.errorCode,
  };
}

/**
 * One run with its bounded outputs.
 *
 * @param run - The stored run.
 * @param context - The automation's name, the run's deliveries and whether
 * the reader may see a script's output.
 */
export function automationRunDetail(
  run: StoredAutomationRun,
  context: {
    readonly automationName: string;
    readonly jobs: readonly StoredAutomationAgentJob[];
    readonly canSeeOutput: boolean;
  },
): AutomationRunDetail {
  return {
    ...automationRunSummary(run, context.automationName),
    answer: run.answer,
    output: context.canSeeOutput ? run.output : null,
    error: run.error,
    triggerData: readTriggerData(run.triggerData),
    deliveries: context.jobs.map(deliveryOf),
  };
}

/**
 * An automation as one account sees it.
 *
 * @param automation - The stored automation.
 * @param context - Its creator, the reader's permissions and its last run.
 */
export function automationView(
  automation: StoredAutomation,
  context: AutomationViewContext,
): Automation {
  return {
    id: automation.id,
    revision: automation.revision,
    creator: {
      accountId: automation.creatorId,
      kind: context.creator?.isAgent ? "agent" : "human",
      displayName: context.creator?.displayName ?? "",
    },
    name: automation.name,
    trigger: automation.trigger,
    action: visibleAction(automation.action, context.canSeeScript),
    sharing: automation.sharing,
    isActive: automation.isActive,
    deleteAfterSuccess: automation.deleteAfterSuccess,
    agentNotification: automation.agentNotification,
    nextRunAt: automation.isActive ? automation.nextRunAt : null,
    lastRun: context.lastRun
      ? automationRunSummary(context.lastRun, automation.name)
      : null,
    permissions: context.permissions,
    createdAt: automation.createdAt,
    updatedAt: automation.updatedAt,
  };
}
