import { expect, it, vi } from "vitest";

import { ConversationMediaOverviewRepository } from "./ConversationMediaOverviewRepository";

import type { Database } from "@/backend/database/Database";

it("maps the linked messages of a conversation", async () => {
  const query = vi.fn<Database["query"]>(async () => [
    ["m1", "u1", "2026-01-01T00:00:00Z", "see http://a.test"],
  ]);
  await expect(
    new ConversationMediaOverviewRepository({ query }).linkedMessages("c1"),
  ).resolves.toEqual([
    {
      messageId: "m1",
      senderId: "u1",
      sentAt: "2026-01-01T00:00:00Z",
      text: "see http://a.test",
    },
  ]);
  expect(query.mock.calls[0]?.[1]).toEqual({
    conversation_id: "c1",
    address_pattern: "%http%",
  });
});

it("rejects a message row without text", async () => {
  const query = vi.fn<Database["query"]>(async () => [
    ["m1", "u1", "2026-01-01T00:00:00Z", null],
  ]);
  await expect(
    new ConversationMediaOverviewRepository({ query }).linkedMessages("c1"),
  ).rejects.toThrow('invalid value for "text"');
});
