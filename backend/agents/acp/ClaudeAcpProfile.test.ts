import { expect, it } from "vitest";

import {
  claudeAcpProfile,
  claudeModelMatches,
  decideClaudePermission,
} from "@/backend/agents/acp/ClaudeAcpProfile";

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";

const OPTIONS = [
  { optionId: "yes", name: "Yes", kind: "allow_once" },
  { optionId: "no", name: "No", kind: "reject_once" },
] as const;

function request(toolCall: unknown): RequestPermissionRequest {
  return {
    sessionId: "s1",
    toolCall,
    options: [...OPTIONS],
  } as unknown as RequestPermissionRequest;
}

function named(name: string, server?: string): RequestPermissionRequest {
  return request({
    toolCallId: "t1",
    _meta: {
      claudeCode: {
        toolName: name,
        ...(server === undefined ? {} : { mcpServer: { name: server } }),
      },
    },
  });
}

it("approves everything in yolo", () => {
  expect(decideClaudePermission("yolo", named("Bash"))).toEqual({
    outcome: { outcome: "selected", optionId: "yes" },
    isDenied: false,
  });
});

it("approves Pages MCP tools and reading tools in read-only", () => {
  for (const call of [
    named("mcp__pages__read"),
    named("mcp__pages__read", "pages"),
    named("Read"),
    named("WebFetch"),
  ])
    expect(decideClaudePermission("read_only", call).isDenied).toBe(false);
});

it("takes the tool name from the call when no extension names it", () => {
  expect(
    decideClaudePermission("read_only", request({ name: "Grep" })).isDenied,
  ).toBe(false);
});

it("refuses other tools, other servers and unreadable calls in read-only", () => {
  for (const call of [
    named("Bash"),
    named("mcp__pages__read", "other"),
    named("mcp__other__read"),
    request({ toolCallId: "t1" }),
    request(undefined),
    request({ _meta: { claudeCode: "text" } }),
    request({ _meta: { claudeCode: { toolName: 5 } } }),
    request([]),
  ])
    expect(decideClaudePermission("read_only", call)).toEqual({
      outcome: { outcome: "selected", optionId: "no" },
      isDenied: true,
    });
});

it("matches a reported model with or without a context hint", () => {
  expect(claudeModelMatches("sonnet", "claude-sonnet-4-5")).toBe(true);
  expect(claudeModelMatches("claude-opus-4-1[1m]", "Claude-Opus-4-1")).toBe(
    true,
  );
  expect(claudeModelMatches("claude-opus-4-1", "claude-sonnet-4-5")).toBe(
    false,
  );
});

const MODEL = { model: "sonnet", reasoningEffort: "high" };

it("derives mode, model and effort steps for a plan node", () => {
  const steps = claudeAcpProfile("read_only").steps(MODEL);
  expect(steps.map((step) => step.id)).toEqual(["mode", "model", "effort"]);
  expect(steps[0].value).toBe("default");
  expect(steps[2].isExplicit).toBe(false);
});

it("leaves out the effort step without an effort and marks it explicit in chat", () => {
  expect(
    claudeAcpProfile("yolo").steps({ model: "sonnet", reasoningEffort: null }),
  ).toHaveLength(2);
  expect(claudeAcpProfile("yolo").steps(MODEL)[0].value).toBe(
    "bypassPermissions",
  );
  expect(claudeAcpProfile("read_only", "chat").steps(MODEL)[2].isExplicit).toBe(
    true,
  );
});

it("selects the profile of the mode and purpose", () => {
  expect(claudeAcpProfile("read_only").sessionMode).toBe("default");
  expect(claudeAcpProfile("yolo").sessionMode).toBe("bypassPermissions");
  expect(claudeAcpProfile("yolo", "observer").keepsSession).toBe(false);
  expect(claudeAcpProfile("yolo", "observer").options.tools).toEqual([]);
  expect(claudeAcpProfile("read_only", "chat").options.tools).toEqual([
    "Bash",
    "Read",
  ]);
  expect(claudeAcpProfile("yolo", "chat").hasMcpStatusCommand).toBe(false);
});

it("lets the read-only, yolo and Pica profiles decide as documented", () => {
  expect(claudeAcpProfile("read_only").decide(named("Read")).isDenied).toBe(
    false,
  );
  expect(claudeAcpProfile("yolo").decide(named("Bash")).isDenied).toBe(false);
  expect(claudeAcpProfile("yolo", "chat").decide(named("Bash")).isDenied).toBe(
    false,
  );
  expect(
    claudeAcpProfile("read_only", "chat").decide(named("Read")).isDenied,
  ).toBe(true);
  expect(
    claudeAcpProfile("read_only", "observer").decide(named("Read")).isDenied,
  ).toBe(true);
});
