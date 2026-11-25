import { describe, expect, it } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import {
  createAcpSessionState,
  noteAcpStderr,
  readAcpConfiguration,
  readAcpUpdate,
} from "@/backend/agents/acp/AcpEvents";

import type {
  SessionConfigOption,
  SessionUpdate,
} from "@agentclientprotocol/sdk";

const FIELDS = { sessionMode: "mode", model: "model" };

function chunk(text: string, messageId?: string): SessionUpdate {
  return {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
    ...(messageId === undefined ? {} : { messageId }),
  };
}

function toolCall(
  toolCallId: string,
  fields: Record<string, unknown> = {},
): SessionUpdate {
  return {
    sessionUpdate: "tool_call",
    toolCallId,
    title: "Read",
    ...fields,
  };
}

function toolUpdate(
  toolCallId: string,
  fields: Record<string, unknown> = {},
): SessionUpdate {
  return {
    sessionUpdate: "tool_call_update",
    toolCallId,
    ...fields,
  };
}

describe("message chunks", () => {
  it("appends chunks of one open message", () => {
    const state = createAcpSessionState();
    readAcpUpdate(state, chunk("ab"), FIELDS);
    readAcpUpdate(state, chunk("cd"), FIELDS);
    expect(state.text).toBe("abcd");
    expect(state.messageBytes).toBe(4);
  });

  it("starts a new message when the message identifier changes", () => {
    const state = createAcpSessionState();
    readAcpUpdate(state, chunk("ab", "one"), FIELDS);
    readAcpUpdate(state, chunk("cd", "one"), FIELDS);
    readAcpUpdate(state, chunk("ef", "two"), FIELDS);
    expect(state.text).toBe("ef");
    expect(state.messageId).toBe("two");
  });

  it("ignores chunks that are not text", () => {
    const state = createAcpSessionState();
    readAcpUpdate(
      state,
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "image", data: "", mimeType: "image/png" },
      },
      FIELDS,
    );
    expect(state.isMessageOpen).toBe(false);
  });

  it("marks an oversized message and keeps no more text", () => {
    const state = createAcpSessionState();
    readAcpUpdate(state, chunk("a".repeat(200_001)), FIELDS);
    expect(state.isResultOversized).toBe(true);
    expect(state.text).toBe("");
  });

  it("ends the message at a thought, tool call, update and plan", () => {
    const state = createAcpSessionState();
    readAcpUpdate(state, chunk("ab"), FIELDS);
    readAcpUpdate(
      state,
      {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "" },
      },
      FIELDS,
    );
    expect(state.isMessageOpen).toBe(false);
    readAcpUpdate(state, chunk("cd"), FIELDS);
    expect(state.text).toBe("cd");
  });
});

describe("tool calls", () => {
  it("notes a tool call with its kind and title", () => {
    const state = createAcpSessionState();
    readAcpUpdate(state, toolCall("1", { kind: "read" }), FIELDS);
    readAcpUpdate(state, toolCall("2"), FIELDS);
    expect(state.events).toEqual(["tool read Read", "tool other Read"]);
    expect(state.tools.get("1")).toBe("Read");
  });

  it("keeps the title of an update without one and drops finished tools", () => {
    const state = createAcpSessionState();
    readAcpUpdate(state, toolCall("1"), FIELDS);
    readAcpUpdate(state, toolUpdate("1", { status: "in_progress" }), FIELDS);
    expect(state.tools.get("1")).toBe("Read");
    readAcpUpdate(state, toolUpdate("1", { status: "completed" }), FIELDS);
    expect(state.tools.has("1")).toBe(false);
    expect(state.events.at(-1)).toBe("tool Read completed");
  });

  it("notes the exit code of a command that ended", () => {
    const state = createAcpSessionState();
    readAcpUpdate(
      state,
      toolUpdate("1", { status: "completed", rawOutput: { exit_code: 3 } }),
      FIELDS,
    );
    expect(state.events.at(-1)).toBe("tool tool completed exit 3");
  });

  it("names an unknown untitled tool", () => {
    const state = createAcpSessionState();
    readAcpUpdate(state, toolUpdate("9"), FIELDS);
    expect(state.tools.get("9")).toBe("tool");
  });

  it("flags a failed Pages MCP startup", () => {
    const state = createAcpSessionState();
    readAcpUpdate(
      state,
      toolUpdate("1", { title: "mcp__pages__startup", status: "failed" }),
      FIELDS,
    );
    expect(state.isMcpUnavailable).toBe(true);
    const other = createAcpSessionState();
    readAcpUpdate(
      other,
      toolUpdate("1", { title: "mcp__pages__startup", status: "completed" }),
      FIELDS,
    );
    expect(other.isMcpUnavailable).toBe(false);
  });

  it("bounds a long title at a character boundary", () => {
    const state = createAcpSessionState();
    readAcpUpdate(state, toolCall("1", { title: "a".repeat(5000) }), FIELDS);
    expect(state.tools.get("1")).toHaveLength(4000);
    readAcpUpdate(
      state,
      toolCall("2", { title: `${"a".repeat(3999)}é` }),
      FIELDS,
    );
    expect(state.tools.get("2")).toBe("a".repeat(3999));
  });

  it("refuses an oversized identifier", () => {
    const state = createAcpSessionState();
    expect(() =>
      readAcpUpdate(state, toolCall("x".repeat(201)), FIELDS),
    ).toThrow(AgentError);
  });

  it("refuses more than 512 open tools", () => {
    const state = createAcpSessionState();
    for (let index = 0; index < 512; index += 1)
      readAcpUpdate(state, toolCall(String(index)), FIELDS);
    expect(() => readAcpUpdate(state, toolCall("last"), FIELDS)).toThrow(
      AgentError,
    );
  });
});

