import { RequestError } from "@agentclientprotocol/sdk";

import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";

/** Classifies native provider diagnostics without retaining their potentially sensitive contents. */
export function classifyOpenCodeFailure(text: string): AgentErrorCode {
  // Zen answers 403 with this type when its free tier is called from outside its own apps.
  if (/FreeTierError|free tier can only be used/iu.test(text))
    return "opencode_free_tier_refused";
  if (
    /\b401\b|invalid[ _-]?(?:api[ _-]?)?key|unauthori[sz]ed|authentication[ _-]?(?:error|required)|ProviderAuthError/iu.test(
      text,
    )
  )
    return "provider_auth_failed";
  if (
    /\b402\b|insufficient[ _-]?(?:credits?|funds?|balance|quota)|(?:balance|credits?|quota)[^\n]{0,50}(?:exhausted|depleted|exceeded|zero)|payment required|usage limit/iu.test(
      text,
    )
  )
    return "provider_quota_exhausted";
  if (/\b429\b|rate[ _-]?limit/iu.test(text)) return "provider_rate_limited";
  if (
    /ProviderModelNotFoundError|ModelNotFoundError|model[^\n]{0,80}(?:not found|not available|unavailable|not supported)|\b404\b/iu.test(
      text,
    )
  )
    return "provider_model_not_found";
  if (
    /DeniedError|PermissionRejectedError|PermissionCorrectedError|rejected permission|specified a rule which prevents|permission[^\n]{0,60}(?:denied|rejected)|not allowed to use/iu.test(
      text,
    )
  )
    return "plan_runner_permission_denied";
  if (/\b403\b|forbidden/iu.test(text)) return "provider_permission_denied";
  if (/\b50[0234]\b|service unavailable|provider unavailable/iu.test(text))
    return "provider_unavailable";
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|network error/iu.test(text))
    return "provider_unreachable";
  return "opencode_acp_session_failed";
}

/** Converts an ACP error into a stable Pages code; upstream messages never enter the run event log. */
export function openCodeAcpFailure(error: unknown): AgentErrorCode {
  if (error instanceof RequestError && error.code === -32000)
    return "provider_auth_failed";
  return classifyOpenCodeFailure(error instanceof Error ? error.message : "");
}

/** Recognizes native denials and provider failures that arrive inside a failed tool notification. */
export function openCodeToolFailure(
  update: SessionUpdate,
): AgentErrorCode | null {
  if (
    (update.sessionUpdate !== "tool_call" &&
      update.sessionUpdate !== "tool_call_update") ||
    update.status !== "failed"
  )
    return null;
  const text = JSON.stringify({
    output: update.rawOutput,
    content: update.content,
  });
  // A call to a tool name that does not exist goes back to the model; it says nothing about the provider or model.
  if (/NoSuchToolError|tried to call unavailable tool/iu.test(text))
    return null;
  if (
    /\bFORBIDDEN\b|operation[^\n]{0,50}(?:not permitted|not allowed)/iu.test(
      text,
    )
  )
    return "plan_runner_permission_denied";
  const failure = classifyOpenCodeFailure(text);
  return failure === "opencode_acp_session_failed" ? null : failure;
}
