import { expect, it } from "vitest";

import {
  codexAcpProfile,
  decideCodexPermission,
} from "@/backend/agents/acp/CodexAcpProfile";

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";

function request(meta?: Record<string, unknown>): RequestPermissionRequest {
  return {
    sessionId: "s",
    toolCall: { toolCallId: "t" },
    options: [
      { optionId: "yes", name: "Yes", kind: "allow_once" },
      { optionId: "no", name: "No", kind: "reject_once" },
    ],
    ...(meta ? { _meta: meta } : {}),
  } as unknown as RequestPermissionRequest;
}

it("approves every request in YOLO", () => {
  expect(decideCodexPermission("yolo", request()).isDenied).toBe(false);
});

it("approves only MCP tool calls in read-only mode", () => {
  expect(
    decideCodexPermission("read_only", request({ is_mcp_tool_approval: true }))
      .isDenied,
  ).toBe(false);
  expect(decideCodexPermission("read_only", request()).isDenied).toBe(true);
  expect(
    decideCodexPermission("read_only", request({ is_mcp_tool_approval: false }))
      .isDenied,
  ).toBe(true);
});

it("selects the plan profiles by mode", () => {
  expect(codexAcpProfile("read_only").sessionMode).toBe("read-only");
  expect(codexAcpProfile("yolo", "plan").sessionMode).toBe("agent-full-access");
  expect(codexAcpProfile("yolo").decide(request()).isDenied).toBe(false);
  expect(codexAcpProfile("read_only").decide(request()).isDenied).toBe(true);
});

it("takes the chat profiles for conversations", () => {
  expect(codexAcpProfile("read_only", "chat").configuration.web_search).toBe(
    "disabled",
  );
  expect(codexAcpProfile("read_only", "chat").decide(request()).isDenied).toBe(
    true,
  );
  expect(codexAcpProfile("yolo", "chat").permissions.pagesTools).toContain(
    "Pica bridge",
  );
});

it("refuses every request of the observer", () => {
  const profile = codexAcpProfile("yolo", "observer");
  expect(profile.permissions.pagesMcp).toBe("none");
  expect(profile.decide(request({ is_mcp_tool_approval: true })).isDenied).toBe(
    true,
  );
});

it("derives the steps with and without an effort", () => {
  const profile = codexAcpProfile("read_only");
  expect(
    profile
      .steps({ model: "m", reasoningEffort: "high" })
      .map((step) => step.id),
  ).toEqual(["mode", "model", "reasoning_effort"]);
  expect(profile.steps({ model: "m", reasoningEffort: null })).toHaveLength(2);
});

it("derives the steps of every profile", () => {
  const model = { model: "m", reasoningEffort: null };
  for (const purpose of ["plan", "chat", "observer"] as const)
    for (const mode of ["read_only", "yolo"] as const)
      expect(codexAcpProfile(mode, purpose).steps(model)[0]?.id).toBe("mode");
});
