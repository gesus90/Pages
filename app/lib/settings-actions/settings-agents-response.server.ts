import {
  AgentAccessDeniedError,
  AgentError,
  AgentInUseError,
} from "@/backend/error/AgentErrors";
import { AgentPlanValidationError } from "@/backend/error/AgentPlanValidationError";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { DatabaseExecutorError } from "@/backend/database/executor/DatabaseExecutorErrors";
import {
  databaseFailureCode,
  databaseFailureHeaders,
} from "@/app/lib/database-failure.server";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentExecutionErrorCode } from "@/backend/error/AgentExecutionErrors";
import type { DatabaseFailureCode } from "@/app/lib/database-failure.server";
import type {
  AgentCheckSummary,
  CliLoginView,
} from "@/definition/AgentConnection";
import type { AgentUsage } from "@/definition/AgentUsage";
import type { AgentWorkspaceUsage } from "@/definition/AgentWorkspace";
import type { SpeechTestOutcome } from "@/definition/SpeechRecognition";

export type AgentActionResult =
  | {
      readonly ok: true;
      readonly intent: string;
      readonly connectionId?: string;
      readonly check?: AgentCheckSummary;
      readonly login?: CliLoginView;
      readonly usages?: readonly AgentUsage[];
      readonly workspaceUsages?: readonly AgentWorkspaceUsage[];
      /** What a test recording of the speech recognition gave (PAGE-273). */
      readonly speech?: SpeechTestOutcome;
    }
  | {
      readonly ok: false;
      readonly intent: string;
      readonly error:
        | AgentErrorCode
        | AgentExecutionErrorCode
        | DatabaseFailureCode
        | "general";
      /** Current references of a blocked deletion, so the dialog can list them. */
      readonly usages?: readonly AgentUsage[];
    };

export const AGENT_NO_STORE = { "Cache-Control": "no-store" };

const ERROR_STATUS: Partial<Record<AgentErrorCode, number>> = {
  plan_payload_missing: 500,
  plan_payload_corrupt: 500,
  profile_management_retired: 410,
  connection_not_found: 404,
  check_in_progress: 409,
  login_in_progress: 409,
  login_limit_reached: 409,
  login_not_running: 409,
  login_callback_unreachable: 409,
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
  plan_asset_missing: 404,
  plan_asset_too_large: 413,
  plan_asset_unreadable: 422,
  workspace_conflict: 409,
  workspace_in_use: 409,
  workspace_running: 409,
  workspace_path_conflict: 409,
  plan_access_denied: 403,
  plan_conflict: 409,
  plan_name_taken: 409,
  plan_project_owner_only: 403,
  plan_running: 409,
  plan_run_unavailable: 409,
  plan_pause_required: 409,
  plan_continuation_deleted: 409,
  plan_completed_changed: 409,
  plan_workspace_conflict: 409,
  plan_context_changed: 409,
  template_name_taken: 409,
  template_not_found: 404,
  template_owner_only: 403,
};

/**
 * Answers a database job the executor refused or could not confirm (PAGE-197).
 *
 * @param error - The error of the executor.
 * @param intent - The submitted intent, echoed for the client.
 * @returns `503` with `Retry-After` and a stable `database_*` code.
 */
function databaseFailureResponse(
  error: DatabaseExecutorError,
  intent: string,
): Response {
  return Response.json(
    { ok: false, intent, error: databaseFailureCode(error) },
    { status: 503, headers: databaseFailureHeaders(error) },
  );
}

/** Keeps every error response uncacheable and never echoes a native error or form secret. */
export function agentFailureResponse(error: unknown, intent = ""): Response {
  if (error instanceof DatabaseExecutorError)
    return databaseFailureResponse(error, intent);
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
