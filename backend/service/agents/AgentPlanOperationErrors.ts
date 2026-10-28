import { AgentError } from "@/backend/error/AgentErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentPlanIssueEntry } from "@/definition/AgentPlanOperations";
import type { AgentPlanRecoveryErrorCode } from "@/definition/AgentPlanRecovery";
import type { AgentRejectionReason } from "@/definition/PagesAgentOperations";

type Reason = AgentRejectionReason["reason"];

/** Findings a refusal carries at most; the first ones name what to fix first. */
const MAXIMUM_ISSUES = 50;

/** Refusals of the plan page that name the input to change. */
const PLAN_REASONS: Readonly<Partial<Record<AgentErrorCode, Reason>>> = {
  plan_invalid: "graph_invalid",
  plan_loop_invalid: "graph_invalid",
  plan_loop_nested: "graph_invalid",
  plan_loop_runs_invalid: "parameter_value_invalid",
  plan_model_unavailable: "model_unavailable",
  plan_reasoning_unsupported: "reasoning_unsupported",
  plan_binding_invalid: "graph_invalid",
  plan_cycle: "graph_invalid",
  plan_json_invalid: "parameter_value_invalid",
  plan_number_invalid: "parameter_value_invalid",
  parameter_invalid: "parameter_value_invalid",
  configuration_invalid: "configuration_invalid",
  template_name_taken: "element_exists",
  template_invalid: "graph_invalid",
  parameter_number_invalid: "parameter_value_invalid",
  profile_target_invalid: "sharing_target_unavailable",
  parameter_reference_unavailable: "parameter_reference_unavailable",
  parameter_ticket_unavailable: "parameter_reference_unavailable",
  agent_usage_denied: "parameter_reference_unavailable",
  agent_inactive: "parameter_reference_unavailable",
  plan_name_taken: "plan_name_taken",
  plan_running: "plan_running",
  plan_run_unavailable: "plan_run_unavailable",
  plan_history_unavailable: "plan_history_unavailable",
  plan_start_rejection_record_failed: "plan_start_rejection_record_failed",
  plan_remote_unavailable: "plan_remote_unavailable",
  plan_runner_payload_update_required: "plan_runner_payload_update_required",
  plan_workspace_conflict: "plan_workspace_conflict",
  plan_script_permission_denied: "plan_script_permission_denied",
  plan_script_interpreter_unavailable: "plan_script_interpreter_unavailable",
  plan_continuation_deleted: "plan_continuation_deleted",
  // Script nodes keep the codes of the plan page.
  plan_script_invalid: "plan_script_invalid",
  plan_script_profile_missing: "plan_script_profile_missing",
};

const RECOVERY_REASONS: Readonly<
  Partial<Record<AgentPlanRecoveryErrorCode, Reason>>
> = {
  cleanup_unconfirmed: "plan_recovery_cleanup_unconfirmed",
  diagnostic_unavailable: "plan_recovery_diagnostic_unavailable",
  review_required: "plan_recovery_review_required",
  native_resume_unavailable: "plan_recovery_native_resume_unavailable",
  checkpoint_invalid: "plan_recovery_checkpoint_invalid",
  checkpoint_too_large: "plan_recovery_checkpoint_too_large",
  workflow_unavailable: "plan_recovery_workflow_unavailable",
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
        ...(issue.asset ? { asset: issue.asset } : {}),
      }));
    return new AgentOperationError("INVALID_REQUEST", {
      reason: "graph_invalid",
      issues,
    });
  }
  // A plan that is hidden answers like a missing one, as on the plan page.
  if (
    error.code === "plan_access_denied" ||
    error.code === "template_not_found"
  )
    return new AgentOperationError("NOT_FOUND");
  if (error.code === "plan_project_owner_only")
    return new AgentOperationError("FORBIDDEN");
  if (error.code === "plan_context_changed")
    return new AgentOperationError("CONFLICT", {
      reason: "plan_context_changed",
    });
  if (error.code === "plan_conflict")
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
  if (error instanceof AgentPlanRecoveryError) return recoveryError(error);
  if (error instanceof AgentError) return translateAgentError(error);
  if (error instanceof AgentExecutionError)
    return rejected(executionReason(error));
  return error;
}

function recoveryError(error: AgentPlanRecoveryError): AgentOperationError {
  if (error.code === "access_denied")
    return new AgentOperationError("NOT_FOUND");
  if (error.code === "revision_conflict")
    return new AgentOperationError("CONFLICT", {
      reason: "plan_recovery_revision_conflict",
    });
  if (error.code === "idempotency_conflict")
    return new AgentOperationError("CONFLICT", {
      reason: "plan_recovery_idempotency_conflict",
    });
  if (error.code === "cleanup_unconfirmed" && error.cleanupFailure)
    return new AgentOperationError("INVALID_REQUEST", {
      reason: "plan_recovery_cleanup_unconfirmed",
      cleanupFailure: error.cleanupFailure,
    });
  return rejected(
    RECOVERY_REASONS[error.code] ?? "plan_recovery_action_unavailable",
  );
}

function executionReason(error: AgentExecutionError): Reason {
  if (error.code === "credentialsInText") return "credentials_in_text";
  if (error.code === "modelUnavailable") return "model_unavailable";
  if (error.code === "reasoningUnsupported") return "reasoning_unsupported";
  return "parameter_reference_unavailable";
}
