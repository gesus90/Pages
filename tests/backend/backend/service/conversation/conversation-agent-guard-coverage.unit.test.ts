import { expect, it, vi } from "vitest";

import { ConversationAgentGuard } from "@/backend/service/conversation/ConversationAgentGuard";
import {
  CONVERSATION_AGENT_CHAIN_MAXIMUM,
  CONVERSATION_AGENT_SEND_PREFIX,
} from "@/definition/Conversation";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { User } from "@/definition/User";

it("pauses consecutive agent messages and enforces the hourly send quota", async () => {
  const chat = {
    chainLength: vi.fn(async () => CONVERSATION_AGENT_CHAIN_MAXIMUM),
    sentSince: vi.fn(async () => 5),
    release: vi.fn(),
  };
  const guard = new ConversationAgentGuard({
    chat,
    settings: partial({ read: async () => ({ hourlyMessageLimit: 5 }) }),
    members: partial({}),
    oversight: partial({}),
    publisher: { publish: vi.fn() },
    now: () => new Date("2026-11-16T12:00:00Z"),
  });
  await expect(guard.requireRunning("conversation")).rejects.toMatchObject({
    code: "conversation_paused",
  });
  await expect(guard.requireQuota("agent")).rejects.toMatchObject({
    code: "rate_limited",
  });
  expect(chat.sentSince).toHaveBeenCalledWith(
    "agent",
    "2026-11-16T11:00:00.000Z",
    CONVERSATION_AGENT_SEND_PREFIX,
  );
  chat.chainLength.mockResolvedValue(0);
  chat.sentSince.mockResolvedValue(4);
  await expect(guard.requireRunning("conversation")).resolves.toBeUndefined();
  await expect(guard.requireQuota("agent")).resolves.toBeUndefined();
});

it("only allows a person with membership or oversight to resume a conversation", async () => {
  const release = vi.fn(async () => undefined);
  const publish = vi.fn();
  const isMember = vi.fn(async () => false);
  const canOversee = vi.fn(async () => false);
  const guard = new ConversationAgentGuard({
    chat: partial({ release }),
    settings: partial({}),
    members: { isMember },
    oversight: { canOversee },
    publisher: { publish },
  });
  const person = partial<User>({ id: "person", isAgent: false });
  await expect(
    guard.resume({ ...person, isAgent: true }, "conversation"),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(guard.resume(person, "conversation")).rejects.toMatchObject({
    code: "not_found",
  });
  canOversee.mockResolvedValue(true);
  await guard.resume(person, "conversation");
  expect(release).toHaveBeenCalledWith("conversation", {
    type: "conversation.changed",
    id: "conversation",
  });
  expect(publish).toHaveBeenCalledWith({
    type: "conversation.changed",
    id: "conversation",
  });
});
