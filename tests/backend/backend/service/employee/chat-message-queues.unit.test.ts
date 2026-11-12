import { describe, expect, it } from "vitest";

import {
  markQueuedMessages,
  queuedChatMessages,
  waitingInChat,
} from "@/backend/service/employee/ChatMessageQueues";

import type { VirtualChatMessage } from "@/definition/VirtualChat";

const messages: VirtualChatMessage[] = [
  { id: "old", authorId: null, content: "old", toolUses: [] },
  { id: "answer", authorId: "agent", content: "answer", toolUses: [] },
  { id: "waiting", authorId: null, content: "waiting", toolUses: [] },
  { id: "other", authorId: null, content: "other", toolUses: [] },
];

describe("chat message queues", () => {
  it("marks only waiting messages after the last answer without mutating history", () => {
    const waiting = waitingInChat(messages, new Set(["old", "waiting"]));
    const marked = markQueuedMessages(messages, waiting);

    expect([...waiting]).toEqual([["waiting", "chat"]]);
    expect(marked[2]).toEqual({ ...messages[2], queue: "chat" });
    expect(marked[0]).toBe(messages[0]);
    expect(messages[2]).not.toHaveProperty("queue");
  });

  it("includes waiting messages when no answer exists and renders limit queue entries", () => {
    expect([...waitingInChat(messages.slice(2), new Set(["other"]))]).toEqual([
      ["other", "chat"],
    ]);
    expect(queuedChatMessages([{ id: "42", text: "Hello" }])).toEqual([
      {
        id: "queued-42",
        authorId: null,
        content: "Hello",
        toolUses: [],
        queue: "limit",
      },
    ]);
    expect(queuedChatMessages([])).toEqual([]);
  });
});
