import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { PicaAcpUpdates } from "@/backend/service/chat/acp/PicaAcpUpdates";

interface UpdateFixture {
  sink: {
    text: Mock;
    context: Mock;
    compaction: Mock;
    promptEnded: Mock;
    threadStatus: Mock;
    steering: Mock;
    content: Mock;
    closed: Mock;
  };
  updates: PicaAcpUpdates;
}

function fixture(): UpdateFixture {
  const sink = {
    text: vi.fn(),
    context: vi.fn(),
    compaction: vi.fn(),
    promptEnded: vi.fn(),
    threadStatus: vi.fn(),
    steering: vi.fn(),
    content: vi.fn(),
    closed: vi.fn(),
  };
  return {
    sink,
    updates: new PicaAcpUpdates(sink, {
      isCostEstimated: true,
      isCostSessionTotal: true,
    }),
  };
}

it("reports deltas, message boundaries and separate turns", () => {
  const { sink, updates } = fixture();
  updates.update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "Hello" },
  });
  updates.update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: " world" },
  });
  updates.update({
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text: "thinking" },
  });
  updates.update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "Final" },
  });
  expect(updates.answer()).toBe("Final");
  expect(sink.text.mock.calls).toEqual([
    [1, false, "Hello"],
    [1, false, " world"],
    [1, true, "Final"],
  ]);
  updates.prompted({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
  expect(sink.promptEnded).toHaveBeenCalledWith(1, {
    input: 3,
    output: 2,
    total: 5,
  });
  expect(updates.answer()).toBe("");
  updates.update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "Next" },
  });
  expect(sink.text).toHaveBeenLastCalledWith(2, false, "Next");
  updates.endAdapterTurn();
  updates.prompted({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  expect(sink.promptEnded).toHaveBeenLastCalledWith(3, null);
});

it("validates context and cost independently", () => {
  const { sink, updates } = fixture();
  updates.update({
    sessionUpdate: "usage_update",
    used: 12,
    size: 100,
    cost: { amount: 0.25, currency: "USD" },
  });
  expect(sink.context).toHaveBeenLastCalledWith(
    { used: 12, size: 100 },
    { amount: 0.25, currency: "USD", isEstimated: true, scope: "session" },
  );
  updates.update({
    sessionUpdate: "usage_update",
    used: 0,
    size: 100,
    cost: { amount: Number.NaN, currency: "USD" },
  });
  expect(sink.context).toHaveBeenLastCalledWith(null, null);
  updates.update({ sessionUpdate: "usage_update", used: -1, size: 1 });
  expect(sink.context).toHaveBeenLastCalledWith(null, null);
});

it("reports compaction, thread status, content and lifecycle", () => {
  const { sink, updates } = fixture();
  updates.initialized(true, {});
  updates.update({
    sessionUpdate: "session_info_update",
    _meta: { codex: { threadStatus: { type: "active" } } },
  });
  updates.update({
    sessionUpdate: "session_info_update",
    _meta: { codex: { threadStatus: { type: "idle" } } },
  });
  updates.update({
    sessionUpdate: "tool_call",
    toolCallId: "compact",
    title: "Compacting",
    _meta: { claudeCode: { toolName: "compact" } },
  });
  updates.update({
    sessionUpdate: "tool_call_update",
    toolCallId: "compact",
    status: "completed",
    rawOutput: { preTokens: 100, postTokens: 20 },
    _meta: { claudeCode: { toolName: "compact" } },
  });
  updates.update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "image", data: "abc", mimeType: "image/png" },
  });
  updates.closed();
  expect(sink.steering).toHaveBeenCalledWith(true, {});
  expect(sink.threadStatus.mock.calls).toEqual([[true], [false]]);
  expect(sink.compaction.mock.calls).toEqual([
    [{ status: "running", tokensBefore: null, tokensAfter: null }],
    [{ status: "completed", tokensBefore: 100, tokensAfter: 20 }],
  ]);
  expect(sink.content).toHaveBeenCalledWith(1, {
    type: "image",
    data: "abc",
    mimeType: "image/png",
  });
  expect(sink.closed).toHaveBeenCalledOnce();
});
