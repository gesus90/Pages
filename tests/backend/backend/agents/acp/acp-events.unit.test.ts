import { expect, it } from "vitest";

import {
  createAcpSessionState,
  noteAcpStderr,
  readAcpConfiguration,
  readAcpUpdate,
} from "@/backend/agents/acp/AcpEvents";
import { PLAN_OUTPUT_LIMIT } from "@/backend/service/agents/AgentPlanOutput";

import type { SessionConfigOption } from "@agentclientprotocol/sdk";

const FIELDS = { model: "model", reasoningEffort: "effort" };

const OPTIONS: SessionConfigOption[] = [
  {
    id: "model",
    name: "Model",
    type: "select",
    currentValue: "opus",
    options: [{ value: "opus", name: "Opus" }],
  },
];

function chunk(
  text: string,
  messageId?: string,
): Parameters<typeof readAcpUpdate>[1] {
  return {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
    ...(messageId === undefined ? {} : { messageId }),
  };
}

it("starts empty", () => {
  expect(createAcpSessionState()).toMatchObject({
    sessionId: null,
    text: "",
    events: [],
    providerFailure: null,
    reportedModel: null,
  });
});

it("joins chunks of one message and restarts after a boundary", () => {
  const state = createAcpSessionState();

  readAcpUpdate(state, chunk("Hel", "m-1"), FIELDS);
  readAcpUpdate(state, chunk("lo", "m-1"), FIELDS);
  expect(state.text).toBe("Hello");
  readAcpUpdate(state, chunk("Next", "m-2"), FIELDS);
  expect(state.text).toBe("Next");
  readAcpUpdate(
    state,
    {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "x" },
    },
    FIELDS,
  );
  readAcpUpdate(state, chunk("Final"), FIELDS);
  readAcpUpdate(state, chunk(" answer"), FIELDS);

  expect(state.text).toBe("Final answer");
  expect(state.messageId).toBeNull();
  expect(state.messageBytes).toBe(12);
});

it("ignores message chunks that are no text", () => {
  const state = createAcpSessionState();

  readAcpUpdate(
    state,
    {
      sessionUpdate: "agent_message_chunk",
      content: { type: "image", data: "AA==", mimeType: "image/png" },
    },
    FIELDS,
  );

  expect(state.isMessageOpen).toBe(false);
});

it("stops keeping an oversized answer but counts its bytes", () => {
  const state = createAcpSessionState();

  readAcpUpdate(state, chunk("a".repeat(PLAN_OUTPUT_LIMIT)), FIELDS);
  readAcpUpdate(state, chunk("b"), FIELDS);
  readAcpUpdate(state, chunk("c"), FIELDS);

  expect(state.isResultOversized).toBe(true);
  expect(state.text).toHaveLength(PLAN_OUTPUT_LIMIT);
  expect(state.messageBytes).toBe(PLAN_OUTPUT_LIMIT + 2);
});

it("tracks tool calls until they end and notes their outcome", () => {
  const state = createAcpSessionState();

  readAcpUpdate(
    state,
    { sessionUpdate: "tool_call", toolCallId: "t-1", title: "Read file" },
    FIELDS,
  );
  expect(state.tools.get("t-1")).toBe("Read file");
  readAcpUpdate(
    state,
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "t-1",
      status: "completed",
    },
    FIELDS,
  );
  readAcpUpdate(
    state,
    { sessionUpdate: "tool_call_update", toolCallId: "t-2", status: "failed" },
    FIELDS,
  );

  expect(state.tools.size).toBe(0);
  expect(state.events).toEqual([
    "tool other Read file",
    "tool Read file completed",
    "tool tool failed",
  ]);
});

it("cuts long tool titles at a character boundary", () => {
  const state = createAcpSessionState();

  readAcpUpdate(
    state,
    {
      sessionUpdate: "tool_call",
      toolCallId: "t-1",
      kind: "read",
      title: `${"a".repeat(3999)}é`,
    },
    FIELDS,
  );

  expect(state.tools.get("t-1")).toBe("a".repeat(3999));
});

it("refuses an overlong tool identifier", () => {
  const state = createAcpSessionState();

  expect(() =>
    readAcpUpdate(
      state,
      { sessionUpdate: "tool_call_update", toolCallId: "t".repeat(201) },
      FIELDS,
    ),
  ).toThrow(expect.objectContaining({ code: "acp_output_overflow" }));
});