describe("other updates", () => {
  it("notes plans and modes", () => {
    const state = createAcpSessionState();
    readAcpUpdate(state, { sessionUpdate: "plan", entries: [] }, FIELDS);
    readAcpUpdate(
      state,
      { sessionUpdate: "current_mode_update", currentModeId: "ask" },
      FIELDS,
    );
    expect(state.effective.sessionMode).toBe("ask");
    expect(state.events).toEqual(["plan 0 entries", "mode ask"]);
  });

  it("reads configuration updates", () => {
    const state = createAcpSessionState();
    readAcpUpdate(
      state,
      {
        sessionUpdate: "config_option_update",
        configOptions: [select("mode", "x")],
      },
      FIELDS,
    );
    expect(state.effective.sessionMode).toBe("x");
  });

  it("ignores an unrelated update", () => {
    const state = createAcpSessionState();
    readAcpUpdate(
      state,
      {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "" },
      },
      FIELDS,
    );
    expect(state.events).toEqual([]);
  });

  it("keeps the first reported model only", () => {
    const state = createAcpSessionState();
    const usage = (model: unknown): SessionUpdate => ({
      sessionUpdate: "usage_update",
      used: 1,
      size: 2,
      _meta: { "_claude/model": model },
    });
    readAcpUpdate(state, usage(3), FIELDS);
    readAcpUpdate(state, usage(""), FIELDS);
    readAcpUpdate(
      state,
      { sessionUpdate: "usage_update", used: 1, size: 2 },
      FIELDS,
    );
    expect(state.reportedModel).toBeNull();
    readAcpUpdate(state, usage("opus"), FIELDS);
    readAcpUpdate(state, usage("haiku"), FIELDS);
    expect(state.reportedModel).toBe("opus");
  });

  it("reads a rejected rate limit as a provider failure", () => {
    const state = createAcpSessionState();
    readAcpUpdate(
      state,
      {
        sessionUpdate: "plan",
        entries: [],
        _meta: { "_claude/rateLimit": { status: "rejected" } },
      },
      FIELDS,
    );
    expect(state.providerFailure?.code).toBe("provider_quota_exhausted");
  });
});

function select(id: string, currentValue: string): SessionConfigOption {
  return {
    id,
    name: id,
    type: "select",
    currentValue,
    options: [{ value: currentValue, name: currentValue }],
  };
}

describe("readAcpConfiguration", () => {
  it("takes only the options the adapter offers", () => {
    const state = createAcpSessionState();
    readAcpConfiguration(state, [select("model", "m")], FIELDS);
    expect(state.effective).toEqual({ model: "m" });
  });
});

describe("noteAcpStderr", () => {
  it("notes the last non-empty redacted line", () => {
    const state = createAcpSessionState();
    noteAcpStderr(state, "first\n  secret  \n\n", (line) =>
      line.replace("secret", "***"),
    );
    expect(state.events).toEqual(["adapter ***"]);
  });

  it("notes nothing for blank output", () => {
    const state = createAcpSessionState();
    noteAcpStderr(state, " \n", (line) => line);
    expect(state.events).toEqual([]);
  });
});
