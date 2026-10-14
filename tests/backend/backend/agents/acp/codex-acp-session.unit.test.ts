import { beforeEach, expect, it, vi } from "vitest";

import {
  INSTANCE_ID,
  PROMPT,
  WORKSPACE,
  methodsOf,
  startCodexSession,
} from "./codex-acp-harness";
import { FAKE_SESSION_ID } from "./fake-codex-adapter";

import type { ReceivedCall } from "./fake-codex-adapter";

const scan = vi.hoisted(() => ({
  endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  RUN_INSTANCE_VARIABLE: "PAGES_RUN_INSTANCE",
  endTaggedProcesses: scan.endTaggedProcesses,
}));

beforeEach(() => {
  scan.endTaggedProcesses.mockImplementation(async () => ({
    found: 0,
    remaining: 0,
  }));
});

function paramsOf(calls: readonly ReceivedCall[], method: string): unknown[] {
  return calls
    .filter((call) => call.method === method)
    .map((call) => call.params);
}

it("starts the ACP session in the workspace, takes the stored mode, model and effort exactly and sends the complete prompt", async () => {
  const started = startCodexSession({
    turn: async (turn) => {
      await turn.update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Looking at the workspace." },
      });
      await turn.update({
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        title: "Read README.md",
        kind: "read",
        status: "in_progress",
      });
      await turn.update({
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        status: "completed",
      });
      await turn.update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Final " },
      });
      await turn.update({
        sessionUpdate: "usage_update",
        used: 10,
        size: 100,
      });
      await turn.update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "report" },
      });
      return "end_turn";
    },
  });
  const turn = await started.session.turn;
  expect(turn).toMatchObject({
    failure: null,
    errorCode: null,
    output: "Final report",
    sessionId: FAKE_SESSION_ID,
    permissionDenials: 0,
  });
  expect(methodsOf(started.calls)).toEqual([
    "initialize",
    "session/new",
    "session/set_config_option",
    "session/set_config_option",
    "session/set_config_option",
    "session/prompt",
  ]);
  expect(paramsOf(started.calls, "session/new")[0]).toMatchObject({
    cwd: WORKSPACE,
    mcpServers: [
      {
        name: "pages",
        command: "/synthetic/bin/node",
        args: ["/synthetic/pages-mcp.cjs"],
        env: [
          { name: "PAGES_URL", value: "http://pages.invalid" },
          { name: "PAGES_TOKEN", value: "synthetic-run-token" },
          { name: "PAGES_RUN_INSTANCE", value: INSTANCE_ID },
        ],
      },
    ],
    _meta: { mcpStartupAwaitTimeoutMs: 30_000 },
  });
  expect(paramsOf(started.calls, "session/set_config_option")).toEqual([
    { sessionId: FAKE_SESSION_ID, configId: "mode", value: "read-only" },
    { sessionId: FAKE_SESSION_ID, configId: "model", value: "gpt-synthetic" },
    {
      sessionId: FAKE_SESSION_ID,
      configId: "reasoning_effort",
      value: "high",
    },
  ]);
  expect(paramsOf(started.calls, "session/prompt")).toEqual([
    { sessionId: FAKE_SESSION_ID, prompt: [{ type: "text", text: PROMPT }] },
  ]);
  expect(turn.effective).toMatchObject({
    adapter: "@agentclientprotocol/codex-acp 2.2.2",
    protocol: "ACP 1",
    sessionMode: "read-only",
    model: "gpt-synthetic",
    reasoningEffort: "high",
    permissionMode: "read_only",
    shell: "off",
    pagesMcp: "read",
    isolation: "bubblewrap",
  });
  expect(turn.events).toContain("tool read Read README.md");
  expect(turn.events).toContain("tool Read README.md completed");
  expect(started.observer.identified).toHaveBeenCalledWith(FAKE_SESSION_ID);
});

it("keeps a mode the adapter already started in and leaves the effort to the model when the agent stores none", async () => {
  const started = startCodexSession(
    { initialMode: "read-only" },
    { reasoningEffort: null },
  );
  const turn = await started.session.turn;
  expect(turn.errorCode).toBeNull();
  expect(paramsOf(started.calls, "session/set_config_option")).toEqual([
    { sessionId: FAKE_SESSION_ID, configId: "model", value: "gpt-synthetic" },
  ]);
  expect(turn.effective).toMatchObject({
    sessionMode: "read-only",
    reasoningEffort: "medium",
  });
});

