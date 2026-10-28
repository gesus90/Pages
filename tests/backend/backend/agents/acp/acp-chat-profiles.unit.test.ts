import { expect, it } from "vitest";

import { claudeAcpProfile } from "@/backend/agents/acp/ClaudeAcpProfile";
import { codexAcpProfile } from "@/backend/agents/acp/CodexAcpProfile";

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";

const OPTIONS: RequestPermissionRequest["options"] = [
  { optionId: "allow", name: "Allow", kind: "allow_once" },
  { optionId: "reject", name: "Reject", kind: "reject_once" },
];

function claudeRequest(
  toolName: string,
  server: string,
): RequestPermissionRequest {
  return {
    sessionId: "s-1",
    toolCall: {
      toolCallId: "t-1",
      _meta: { claudeCode: { toolName, mcpServer: { name: server } } },
    },
    options: OPTIONS,
  };
}

const APPROVED = {
  outcome: { outcome: "selected", optionId: "allow" },
  isDenied: false,
};

const REFUSED = {
  outcome: { outcome: "selected", optionId: "reject" },
  isDenied: true,
};

it("approves only calls of the Pica bridge in a Claude conversation", () => {
  const profile = claudeAcpProfile("yolo", "chat");

  expect(
    profile.decide(claudeRequest("mcp__pages__read_wiki", "pages")),
  ).toEqual(APPROVED);
  expect(profile.decide(claudeRequest("WebSearch", "pages"))).toEqual(REFUSED);
  expect(
    profile.decide(claudeRequest("mcp__pages__read_wiki", "other")),
  ).toEqual(REFUSED);
});

it("approves any request of a Claude YOLO node", () => {
  expect(
    claudeAcpProfile("yolo").decide(claudeRequest("Bash", "none")),
  ).toEqual(APPROVED);
});

it("confirms mode, adapter-resolved model and effort of a Claude conversation", () => {
  expect(
    claudeAcpProfile("read_only", "chat").steps({
      model: "claude-opus-5-5",
      reasoningEffort: "high",
    }),
  ).toEqual([
    {
      id: "mode",
      value: "default",
      refusal: "plan_permission_mode_unenforceable",
    },
    {
      id: "model",
      value: "claude-opus-5-5",
      refusal: "plan_model_unavailable",
      isResolvedByAdapter: true,
    },
    { id: "effort", value: "high", refusal: "plan_reasoning_unsupported" },
  ]);
});

it("confirms the read-only mode and stored model of a Codex conversation", () => {
  expect(
    codexAcpProfile("yolo", "chat").steps({
      model: "gpt-5",
      reasoningEffort: null,
    }),
  ).toEqual([
    {
      id: "mode",
      value: "read-only",
      refusal: "plan_permission_mode_unenforceable",
    },
    { id: "model", value: "gpt-5", refusal: "plan_model_unavailable" },
  ]);
});

it("approves only MCP tool calls in a Codex conversation", () => {
  const profile = codexAcpProfile("read_only", "chat");
  const request: RequestPermissionRequest = {
    sessionId: "s-1",
    toolCall: { toolCallId: "t-1" },
    options: OPTIONS,
  };

  expect(
    profile.decide({ ...request, _meta: { is_mcp_tool_approval: true } }),
  ).toEqual(APPROVED);
  expect(profile.decide(request)).toEqual(REFUSED);
});

it("confirms the default mode and approves only MCP and web calls of a Claude reading node", () => {
  const profile = claudeAcpProfile("read_only");

  expect(
    profile
      .steps({ model: "sonnet", reasoningEffort: null })
      .map((step) => step.value),
  ).toEqual(["default", "sonnet"]);
  expect(
    profile.decide(claudeRequest("mcp__pages__read_wiki", "pages")),
  ).toEqual(APPROVED);
  expect(profile.decide(claudeRequest("Edit", "none"))).toEqual(REFUSED);
});

it("confirms the session mode of each Codex plan profile", () => {
  expect(
    codexAcpProfile("read_only")
      .steps({ model: "gpt-5", reasoningEffort: "high" })
      .map((step) => step.value),
  ).toEqual(["read-only", "gpt-5", "high"]);
  expect(
    codexAcpProfile("yolo")
      .steps({ model: "gpt-5", reasoningEffort: null })
      .map((step) => step.value),
  ).toEqual(["agent-full-access", "gpt-5"]);
});

it("refuses commands of a Codex reading node and approves them in YOLO", () => {
  const request: RequestPermissionRequest = {
    sessionId: "s-1",
    toolCall: { toolCallId: "t-1" },
    options: OPTIONS,
  };

  expect(codexAcpProfile("read_only").decide(request)).toEqual(REFUSED);
  expect(codexAcpProfile("yolo").decide(request)).toEqual(APPROVED);
});
