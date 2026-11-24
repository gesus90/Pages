import { RequestError } from "@agentclientprotocol/sdk";

import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";

/** Classifies native provider diagnostics without retaining their potentially sensitive contents. */
export function classifyOpenCodeFailure(
  text: string,
  isOpenRouter = false,
): AgentErrorCode {
  // Zen answers 403 with this type when its free tier is called from outside its own apps.
  if (/FreeTierError|free tier can only be used/iu.test(text))
    return "opencode_free_tier_refused";
  if (
    /\b401\b|invalid[ _-]?(?:api[ _-]?)?key|unauthori[sz]ed|authentication[ _-]?(?:error|required)|token[ _-]?(?:expired|incorrect)|ProviderAuthError/iu.test(
      text,
    )
  )
    return isOpenRouter ? "openrouter_auth_failed" : "provider_auth_failed";
  if (
    /\b402\b|insufficient[ _-]?(?:credits?|funds?|balance|quota)|(?:balance|credits?|quota)[^\n]{0,50}(?:exhausted|depleted|exceeded|zero)|payment required|usage limit|limit[ _-]?exhausted|no resource package/iu.test(
      text,
    )
  )
    return "provider_quota_exhausted";
  if (/\b429\b|rate[ _-]?limit/iu.test(text))
    return isOpenRouter ? "openrouter_rate_limited" : "provider_rate_limited";
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
  if (/\b403\b|forbidden/iu.test(text))
    return isOpenRouter
      ? "openrouter_auth_failed"
      : "provider_permission_denied";
  if (/\b5\d\d\b|service unavailable|provider unavailable/iu.test(text))
    return "provider_unavailable";
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|network error/iu.test(text))
    return "provider_unreachable";
  return "opencode_acp_session_failed";
}

/** Converts an ACP error into a stable Pages code; upstream messages never enter the run event log. */
export function openCodeAcpFailure(
  error: unknown,
  isOpenRouter = false,
): AgentErrorCode {
  if (error instanceof RequestError && error.code === -32000)
    return isOpenRouter ? "openrouter_auth_failed" : "provider_auth_failed";
  return classifyOpenCodeFailure(
    error instanceof Error ? error.message : "",
    isOpenRouter,
  );
}

function failedToolText(
  update: Extract<
    SessionUpdate,
    { sessionUpdate: "tool_call" | "tool_call_update" }
  >,
): string {
  return JSON.stringify({ output: update.rawOutput, content: update.content });
}

/**
 * Names what a model called when OpenCode answers that the tool does not exist.
 * @remarks
 * OpenCode lists the tools it offered in that answer. Pages records the list in
 * the events of the session, so a call to a tool under a name the runner does
 * not offer, such as `swarm_assign` instead of `pages_swarm_assign`, is
 * recognizable in the run instead of ending silently as one more failed tool.
 * @param update - An update of the ACP session.
 * @returns A short line with the offered tools, or `null` for any other update.
 */
export function openCodeUnavailableTool(update: SessionUpdate): string | null {
  if (
    (update.sessionUpdate !== "tool_call" &&
      update.sessionUpdate !== "tool_call_update") ||
    update.status !== "failed"
  )
    return null;
  const text = failedToolText(update);
  if (!/tried to call unavailable tool/iu.test(text)) return null;
  const offered = /Available tools: ([^"\\]*?)\.?(?:["\\]|$)/u.exec(text)?.[1];
  return offered === undefined
    ? "tool call failed: no such tool; no tools offered"
    : `tool call failed: no such tool; offered ${offered}`;
}

/** Recognizes native denials and provider failures that arrive inside a failed tool notification. */
export function openCodeToolFailure(
  update: SessionUpdate,
  isOpenRouter = false,
): AgentErrorCode | null {
  if (
    (update.sessionUpdate !== "tool_call" &&
      update.sessionUpdate !== "tool_call_update") ||
    update.status !== "failed"
  )
    return null;
  const text = failedToolText(update);
  // A call to a tool name that does not exist goes back to the model; it says nothing about the provider or model.
  if (/NoSuchToolError|tried to call unavailable tool/iu.test(text))
    return null;
  if (isOpenRouter && /\b403\b/u.test(text)) return "openrouter_auth_failed";
  if (
    /\bFORBIDDEN\b|operation[^\n]{0,50}(?:not permitted|not allowed)/iu.test(
      text,
    )
  )
    return "plan_runner_permission_denied";
  const failure = classifyOpenCodeFailure(text, isOpenRouter);
  return failure === "opencode_acp_session_failed" ? null : failure;
}
