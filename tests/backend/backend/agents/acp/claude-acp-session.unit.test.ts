import { beforeEach, expect, it, vi } from "vitest";

import { PROMPT, WORKSPACE, methodsOf, startAcpSession } from "./acp-harness";
import { FAKE_SESSION_ID } from "./fake-acp-adapter";

import type { FakeAdapterOptions, ReceivedCall } from "./fake-acp-adapter";
import type { SyntheticNode } from "./acp-harness";

vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  RUN_INSTANCE_VARIABLE: "PAGES_RUN_INSTANCE",
  readServerScope: async () => ({ earliestStart: 0 }),
  endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
}));

beforeEach(() => {
  vi.useRealTimers();
});

function startClaude(
  adapter: FakeAdapterOptions = {},
  node: SyntheticNode = {},
): ReturnType<typeof startAcpSession> {
  return startAcpSession(adapter, { ...node, provider: "claude_code" });
}

function paramsOf(calls: readonly ReceivedCall[], method: string): unknown[] {
  return calls
    .filter((call) => call.method === method)
    .map((call) => call.params);
}

/** The prompts the adapter received, so the local `/mcp` command can be told from the node's. */
function promptTexts(calls: readonly ReceivedCall[]): string[] {
  return paramsOf(calls, "session/prompt").map((params) => {
    const { prompt } = params as {
      readonly prompt: readonly { readonly text: string }[];
    };
    return prompt[0]?.text ?? "";
  });
}

it("opens the session in the workspace with the managed Claude options, takes mode, model and effort, checks the MCP server and sends the complete prompt once", async () => {
  const started = startClaude(
    {},
    { reasoningEffort: "xhigh", model: "claude-sonnet-5-5" },
  );
  const turn = await started.session.turn;
  expect(turn).toMatchObject({
    failure: null,
    errorCode: null,
    sessionId: FAKE_SESSION_ID,
    permissionDenials: 0,
  });
  expect(paramsOf(started.calls, "session/new")[0]).toMatchObject({
    cwd: WORKSPACE,
    mcpServers: [{ name: "pages", command: "/synthetic/bin/node" }],
    _meta: {
      claudeCode: {
        options: {
          settingSources: [],
          strictMcpConfig: true,
          tools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
        },
      },
    },
  });
  expect(paramsOf(started.calls, "session/set_config_option")).toEqual([
    {
      sessionId: FAKE_SESSION_ID,
      configId: "model",
      value: "claude-sonnet-5-5",
    },
    { sessionId: FAKE_SESSION_ID, configId: "effort", value: "xhigh" },
  ]);
  // The adapter already runs in the default mode, so nothing is switched for Nur Lesen.
  expect(promptTexts(started.calls)).toEqual(["/mcp", PROMPT]);
  expect(turn.effective).toMatchObject({
    adapter: "@agentclientprotocol/claude-agent-acp 0.90.0",
    protocol: "ACP 1",
    sessionMode: "default",
    modelOption: "sonnet",
    model: "claude-sonnet-5-5",
    reasoningEffort: "xhigh",
    permissionMode: "read_only",
    shell: "off",
    pagesMcp: "read",
  });
  expect(turn.events).toEqual(
    expect.arrayContaining([
      "model claude-sonnet-5-5 as sonnet",
      "effort xhigh confirmed",
      "mcp pages connected",
      "model claude-sonnet-5-5",
    ]),
  );
});

it("switches the adapter to bypassPermissions for YOLO before anything is sent", async () => {
  const started = startClaude({}, { mode: "yolo" });
  const turn = await started.session.turn;
  expect(turn.errorCode).toBeNull();
  expect(paramsOf(started.calls, "session/set_config_option")[0]).toEqual({
    sessionId: FAKE_SESSION_ID,
    configId: "mode",
    value: "bypassPermissions",
  });
  expect(turn.effective).toMatchObject({
    sessionMode: "bypassPermissions",
    permissionMode: "yolo",
    shell: "on",
    pagesMcp: "every tool of the executor",
  });
  expect(
    JSON.stringify(paramsOf(started.calls, "session/new")[0]),
  ).not.toContain('"tools"');
});

