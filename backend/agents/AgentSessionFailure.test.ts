import { describe, expect, it } from "vitest";

import { isPlanSessionRetryCode } from "@/backend/agents/AgentSessionFailure";

describe("isPlanSessionRetryCode", () => {
  it.each([
    "plan_acp_session_failed",
    "plan_claude_acp_session_failed",
    "opencode_acp_session_failed",
    "antigravity_acp_session_failed",
    "plan_runner_session_failed",
    "acp_session_resume_failed",
  ])("accepts the technical session failure %s", (code) => {
    expect(isPlanSessionRetryCode(code)).toBe(true);
  });

  it("rejects permanent causes and values that are not text", () => {
    expect(isPlanSessionRetryCode("plan_invalid")).toBe(false);
    expect(isPlanSessionRetryCode(42)).toBe(false);
    expect(isPlanSessionRetryCode(undefined)).toBe(false);
  });
});
