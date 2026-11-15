import { expect, it, vi } from "vitest";

import { PicaMobileConversationPresence } from "@/backend/service/mobile/conversations/PicaMobileConversationPresence";
import { PicaMobileConversationPush } from "@/backend/service/mobile/notifications/PicaMobileConversationPush";
import { DEFAULT_NOTIFICATION_CHOICES } from "@/definition/PicaMobileNotifications";

import { registration } from "./pica-mobile-dispatcher-fixture";

import type { ConversationEvent } from "@/backend/service/conversation/ConversationEvents";

it("sends no chat push during a browser heartbeat, then sends again after 45 seconds", async () => {
  let now = 0;
  const presence = new PicaMobileConversationPresence(() => now);
  const sender = {
    ready: vi.fn(async () => true),
    send: vi.fn(async () => ({ kind: "sent" as const })),
  };
  const preferences = {
    find: vi.fn(async (accountId: string) => ({
      accountId,
      ...DEFAULT_NOTIFICATION_CHOICES,
      teamRunsSince: null,
    })),
  };
  const push = new PicaMobileConversationPush({
    registrations: { listActivated: vi.fn(async () => [registration()]) },
    accounts: { isBindingValid: vi.fn(async () => true) },
    vault: { decrypt: vi.fn(() => "token") },
    sender,
    instanceId: vi.fn(async () => "instance"),
    mutedMemberIds: vi.fn(async () => new Set<string>()),
    conversation: vi.fn(async () => ({ kind: "group" as const, name: "Chat" })),
    presence,
    preferences,
    ttlSeconds: 900,
  });
  const event: Extract<ConversationEvent, { readonly kind: "message" }> = {
    kind: "message",
    recipientIds: ["account-1"],
    message: {
      id: "message-1",
      conversationId: "chat",
      clientMessageId: "client-1",
      sender: { id: "sender", kind: "human", name: "Sender", color: null },
      text: "Hello",
      createdAt: "2026-11-15T13:00:00.000Z",
      mentions: [],
      attachments: [],
      links: [],
    },
  };
  presence.setBrowser("account-1", "tab-1", "group:chat", "chat");
  await push.deliver(event);
  expect(sender.send).not.toHaveBeenCalled();
  now = 45_000;
  await push.deliver(event);
  expect(sender.send).toHaveBeenCalledOnce();
  presence.set("account-1", "app-1", "chat");
  await push.deliver(event);
  expect(sender.send).toHaveBeenCalledOnce();
  presence.set("account-1", "app-1", null);
  preferences.find.mockResolvedValue({
    accountId: "account-1",
    ...DEFAULT_NOTIFICATION_CHOICES,
    receiveNotifications: false,
    teamRunsSince: null,
  });
  await push.deliver(event);
  expect(sender.send).toHaveBeenCalledOnce();
});
