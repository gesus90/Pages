import { afterEach, expect, it, vi } from "vitest";

import { AgentChatReplyWatch } from "@/backend/service/conversation/AgentChatReplyWatch";
import { ConversationEvents } from "@/backend/service/conversation/ConversationEvents";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { ConversationMessage } from "@/definition/Conversation";

afterEach(() => vi.useRealTimers());

it("keeps the first reply even if it arrives before the wait", async () => {
  const events = new ConversationEvents();
  const watch = new AgentChatReplyWatch(events, "conversation");
  const message = partial<ConversationMessage>({
    id: "reply",
    conversationId: "conversation",
    clientMessageId: "reply-sent",
  });
  events.publish({ kind: "message", message, recipientIds: [] });
  events.publish({
    kind: "message",
    message: { ...message, id: "duplicate" },
    recipientIds: [],
  });
  await expect(
    watch.next("sent", {
      milliseconds: 1000,
      signal: new AbortController().signal,
    }),
  ).resolves.toBe(message);
  watch.close();
});

it("ignores unrelated messages and resolves on reply, abort or timeout", async () => {
  vi.useFakeTimers();
  const events = new ConversationEvents();
  const watch = new AgentChatReplyWatch(events, "conversation");
  const controller = new AbortController();
  const waiting = watch.next("sent", {
    milliseconds: 1000,
    signal: controller.signal,
  });
  const message = partial<ConversationMessage>({
    id: "reply",
    conversationId: "other",
    clientMessageId: "reply-sent",
  });
  events.publish({ kind: "message", message, recipientIds: [] });
  events.publish({
    kind: "message",
    message: {
      ...message,
      conversationId: "conversation",
      clientMessageId: "unrelated",
    },
    recipientIds: [],
  });
  events.publish({
    kind: "message",
    message: { ...message, conversationId: "conversation" },
    recipientIds: [],
  });
  await expect(waiting).resolves.toMatchObject({ id: "reply" });
  const aborted = watch.next("abort", {
    milliseconds: 1000,
    signal: controller.signal,
  });
  controller.abort();
  await expect(aborted).resolves.toBeNull();
  const timed = watch.next("timeout", {
    milliseconds: 500,
    signal: new AbortController().signal,
  });
  await vi.advanceTimersByTimeAsync(500);
  await expect(timed).resolves.toBeNull();
  watch.close();
});
