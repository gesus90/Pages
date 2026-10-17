import { AgentError } from "@/backend/error/AgentErrors";
import { sessionAttemptId } from "@/definition/AgentSessionJournal";

import type { AcpProviderId } from "@/definition/AgentConfiguration";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type {
  AgentSessionKey,
  AgentSessionModelReport,
  AgentSessionReportedValue,
} from "@/definition/AgentSessionJournal";
import type { AgentSessionAttemptRecord } from "./AgentSessionStore";

/** The attempt of one node in a run, with the record it belongs to. */
export interface AgentSessionAttempt {
  readonly key: AgentSessionKey;
  readonly step: AgentPlanStepResult;
  readonly record: AgentPlanSessionRecord;
  /** The record predates attempt IDs; its attempt is derived from process instance and node. */
  readonly isLegacy: boolean;
}

/** The node of a plan run as the step runner holds it. */
export interface AgentSessionNode {
  readonly run: Pick<AgentPlanRun, "id" | "planId" | "userId">;
  readonly step: {
    readonly step: { readonly id: string };
    readonly groupId?: string;
  };
  readonly record: AgentPlanSessionRecord | null;
}

/** What the recording of a turn starts from. */
export interface AgentSessionStart {
  readonly key: AgentSessionKey;
  readonly userId: string;
  readonly provider: AcpProviderId;
  readonly instanceId: string;
  readonly groupId: string | null;
  /** The directory Pages assigned and checked when it prepared the node. */
  readonly directory: string | null;
}

const UNKNOWN: AgentSessionReportedValue = {
  value: null,
  source: null,
  reportedAt: null,
};

/**
 * The attempt ID of a node's record.
 *
 * @remarks
 * Records from before PAGE-85 have none. Instance and node identify their
 * only attempt: members of an ACP group share the instance, never the node.
 */
export function attemptIdOf(
  record: AgentPlanSessionRecord,
  stepId: string,
): { readonly attemptId: string; readonly isLegacy: boolean } {
  return {
    attemptId: sessionAttemptId(record, stepId),
    isLegacy: record.attemptId === undefined,
  };
}

/**
 * What recording a turn of a node starts from.
 *
 * @param node - The run, node and record of the turn.
 * @param instanceId - The process the turn runs in; members of a group share it.
 * @returns `null` for an API request or a record without an attempt ID.
 */
export function sessionStart(
  node: AgentSessionNode,
  instanceId: string,
): AgentSessionStart | null {
  const { record } = node;
  if (!record?.attemptId || record.runner === "api") return null;
  return {
    key: {
      planId: node.run.planId,
      runId: node.run.id,
      stepId: node.step.step.id,
      attemptId: record.attemptId,
    },
    userId: node.run.userId,
    provider: record.runner,
    instanceId,
    groupId: node.step.groupId ?? null,
    directory: record.requested.directory,
  };
}

/**
 * Lists the PageAgentCLI attempts of a run: every agent node with a CLI session.
 *
 * @param run - A run the caller already authorized.
 */
export function listSessionAttempts(
  run: AgentPlanRun,
): readonly AgentSessionAttempt[] {
  return run.steps.flatMap((step) => {
    const record = step.session;
    if (!record || record.runner === "api") return [];
    const { attemptId, isLegacy } = attemptIdOf(record, step.id);
    return [
      {
        key: { planId: run.planId, runId: run.id, stepId: step.id, attemptId },
        step,
        record,
        isLegacy,
      },
    ];
  });
}

/**
 * Finds the attempt a key names in an authorized run.
 *
 * @throws {AgentError} `plan_access_denied` when plan, run, node or attempt
 * do not belong together, so a key of another run, another member of a
 * group or an older attempt reads nothing.
 */
export function requireSessionAttempt(
  run: AgentPlanRun,
  key: AgentSessionKey,
): AgentSessionAttempt {
  if (run.id !== key.runId || run.planId !== key.planId)
    throw new AgentError("plan_access_denied");
  const attempt = listSessionAttempts(run).find(
    (entry) =>
      entry.key.stepId === key.stepId && entry.key.attemptId === key.attemptId,
  );
  if (!attempt) throw new AgentError("plan_access_denied");
  return attempt;
}

function legacyConfirmation(
  record: AgentPlanSessionRecord,
  field: "model" | "reasoningEffort",
): AgentSessionReportedValue {
  const value = record.effective?.[field];
  // Pages fills in OpenCode's default effort itself; the adapter never confirmed it.
  if (
    value === undefined ||
    (record.runner === "opencode" && value === "default")
  )
    return UNKNOWN;
  return {
    value,
    source:
      record.runner === "opencode" ? "adapter_selector" : "acp_config_option",
    reportedAt: record.turnEndedAt,
  };
}

/**
 * Keeps the model and effort Pages asked for apart from what the adapter confirmed.
 *
 * @param record - The session record of the node.
 * @param attempt - The journal's state of the attempt, with model reports and their time.
 */
export function describeSessionModel(
  record: AgentPlanSessionRecord,
  attempt: AgentSessionAttemptRecord | null,
): AgentSessionModelReport {
  const requestedAt = record.startedAt;
  return {
    requestedModel: {
      value: record.requested.model,
      source: "plan",
      reportedAt: requestedAt,
    },
    requestedReasoning: {
      value: record.requested.reasoningEffort,
      source: "plan",
      reportedAt: requestedAt,
    },
    confirmedModel:
      attempt && attempt.confirmedModel.value !== null
        ? attempt.confirmedModel
        : legacyConfirmation(record, "model"),
    confirmedReasoning:
      attempt && attempt.confirmedReasoning.value !== null
        ? attempt.confirmedReasoning
        : legacyConfirmation(record, "reasoningEffort"),
  };
}
