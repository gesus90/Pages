import { expect, it, vi } from "vitest";

import { ConversationMessageContent } from "@/backend/service/conversation/content/ConversationMessageContent";

import type { StoredConversationMessage } from "@/backend/database/repositories/conversation/ConversationMessageRepository";

it("combines content for every message while excluding notices from link discovery", async () => {
  const message: StoredConversationMessage = {
    id: "one",
    sequence: 1,
    conversationId: "c",
    senderId: "u",
    clientMessageId: "client",
    text: "https://example.com",
    mentions: [],
    createdAt: "2026-01-01",
    voice: null,
    notice: null,
  };
  const notice: StoredConversationMessage = {
    ...message,
    id: "two",
    notice: "agent_failed",
  };
  const attachmentReader = {
    forMessages: vi.fn().mockResolvedValue(new Map()),
  };
  const linkReader = { forMessages: vi.fn().mockResolvedValue(new Map()) };
  const content = new ConversationMessageContent(attachmentReader, linkReader);
  expect(await content.describe([message, notice])).toEqual(
    new Map([
      ["one", { attachments: [], links: [] }],
      ["two", { attachments: [], links: [] }],
    ]),
  );
  expect(attachmentReader.forMessages).toHaveBeenCalledWith(["one", "two"]);
  expect(linkReader.forMessages).toHaveBeenCalledWith([message]);
});
