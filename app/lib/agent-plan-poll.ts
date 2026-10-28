import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { readPlanStartRejection } from "@/backend/agents/AgentPlanStartRejectionInput";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import { AGENT_PLAN_ISSUE_PROBLEMS } from "@/definition/AgentPlanOperations";

import type { AgentPlanActionResult } from "./agent-plan-response";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";
import type { AgentPlanWorkspaceConflict } from "@/definition/AgentPlanWorkspaceConflict";

function nullableText(input: unknown): string | null {
  if (input === null || typeof input === "string") return input;
  throw new Error("Invalid plan response");
}

function readNumber(input: unknown): number {
  if (typeof input === "number" && Number.isSafeInteger(input) && input >= 0)
    return input;
  throw new Error("Invalid plan response");
}

function readBoolean(input: unknown): boolean {
  if (typeof input === "boolean") return input;
  throw new Error("Invalid plan response");
}

function requiredText(input: unknown): string {
  if (typeof input === "string") return input;
  throw new Error("Invalid plan response");
}

function readWorkspaceConflict(input: unknown): AgentPlanWorkspaceConflict {
  const conflict = readAgentObject(input);
  if (
    (conflict.kind !== "reserved" && conflict.kind !== "parallel_writers") ||
    !Array.isArray(conflict.targets) ||
    !Array.isArray(conflict.nodes)
  )
    throw new Error("Invalid plan response");
  return {
    kind: conflict.kind,
    targets: conflict.targets.map((value: unknown) => {
      const target = readAgentObject(value);
      if (target.kind !== "local" && target.kind !== "remote")
        throw new Error("Invalid plan response");
      return {
        kind: target.kind,
        workspaceId: requiredText(target.workspaceId),
        path: requiredText(target.path),
        connectionName: nullableText(target.connectionName),
        workspaceName: nullableText(target.workspaceName),
      };
    }),
    nodes: conflict.nodes.map((value: unknown) => {
      const node = readAgentObject(value);
      return { id: requiredText(node.id), name: requiredText(node.name) };
    }),
  };
}

function isStatus(input: unknown): input is AgentPlanControl["status"] {
  return (
    typeof input === "string" &&
    [
      "idle",
      "running",
      "pausing",
      "paused",
      "stopping",
      "succeeded",
      "failed",
      "cancelled",
    ].includes(input)
  );
}

/** Every finding of the graph check, loops and groups included, is a known reason. */
function isIssueReason(input: unknown): input is AgentPlanIssue["reason"] {
  return AGENT_PLAN_ISSUE_PROBLEMS.some((reason) => reason === input);
}

function readIssue(input: unknown): AgentPlanIssue {
  const issue = readAgentObject(input);
  if (!isIssueReason(issue.reason)) throw new Error("Invalid plan response");
  return {
    nodeId: nullableText(issue.nodeId),
    port: nullableText(issue.port),
    reason: issue.reason,
  };
}

function readControl(input: unknown): AgentPlanControl {
  const control = readAgentObject(input);
  if (!isStatus(control.status) || !Array.isArray(control.frontierStepIds))
    throw new Error("Invalid plan response");
  const frontierStepIds = control.frontierStepIds.map((id: unknown) => {
    if (typeof id !== "string") throw new Error("Invalid plan response");
    return id;
  });
  return {
    runId: nullableText(control.runId),
    status: control.status,
    canPlay: readBoolean(control.canPlay),
    canPause: readBoolean(control.canPause),
    canResume: readBoolean(control.canResume),
    canStop: readBoolean(control.canStop),
    canEdit: readBoolean(control.canEdit),
    issue: nullableText(control.issue),
    issues: Array.isArray(control.issues)
      ? control.issues.map(readIssue)
      : undefined,
    ...(control.workspaceConflict === undefined
      ? {}
      : {
          workspaceConflict: readWorkspaceConflict(control.workspaceConflict),
        }),
    ...(control.lastStartRejection === undefined
      ? {}
      : {
          lastStartRejection: readPlanStartRejection(
            control.lastStartRejection,
          ),
        }),
    planRevision:
      control.planRevision === null ? null : readNumber(control.planRevision),
    continuationVersion: readNumber(control.continuationVersion),
    frontierStepIds,
  };
}

/** Reads the two polling responses without trusting a failed or redirected request as current state. */
export function readPlanPollingResponse(input: unknown): AgentPlanActionResult {
  const response = readAgentObject(input);
  const intent = typeof response.intent === "string" ? response.intent : "poll";
  if (response.ok === false)
    return {
      ok: false,
      intent,
      error: typeof response.error === "string" ? response.error : "general",
    };
  if (response.ok !== true) throw new Error("Invalid plan response");
  if (response.control !== undefined)
    return { ok: true, intent, control: readControl(response.control) };
  if (response.run !== undefined)
    return { ok: true, intent, run: readPlanRun(response.run) };
  throw new Error("Invalid plan response");
}
