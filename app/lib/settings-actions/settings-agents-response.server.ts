import {
  AgentAccessDeniedError,
  AgentError,
} from "@/backend/error/AgentErrors";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import type { TextAssistantErrorCode } from "@/backend/error/TextAssistantErrors";
import type {
  AgentCheckSummary,
  CliLoginView,
} from "@/definition/AgentConnection";

export type AgentActionResult =
  | {
      readonly ok: true;
      readonly intent: string;
      readonly connectionId?: string;
      readonly check?: AgentCheckSummary;
      readonly login?: CliLoginView;
    }
  | {
      readonly ok: false;
      readonly intent: string;
      readonly error: AgentErrorCode | TextAssistantErrorCode | "general";
    };

export const AGENT_NO_STORE = { "Cache-Control": "no-store" };

const ERROR_STATUS: Partial<Record<AgentErrorCode, number>> = {
  connection_not_found: 404,
  check_in_progress: 409,
  login_in_progress: 409,
  login_limit_reached: 409,
  login_not_running: 409,
  credential_cleanup_failed: 500,
};

/** Keeps every error response uncacheable and never echoes a native error or form secret. */
export function agentFailureResponse(error: unknown, intent = ""): Response {
  if (error instanceof TextAssistantError)
    return Response.json(
      { ok: false, intent, error: error.code },
      { status: 400, headers: AGENT_NO_STORE },
    );
  if (error instanceof Response) {
    const headers = new Headers(error.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(error.body, { status: error.status, headers });
  }
  if (error instanceof AgentAccessDeniedError)
    return new Response("Forbidden", { status: 403, headers: AGENT_NO_STORE });
  const code = error instanceof AgentError ? error.code : "general";
  const status =
    error instanceof AgentError ? (ERROR_STATUS[error.code] ?? 400) : 500;
  return Response.json(
    { ok: false, intent, error: code },
    { status, headers: AGENT_NO_STORE },
  );
}
