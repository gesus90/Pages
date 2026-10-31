import type { AgentPlanSessionRetryCode } from "@/definition/AgentPlanRetry";

const SESSION_FAILURE_CODES: ReadonlySet<string> = new Set([
  "plan_acp_session_failed",
  "plan_claude_acp_session_failed",
  "opencode_acp_session_failed",
  "antigravity_acp_session_failed",
  "acp_session_resume_failed",
]);

/** Narrows only technical ACP session failures; permanent causes keep their own codes. */
export function isPlanSessionRetryCode(
  code: unknown,
): code is AgentPlanSessionRetryCode {
  return typeof code === "string" && SESSION_FAILURE_CODES.has(code);
}
