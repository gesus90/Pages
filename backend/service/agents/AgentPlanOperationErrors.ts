import { AgentError } from "@/backend/error/AgentErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentPlanIssueEntry } from "@/definition/AgentPlanOperations";
import type { AgentRejectionReason } from "@/definition/PagesAgentOperations";

type Reason = AgentRejectionReason["reason"];

/** Findings a refusal carries at most; the first ones name what to fix first. */
const MAXIMUM_ISSUES = 50;

/** Refusals of the plan page that name the input to change. */
const PLAN_REASONS: Readonly<Partial<Record<AgentErrorCode, Reason>>> = {
  plan_invalid: "graph_invalid",
  plan_binding_invalid: "graph_invalid",
  plan_cycle: "graph_invalid",
  plan_json_invalid: "parameter_value_invalid",
  plan_number_invalid: "parameter_value_invalid",
  parameter_invalid: "parameter_value_invalid",
  parameter_number_invalid: "parameter_value_invalid",
  profile_target_invalid: "sharing_target_unavailable",
  parameter_reference_unavailable: "parameter_reference_unavailable",
  parameter_ticket_unavailable: "parameter_reference_unavailable",
  agent_usage_denied: "parameter_reference_unavailable",
  // Script nodes keep the codes of the plan page.
  plan_script_invalid: "plan_script_invalid",
  plan_script_profile_missing: "plan_script_profile_missing",
};

function rejected(reason: Reason): AgentOperationError {
  return new AgentOperationError("INVALID_REQUEST", { reason });
}

function translateAgentError(error: AgentError): AgentOperationError {
  if (error instanceof AgentPlanValidationError) {
    const issues: AgentPlanIssueEntry[] = error.issues
      .slice(0, MAXIMUM_ISSUES)
      .map((issue) => ({
        nodeId: issue.nodeId,
        port: issue.port,
        problem: issue.reason,
      }));
    return new AgentOperationError("INVALID_REQUEST", {
      reason: "graph_invalid",
      issues,
    });
  }
  // A plan that is hidden answers like a missing one, as on the plan page.
  if (error.code === "plan_access_denied")
    return new AgentOperationError("NOT_FOUND");
  if (error.code === "plan_conflict" || error.code === "plan_context_changed")
    return new AgentOperationError("CONFLICT");
  if (error.code.startsWith("workspace_"))
    return rejected("workspace_unavailable");
  const reason = PLAN_REASONS[error.code];
  return reason === undefined
    ? new AgentOperationError("INVALID_REQUEST")
    : rejected(reason);
}

/**
 * Turns the failures of the plan services into the fixed codes of the agent API.
 *
 * @param error - Whatever the plan service, the graph check or the text check threw.
 * @returns The agent API error for a business failure, or the error unchanged.
 *
 * @remarks
 * No message is passed on, only its class and, for the graph check, the
 * node, port and name of every finding, which hold no content.
 */
export function translatePlanError(error: unknown): unknown {
  if (error instanceof AgentError) return translateAgentError(error);
  if (error instanceof AgentExecutionError)
    return error.code === "credentialsInText"
      ? rejected("credentials_in_text")
      : new AgentOperationError("INVALID_REQUEST");
  return error;
}