it("leaves the effort to the model when the agent stores none and skips the MCP check without MCP", async () => {
  const started = startClaude({}, { reasoningEffort: null, hasMcp: false });
  const turn = await started.session.turn;
  expect(turn.errorCode).toBeNull();
  expect(
    paramsOf(started.calls, "session/set_config_option").map(
      (params) => (params as { configId: string }).configId,
    ),
  ).toEqual(["model"]);
  expect(promptTexts(started.calls)).toEqual([PROMPT]);
  expect(turn.effective.reasoningEffort).toBe("default");
});

it.each([
  [
    "a model the adapter does not list",
    {},
    { model: "claude-opus-4-1" },
    "plan_model_unavailable",
  ],
  [
    "a model the adapter refuses",
    { refused: ["model"] },
    {},
    "plan_model_unavailable",
  ],
  [
    "an effort the model does not list",
    { efforts: ["low", "medium"] },
    { reasoningEffort: "max" },
    "plan_reasoning_unsupported",
  ],
  [
    "a model without any effort option",
    { missing: ["effort"] },
    {},
    "plan_reasoning_unsupported",
  ],
  [
    "a mode the adapter refuses, such as a managed setting that disables bypassPermissions",
    { refused: ["mode"] },
    { mode: "yolo" as const },
    "plan_permission_mode_unenforceable",
  ],
  [
    "an adapter without a mode option",
    { missing: ["mode"] },
    {},
    "plan_claude_acp_adapter_unsupported",
  ],
  [
    "a Pages MCP server that failed to connect",
    { mcpStatus: "failed" as const },
    {},
    "plan_mcp_unavailable",
  ],
])(
  "fails before the prompt for %s instead of running with another value",
  async (scenario, adapter, node, code) => {
    const started = startClaude(adapter, node);
    const turn = await started.session.turn;
    expect(turn).toMatchObject({ failure: "failed", errorCode: code });
    expect(promptTexts(started.calls)).not.toContain(PROMPT);
    const closed = await started.session.close();
    expect(closed.isConfirmed).toBe(true);
  },
);

it("names the stored setting and the adapter in the run record when a value is refused", async () => {
  const model = startClaude({}, { model: "claude-opus-4-1" });
  const modelTurn = await model.session.turn;
  expect(modelTurn.errorCode).toBe("plan_model_unavailable");
  expect(modelTurn.events).toContain(
    "model claude-opus-4-1 was refused by the adapter (@agentclientprotocol/claude-agent-acp 0.90.0)",
  );
  const effort = startClaude({ efforts: ["low"] }, { reasoningEffort: "max" });
  const effortTurn = await effort.session.turn;
  expect(effortTurn.errorCode).toBe("plan_reasoning_unsupported");
  expect(effortTurn.events).toContain(
    "effort max is not among low (@agentclientprotocol/claude-agent-acp 0.90.0)",
  );
});

it("ends a turn that runs on another model than the stored one and never reports it as completed", async () => {
  const started = startClaude(
    {
      reportedModel: "claude-haiku-5-5",
      turn: async (turn) => {
        await vi.waitFor(() =>
          expect(
            started.calls.some((call) => call.method === "session/cancel"),
          ).toBe(true),
        );
        void turn;
        return "cancelled";
      },
    },
    { model: "claude-sonnet-5-5" },
  );
  const turn = await started.session.turn;
  expect(turn).toMatchObject({
    failure: "failed",
    errorCode: "plan_model_unavailable",
  });
  expect(turn.effective.model).toBe("claude-haiku-5-5");
  expect(turn.events).toContain("model claude-haiku-5-5");
  expect(methodsOf(started.calls)).toContain("session/cancel");
});

it("compares the model without the context size suffix and only at the first report", async () => {
  const first = startClaude(
    { reportedModel: "claude-sonnet-5-5[1m]" },
    { model: "claude-sonnet-5-5" },
  );
  expect((await first.session.turn).errorCode).toBeNull();
  const later = startClaude(
    {
      turn: async (turn) => {
        // A subagent may use another model; only the first report decides.
        await turn.update({
          sessionUpdate: "usage_update",
          used: 20,
          size: 1000,
          _meta: { "_claude/model": "claude-haiku-5-5" },
        });
        return "end_turn";
      },
    },
    { model: "claude-sonnet-5-5" },
  );
  const turn = await later.session.turn;
  expect(turn).toMatchObject({ failure: null, errorCode: null });
  expect(turn.effective.model).toBe("claude-sonnet-5-5");
});

