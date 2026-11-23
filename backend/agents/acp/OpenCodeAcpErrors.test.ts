import { RequestError } from "@agentclientprotocol/sdk";
import { expect, it } from "vitest";

import {
  classifyOpenCodeFailure,
  openCodeAcpFailure,
  openCodeToolFailure,
  openCodeUnavailableTool,
} from "@/backend/agents/acp/OpenCodeAcpErrors";

import type { SessionUpdate } from "@agentclientprotocol/sdk";

function failedTool(
  rawOutput: unknown,
  kind: "tool_call" | "tool_call_update" = "tool_call_update",
): SessionUpdate {
  if (kind === "tool_call")
    return {
      sessionUpdate: "tool_call",
      toolCallId: "t",
      title: "tool",
      status: "failed",
      rawOutput,
    };
  return {
    sessionUpdate: "tool_call_update",
    toolCallId: "t",
    status: "failed",
    rawOutput,
  };
}

const MESSAGE: SessionUpdate = {
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text: "x" },
};

const PLAN: SessionUpdate = { sessionUpdate: "plan", entries: [] };

function toolWithStatus(status: "pending" | "completed"): SessionUpdate {
  return {
    sessionUpdate: "tool_call",
    toolCallId: "t",
    title: "tool",
    status,
  };
}

it.each([
  ["FreeTierError", false, "opencode_free_tier_refused"],
  ["HTTP 401", false, "provider_auth_failed"],
  ["HTTP 401", true, "openrouter_auth_failed"],
  ["insufficient credits", false, "provider_quota_exhausted"],
  ["HTTP 429", false, "provider_rate_limited"],
  ["rate limit", true, "openrouter_rate_limited"],
  ["model gpt not found", false, "provider_model_not_found"],
  ["DeniedError", false, "plan_runner_permission_denied"],
  ["HTTP 403", false, "provider_permission_denied"],
  ["HTTP 403", true, "openrouter_auth_failed"],
  ["HTTP 503", false, "provider_unavailable"],
  ["fetch failed", false, "provider_unreachable"],
  ["something else", false, "opencode_acp_session_failed"],
] as const)("classifies %s (openrouter %s)", (text, router, code) => {
  expect(classifyOpenCodeFailure(text, router)).toBe(code);
});

it("classifies without the openrouter flag by default", () => {
  expect(classifyOpenCodeFailure("401")).toBe("provider_auth_failed");
});

it("maps the ACP authentication error to an authentication failure", () => {
  const error = new RequestError(-32000, "auth");
  expect(openCodeAcpFailure(error)).toBe("provider_auth_failed");
  expect(openCodeAcpFailure(error, true)).toBe("openrouter_auth_failed");
});

it("classifies the message of other errors and ignores non-errors", () => {
  expect(openCodeAcpFailure(new Error("429"))).toBe("provider_rate_limited");
  expect(openCodeAcpFailure("429")).toBe("opencode_acp_session_failed");
});

it("names the tools offered when a tool does not exist", () => {
  const update = failedTool(
    'Model tried to call unavailable tool "x". Available tools: a, b.',
  );
  expect(openCodeUnavailableTool(update)).toBe(
    "tool call failed: no such tool; offered a, b",
  );
  expect(
    openCodeUnavailableTool(
      failedTool("tried to call unavailable tool", "tool_call"),
    ),
  ).toBe("tool call failed: no such tool; no tools offered");
});

it("ignores updates that are no missing-tool failure", () => {
  expect(openCodeUnavailableTool(MESSAGE)).toBeNull();
  expect(openCodeUnavailableTool(toolWithStatus("completed"))).toBeNull();
  expect(openCodeUnavailableTool(failedTool("boom"))).toBeNull();
});

it("recognizes failures inside a failed tool", () => {
  expect(openCodeToolFailure(failedTool("429"))).toBe("provider_rate_limited");
  expect(openCodeToolFailure(failedTool("FORBIDDEN"))).toBe(
    "plan_runner_permission_denied",
  );
  expect(openCodeToolFailure(failedTool("403"), true)).toBe(
    "openrouter_auth_failed",
  );
});

it("leaves unknown or non-provider tool failures alone", () => {
  expect(openCodeToolFailure(failedTool("boom"))).toBeNull();
  expect(openCodeToolFailure(failedTool("NoSuchToolError 429"))).toBeNull();
  expect(openCodeToolFailure(PLAN)).toBeNull();
  expect(openCodeToolFailure(toolWithStatus("pending"))).toBeNull();
});
