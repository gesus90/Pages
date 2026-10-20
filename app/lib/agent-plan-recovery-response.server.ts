import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";

import {
  agentFailureResponse,
  AGENT_NO_STORE,
} from "./settings-actions/settings-agents-response.server";

import type { AgentPlanRecoveryErrorCode } from "@/definition/AgentPlanRecovery";

const RECOVERY_STATUS: Readonly<Record<AgentPlanRecoveryErrorCode, number>> = {
  invalid_request: 400,
  access_denied: 403,
  revision_conflict: 409,
  idempotency_conflict: 409,
  action_unavailable: 409,
  workflow_unavailable: 409,
  checkpoint_invalid: 500,
  checkpoint_too_large: 413,
  review_required: 409,
  cleanup_unconfirmed: 409,
  native_resume_unavailable: 409,
};

/** Returns fixed, uncacheable recovery failures with no private snapshot or native error text. */
export function planRecoveryFailure(error: unknown): Response {
  if (error instanceof AgentPlanRecoveryError)
    return Response.json(
      { ok: false, error: error.code },
      { status: RECOVERY_STATUS[error.code], headers: AGENT_NO_STORE },
    );
  if (error instanceof AgentOperationError)
    return Response.json(
      { ok: false, error: "invalid_request" },
      {
        status: error.code === "PAYLOAD_TOO_LARGE" ? 413 : 400,
        headers: AGENT_NO_STORE,
      },
    );
  return agentFailureResponse(error, "plan-recovery");
}