it("refuses more than 512 open tool calls", () => {
  const state = createAcpSessionState();
  for (let index = 0; index < 512; index += 1)
    readAcpUpdate(
      state,
      { sessionUpdate: "tool_call_update", toolCallId: `t-${index}` },
      FIELDS,
    );

  expect(() =>
    readAcpUpdate(
      state,
      { sessionUpdate: "tool_call_update", toolCallId: "t-last" },
      FIELDS,
    ),
  ).toThrow(expect.objectContaining({ code: "acp_output_overflow" }));
});

it("marks the Pages MCP server unavailable only when its startup fails", () => {
  const state = createAcpSessionState();

  readAcpUpdate(
    state,
    {
      sessionUpdate: "tool_call",
      toolCallId: "m-1",
      title: "mcp__pages__startup",
      status: "in_progress",
    },
    FIELDS,
  );
  expect(state.isMcpUnavailable).toBe(false);
  readAcpUpdate(
    state,
    { sessionUpdate: "tool_call_update", toolCallId: "m-1", status: "failed" },
    FIELDS,
  );

  expect(state.isMcpUnavailable).toBe(true);
});

it("notes plans and mode changes and reads option updates", () => {
  const state = createAcpSessionState();

  readAcpUpdate(
    state,
    {
      sessionUpdate: "plan",
      entries: [{ content: "a", priority: "low", status: "pending" }],
    },
    FIELDS,
  );
  readAcpUpdate(
    state,
    { sessionUpdate: "current_mode_update", currentModeId: "plan" },
    FIELDS,
  );
  readAcpUpdate(
    state,
    { sessionUpdate: "config_option_update", configOptions: OPTIONS },
    FIELDS,
  );
  readAcpUpdate(
    state,
    { sessionUpdate: "available_commands_update", availableCommands: [] },
    FIELDS,
  );

  expect(state.events).toEqual(["plan 1 entries", "mode plan"]);
  expect(state.effective).toEqual({ sessionMode: "plan", model: "opus" });
});

it("keeps only the first model a usage update names", () => {
  const state = createAcpSessionState();

  readAcpUpdate(
    state,
    {
      sessionUpdate: "usage_update",
      used: 1,
      size: 10,
      _meta: { "_claude/model": "" },
    },
    FIELDS,
  );
  expect(state.reportedModel).toBeNull();
  readAcpUpdate(
    state,
    { sessionUpdate: "usage_update", used: 1, size: 10 },
    FIELDS,
  );
  readAcpUpdate(
    state,
    {
      sessionUpdate: "usage_update",
      used: 1,
      size: 10,
      _meta: { "_claude/model": "opus" },
    },
    FIELDS,
  );
  readAcpUpdate(
    state,
    {
      sessionUpdate: "usage_update",
      used: 1,
      size: 10,
      _meta: { "_claude/model": "haiku" },
    },
    FIELDS,
  );

  expect(state.reportedModel).toBe("opus");
});

it("follows the latest Claude rate limit report", () => {
  const state = createAcpSessionState();

  readAcpUpdate(
    state,
    {
      sessionUpdate: "usage_update",
      used: 1,
      size: 10,
      _meta: { "_claude/rateLimit": { status: "rejected" } },
    },
    FIELDS,
  );
  expect(state.providerFailure).toEqual({
    code: "provider_quota_exhausted",
    resetAt: null,
  });
  readAcpUpdate(
    state,
    {
      sessionUpdate: "usage_update",
      used: 1,
      size: 10,
      _meta: { "_claude/rateLimit": { status: "allowed" } },
    },
    FIELDS,
  );

  expect(state.providerFailure).toBeNull();
});

it("reads only the configured fields that the adapter offers", () => {
  const state = createAcpSessionState();

  readAcpConfiguration(state, OPTIONS, FIELDS);

  expect(state.effective).toEqual({ model: "opus" });
});

it("notes the last redacted, bounded adapter diagnostic", () => {
  const state = createAcpSessionState();

  noteAcpStderr(state, "first\n  token=abc  \n\n", (line) =>
    line.replace("abc", "[redacted]"),
  );
  noteAcpStderr(state, `${"x".repeat(300)}\n`, (line) => line);

  expect(state.events).toEqual([
    "adapter token=[redacted]",
    `adapter ${"x".repeat(192)}`,
  ]);
});

it("notes nothing for an empty adapter diagnostic", () => {
  const state = createAcpSessionState();

  noteAcpStderr(state, " \n\n", (line) => line);

  expect(state.events).toEqual([]);
});
