import { expect, it } from "vitest";

import { createLiveHistory, liveBatch } from "@/scripts/runner/live.mjs";

function history(tool: string): {
  receive(event: unknown): Promise<void>;
  finish(): Promise<void>;
  events: { kind: string; text: string }[];
} {
  const events: { kind: string; text: string }[] = [];
  const reader = createLiveHistory(
    { program: { route: { tool } } },
    (text) => text.replaceAll("secret", "redacted"),
    async (event) => {
      events.push(event);
    },
  );
  return { ...reader, events };
}

it("projects Codex status, plans, tools and messages with bounded deduplication", async () => {
  const reader = history("codex");
  await reader.receive({ type: "turn.started" });
  await reader.receive({ type: "turn.failed", error: { message: "secret" } });
  const plan = {
    type: "item.updated",
    item: {
      id: "p",
      type: "todo_list",
      items: [{ completed: true, text: "done" }, { text: "next" }],
    },
  };
  await reader.receive(plan);
  await reader.receive(plan);
  await reader.receive({
    type: "item.completed",
    item: {
      id: "c",
      type: "command_execution",
      command: "echo secret",
      status: "failed",
      aggregated_output: "output",
    },
  });
  await reader.receive({
    type: "item.completed",
    item: { id: "m", type: "agent_message", text: "answer" },
  });
  expect(reader.events.map(({ kind, text }) => [kind, text])).toEqual([
    ["status", "Agent started"],
    ["error", "redacted"],
    ["plan", "[x] done\n[ ] next"],
    ["tool_failed", "echo redacted"],
    ["tool_failed", "output"],
    ["agent_message", "answer"],
  ]);
});

it("splits redacted UTF-8 text without corrupting characters", async () => {
  const reader = history("codex");
  const message = `${"a".repeat(3999)}😀secret`;
  await reader.receive({
    type: "item.completed",
    item: { id: "m", type: "agent_message", text: message },
  });
  expect(reader.events.map((event) => event.text)).toEqual([
    "a".repeat(3999),
    "😀redacted",
  ]);
});

it("projects Claude partial text, tool calls, results and completion", async () => {
  const reader = history("claude");
  const block = {
    type: "tool_use",
    id: "t",
    name: "TodoWrite",
    input: { todos: [{ status: "pending", content: "work" }] },
  };
  await reader.receive({
    type: "stream_event",
    event: { type: "content_block_start", content_block: block },
  });
  await reader.receive({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta" } },
  });
  await reader.receive({
    type: "assistant",
    message: { content: [{ type: "text", text: "hello" }] },
  });
  await reader.receive({
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          is_error: true,
          content: [{ type: "text", text: "failure" }],
        },
      ],
    },
  });
  await reader.receive({ type: "result" });
  await reader.finish();
  expect(reader.events.map(({ kind, text }) => [kind, text])).toEqual([
    ["tool_started", "TodoWrite"],
    ["plan", "[pending] work"],
    ["status", "Agent is composing a message"],
    ["agent_message", "hello"],
    ["tool_failed", "failure"],
    ["status", "Agent completed"],
  ]);
});

it.each(["opencode", "antigravity"])(
  "projects %s configuration and ACP updates",
  async (tool) => {
    const reader = history(tool);
    await reader.receive({
      type: "pages.configuration",
      model: "model-a",
      reasoningEffort: "high",
    });
    await reader.receive({
      type: "pages.update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "ignored" },
      },
    });
    await reader.receive({
      type: "pages.update",
      update: { sessionUpdate: "agent_message", text: "answer" },
    });
    await reader.receive({
      type: "pages.update",
      update: { sessionUpdate: "tool_call", title: "read" },
    });
    await reader.receive({
      type: "pages.update",
      update: {
        sessionUpdate: "tool_call_update",
        status: "failed",
        toolCallId: "id",
      },
    });
    await reader.receive({
      type: "pages.update",
      update: {
        sessionUpdate: "plan",
        entries: [{ status: "done", content: "step" }],
      },
    });
    expect(reader.events.map(({ kind, text }) => [kind, text])).toEqual([
      ["status", "model model-a confirmed"],
      ["status", "thinking_level high confirmed"],
      ["agent_message", "answer"],
      ["tool_started", "read"],
      ["tool_failed", "id"],
      ["plan", "[done] step"],
    ]);
  },
);

it("limits history batches by sequence, count and encoded size", () => {
  const events = Array.from({ length: 25 }, (_, index) => ({
    sequence: index + 1,
    text: "x",
  }));
  expect(liveBatch(events, 5).map((event) => event.sequence)).toEqual(
    Array.from({ length: 16 }, (_, index) => index + 6),
  );
  expect(liveBatch([{ sequence: 1, text: "x".repeat(32768) }], 0)).toEqual([]);
});
