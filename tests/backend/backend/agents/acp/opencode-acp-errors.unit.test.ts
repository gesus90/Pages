import { RequestError } from "@agentclientprotocol/sdk";
import { expect, it } from "vitest";

import {
  classifyOpenCodeFailure,
  openCodeAcpFailure,
  openCodeToolFailure,
} from "@/backend/agents/acp/OpenCodeAcpErrors";

import type { SessionUpdate } from "@agentclientprotocol/sdk";

it.each([
  ["FreeTierError: free tier can only be used", "opencode_free_tier_refused"],
  ["HTTP 401", "provider_auth_failed"],
  ["Invalid API key", "provider_auth_failed"],
  ["ProviderAuthError", "provider_auth_failed"],
  ["402 Payment Required", "provider_quota_exhausted"],
  ["insufficient balance", "provider_quota_exhausted"],
  ["monthly quota exhausted", "provider_quota_exhausted"],
  ["429 Too Many Requests", "provider_rate_limited"],
  ["rate limit reached", "provider_rate_limited"],
  ["ProviderModelNotFoundError", "provider_model_not_found"],
  ["model glm-9 is not available", "provider_model_not_found"],
  ["HTTP 404", "provider_model_not_found"],
  ["PermissionRejectedError", "plan_runner_permission_denied"],
  ["permission for bash was denied", "plan_runner_permission_denied"],
  ["403 Forbidden", "provider_permission_denied"],
  ["HTTP 503", "provider_unavailable"],
  ["service unavailable", "provider_unavailable"],
  ["fetch failed: ECONNREFUSED", "provider_unreachable"],
  ["something else", "opencode_acp_session_failed"],
])("classifies %s", (text, code) => {
  expect(classifyOpenCodeFailure(text)).toBe(code);
});

it("reads an authentication request of the agent as a failed sign-in", () => {
  expect(openCodeAcpFailure(RequestError.authRequired())).toBe(
    "provider_auth_failed",
  );
});

it("classifies other ACP errors by their message", () => {
  expect(openCodeAcpFailure(new Error("429 rate limit"))).toBe(
    "provider_rate_limited",
  );
  expect(openCodeAcpFailure(RequestError.internalError())).toBe(
    "opencode_acp_session_failed",
  );
  expect(openCodeAcpFailure("not an error")).toBe(
    "opencode_acp_session_failed",
  );
});

function failedTool(rawOutput: unknown): SessionUpdate {
  return {
    sessionUpdate: "tool_call_update",
    toolCallId: "t-1",
    status: "failed",
    rawOutput,
  };
}

it("ignores tool updates that did not fail", () => {
  expect(
    openCodeToolFailure({
      sessionUpdate: "tool_call",
      toolCallId: "t-1",
      title: "bash",
      status: "completed",
    }),
  ).toBeNull();
  expect(
    openCodeToolFailure({
      sessionUpdate: "current_mode_update",
      currentModeId: "x",
    }),
  ).toBeNull();
});

it("leaves calls of unknown tools to the model", () => {
  expect(openCodeToolFailure(failedTool("NoSuchToolError: 401"))).toBeNull();
});

it("reports a native refusal of an operation", () => {
  expect(openCodeToolFailure(failedTool({ error: "FORBIDDEN" }))).toBe(
    "plan_runner_permission_denied",
  );
  expect(
    openCodeToolFailure({
      sessionUpdate: "tool_call",
      toolCallId: "t-1",
      title: "edit",
      status: "failed",
      content: [
        {
          type: "content",
          content: { type: "text", text: "operation is not permitted" },
        },
      ],
    }),
  ).toBe("plan_runner_permission_denied");
});

it("reports provider failures inside a failed tool", () => {
  expect(openCodeToolFailure(failedTool("HTTP 429"))).toBe(
    "provider_rate_limited",
  );
});

it("ignores an ordinary tool failure", () => {
  expect(openCodeToolFailure(failedTool("file not found"))).toBeNull();
});
