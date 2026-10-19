import {
  AgentAccessDeniedError,
  AgentError,
  AgentInUseError,
} from "@/backend/error/AgentErrors";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentExecutionErrorCode } from "@/backend/error/AgentExecutionErrors";
import type {
  AgentCheckSummary,
  CliLoginView,
} from "@/definition/AgentConnection";
import type { AgentUsage } from "@/definition/AgentUsage";
import type { AgentWorkspaceUsage } from "@/definition/AgentWorkspace";

export type AgentActionResult =
  | {
      readonly ok: true;
      readonly intent: string;
      readonly connectionId?: string;
      readonly check?: AgentCheckSummary;
      readonly login?: CliLoginView;
      readonly usages?: readonly AgentUsage[];
      readonly workspaceUsages?: readonly AgentWorkspaceUsage[];
    }
  | {
      readonly ok: false;
      readonly intent: string;
      readonly error: AgentErrorCode | AgentExecutionErrorCode | "general";
      /** Current references of a blocked deletion, so the dialog can list them. */
      readonly usages?: readonly AgentUsage[];
    };

export const AGENT_NO_STORE = { "Cache-Control": "no-store" };

const ERROR_STATUS: Partial<Record<AgentErrorCode, number>> = {
  connection_not_found: 404,
  check_in_progress: 409,
  login_in_progress: 409,
  login_limit_reached: 409,
  login_not_running: 409,
  credential_cleanup_failed: 500,
  profile_in_use: 409,
  profile_conflict: 409,
  profile_running: 409,
  system_function_in_use: 409,
  agent_usage_denied: 403,
  workspace_access_denied: 403,
  workspace_management_denied: 403,
  workspace_project_unsupported: 409,
  workspace_path_denied: 403,
  workspace_not_found: 404,
  workspace_conflict: 409,
  workspace_in_use: 409,
  workspace_path_conflict: 409,
  plan_access_denied: 403,
  plan_conflict: 409,
  plan_running: 409,
  plan_run_unavailable: 409,
  plan_pause_required: 409,
  plan_continuation_deleted: 409,
  plan_completed_changed: 409,
  plan_workspace_conflict: 409,
  plan_context_changed: 409,
  template_name_taken: 409,
  template_not_found: 404,
};

/** Keeps every error response uncacheable and never echoes a native error or form secret. */
export function agentFailureResponse(error: unknown, intent = ""): Response {
  if (error instanceof AgentExecutionError)
    return Response.json(
      { ok: false, intent, error: error.code },
      {
        status: error.code === "accessDenied" ? 403 : 400,
        headers: AGENT_NO_STORE,
      },
    );
  if (error instanceof Response) {
    const headers = new Headers(error.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(error.body, { status: error.status, headers });
  }
  if (error instanceof AgentAccessDeniedError)
    return Response.json(
      { ok: false, intent, error: "accessDenied" },
      { status: 403, headers: AGENT_NO_STORE },
    );
  const code = error instanceof AgentError ? error.code : "general";
  const status =
    error instanceof AgentError ? (ERROR_STATUS[error.code] ?? 400) : 500;
  const references =
    error instanceof AgentInUseError ? { usages: error.usages } : {};
  return Response.json(
    {
      ok: false,
      intent,
      error: code,
      ...references,
      ...(error instanceof AgentPlanValidationError
        ? { issues: error.issues }
        : {}),
    },
    { status, headers: AGENT_NO_STORE },
  );
}