it.each([
  [
    "a model outside the catalog",
    {},
    { model: "openai/gpt-6-luna" },
    "plan_model_unavailable",
  ],
  [
    "an effort the model does not list",
    {},
    { reasoningEffort: "xhigh" },
    "plan_reasoning_unsupported",
  ],
  [
    "a model the adapter does not confirm",
    { unconfirmed: ["model"] },
    {},
    "plan_model_unavailable",
  ],
  [
    "an effort the adapter refuses",
    { refused: ["reasoning_effort"] },
    {},
    "plan_reasoning_unsupported",
  ],
  [
    "a mode the adapter refuses",
    { refused: ["mode"] },
    { mode: "yolo" as const },
    "plan_permission_mode_unenforceable",
  ],
  [
    "an adapter without a mode option",
    { missing: ["mode"] },
    {},
    "plan_acp_adapter_unsupported",
  ],
])(
  "fails before the prompt for %s instead of running with another value",
  async (scenario, adapter, node, code) => {
    const started = startCodexSession(adapter, node);
    const turn = await started.session.turn;
    expect(turn).toMatchObject({ failure: "failed", errorCode: code });
    expect(methodsOf(started.calls)).not.toContain("session/prompt");
    const closed = await started.session.close();
    expect(closed.isConfirmed).toBe(true);
  },
);

it.each([
  ["another agent", { agentInfo: { name: "other-agent", version: "2.2.2" } }],
  [
    "a version before 2.1.1",
    { agentInfo: { name: "@agentclientprotocol/codex-acp", version: "2.1.0" } },
  ],
  [
    "the next major version",
    { agentInfo: { name: "@agentclientprotocol/codex-acp", version: "3.0.0" } },
  ],
  [
    "a preview",
    {
      agentInfo: {
        name: "@agentclientprotocol/codex-acp",
        version: "2.2.3-preview.7",
      },
    },
  ],
  ["no agent information", { agentInfo: null }],
  ["another protocol version", { protocolVersion: 2 }],
])("refuses %s before a session opens", async (scenario, adapter) => {
  const started = startCodexSession(adapter);
  const turn = await started.session.turn;
  expect(turn.errorCode).toBe("plan_acp_adapter_unsupported");
  expect(methodsOf(started.calls)).toEqual(["initialize"]);
});

it("Nur Lesen refuses commands and file changes and leaves Pages MCP tool calls to the read-only server", async () => {
  const answers: unknown[] = [];
  const started = startCodexSession({
    initialMode: "read-only",
    turn: async (turn) => {
      for (const [kind, meta] of [
        ["execute", undefined],
        ["edit", undefined],
        ["execute", { is_mcp_tool_approval: true }],
      ] as const)
        answers.push(
          (
            await turn.ask({
              toolCall: {
                toolCallId: `call-${kind}`,
                title: `${kind} call`,
                kind,
              },
              options: [
                { optionId: "allow", name: "Allow", kind: "allow_once" },
                { optionId: "always", name: "Always", kind: "allow_always" },
                { optionId: "reject", name: "Reject", kind: "reject_once" },
              ],
              ...(meta === undefined ? {} : { _meta: meta }),
            })
          ).outcome,
        );
      return "end_turn";
    },
  });
  const turn = await started.session.turn;
  expect(answers).toEqual([
    { outcome: "selected", optionId: "reject" },
    { outcome: "selected", optionId: "reject" },
    { outcome: "selected", optionId: "allow" },
  ]);
  expect(turn.permissionDenials).toBe(2);
  expect(turn.events).toContain("refused execute call");
});

it("YOLO switches the adapter to full access and approves every request once without anybody being asked", async () => {
  const answers: unknown[] = [];
  const started = startCodexSession(
    {
      turn: async (turn) => {
        answers.push(
          (
            await turn.ask({
              toolCall: {
                toolCallId: "call",
                title: "rm build",
                kind: "delete",
              },
              options: [
                { optionId: "always", name: "Always", kind: "allow_always" },
                { optionId: "once", name: "Once", kind: "allow_once" },
                { optionId: "reject", name: "Reject", kind: "reject_once" },
              ],
            })
          ).outcome,
        );
        return "end_turn";
      },
    },
    { mode: "yolo" },
  );
  const turn = await started.session.turn;
  expect(answers).toEqual([{ outcome: "selected", optionId: "once" }]);
  expect(turn.permissionDenials).toBe(0);
  expect(paramsOf(started.calls, "session/set_config_option")[0]).toEqual({
    sessionId: FAKE_SESSION_ID,
    configId: "mode",
    value: "agent-full-access",
  });
  expect(turn.effective).toMatchObject({
    sessionMode: "agent-full-access",
    permissionMode: "yolo",
    shell: "on",
    pagesMcp: "every tool of the executor",
  });
});