it("waits while the Pages MCP server connects and fails when it never does", async () => {
  vi.useFakeTimers();
  const started = startClaude({ mcpStatus: "connecting" });
  const result = started.session.turn;
  await vi.advanceTimersByTimeAsync(25_000);
  const turn = await result;
  expect(turn.errorCode).toBe("plan_mcp_unavailable");
  expect(turn.events).toContain("mcp pages connecting");
  expect(
    promptTexts(started.calls).filter((text) => text === "/mcp").length,
  ).toBeGreaterThan(5);
  expect(promptTexts(started.calls)).not.toContain(PROMPT);
});

it("goes on when the adapter does not list the Pages server, so a changed format fails no node", async () => {
  const started = startClaude({ mcpStatus: "unlisted" });
  const turn = await started.session.turn;
  expect(turn.errorCode).toBeNull();
  expect(turn.events).toContain("mcp pages unknown");
  expect(promptTexts(started.calls)).toContain(PROMPT);
});

it.each([
  ["another agent", { agentInfo: { name: "other-agent", version: "0.90.0" } }],
  [
    "the Codex adapter",
    { agentInfo: { name: "@agentclientprotocol/codex-acp", version: "2.2.2" } },
  ],
  [
    "the version before 0.90",
    {
      agentInfo: {
        name: "@agentclientprotocol/claude-agent-acp",
        version: "0.89.2",
      },
    },
  ],
  [
    "the next minor version",
    {
      agentInfo: {
        name: "@agentclientprotocol/claude-agent-acp",
        version: "0.91.0",
      },
    },
  ],
  [
    "a preview",
    {
      agentInfo: {
        name: "@agentclientprotocol/claude-agent-acp",
        version: "0.90.1-preview.11",
      },
    },
  ],
  ["no agent information", { agentInfo: null }],
  ["another protocol version", { protocolVersion: 2 }],
])(
  "refuses %s before a session opens and names what it found",
  async (scenario, adapter) => {
    const started = startClaude(adapter);
    const turn = await started.session.turn;
    expect(turn.errorCode).toBe("plan_claude_acp_adapter_unsupported");
    expect(methodsOf(started.calls)).toEqual(["initialize"]);
    expect(turn.events.join("\n")).toContain("Pages verified 0.90.x");
  },
);

it("Nur Lesen answers the requests of the adapter: Pages MCP and web only, everything else refused and counted", async () => {
  const answers: unknown[] = [];
  const started = startClaude({
    turn: async (turn) => {
      for (const [name, server] of [
        ["mcp__pages__read_ticket", "pages"],
        ["WebSearch", null],
        ["Bash", null],
        ["Write", null],
        ["mcp__claude_ai_Mail__send", "claude_ai_Mail"],
      ] as const)
        answers.push(
          (
            await turn.ask({
              // As the adapter sends it: MCP tools carry their name in `_meta`, built-in tools in `name`.
              toolCall: {
                toolCallId: `call-${name}`,
                title: name,
                ...(server === null
                  ? { name }
                  : {
                      _meta: {
                        claudeCode: {
                          toolName: name,
                          mcpServer: { name: server },
                        },
                      },
                    }),
              },
              options: [
                { optionId: "allow", name: "Allow", kind: "allow_once" },
                { optionId: "reject", name: "Reject", kind: "reject_once" },
              ],
            })
          ).outcome,
        );
      return "end_turn";
    },
  });
  const turn = await started.session.turn;
  expect(answers).toEqual([
    { outcome: "selected", optionId: "allow" },
    { outcome: "selected", optionId: "allow" },
    { outcome: "selected", optionId: "reject" },
    { outcome: "selected", optionId: "reject" },
    { outcome: "selected", optionId: "reject" },
  ]);
  expect(turn.permissionDenials).toBe(3);
  expect(turn.events).toEqual(
    expect.arrayContaining(["refused Bash", "refused Write"]),
  );
});

it("a stop ends the running Claude turn with its whole process", async () => {
  const controller = new AbortController();
  const started = startClaude(
    { turn: () => new Promise(() => {}) },
    { controller },
  );
  await vi.waitFor(() => expect(promptTexts(started.calls)).toContain(PROMPT));
  controller.abort();
  const turn = await started.session.turn;
  expect(turn).toMatchObject({ failure: "cancelled", errorCode: null });
  expect(started.process.cancelled).toEqual(["login_cancelled"]);
  expect((await started.session.close()).isConfirmed).toBe(true);
});
