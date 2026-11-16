import { expect, it, vi } from "vitest";

import { AgentChatService } from "@/backend/service/conversation/AgentChatService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentChatServiceDependencies } from "@/backend/service/conversation/AgentChatService";
import type { AgentChatSendRequest } from "@/definition/AgentChat";

const AGENT = {
  id: "agent",
  displayName: "Agent",
  isAgent: true,
  isActive: true,
};
const MESSAGE = {
  id: "message",
  conversationId: "chat",
  sender: { id: "agent", name: "Agent", kind: "agent" },
  text: "Hello",
  createdAt: "now",
};

it("reads the newest page and marks its last message as read", async () => {
  const markRead = vi.fn(async () => {});
  const dependencies = partial<AgentChatServiceDependencies>({
    users: { findById: async () => AGENT },
    reader: {
      history: async () => ({
        conversationId: "chat",
        messages: [MESSAGE],
        hasMore: true,
      }),
    },
    service: { markRead },
    guard: { isPaused: async () => false },
  });
  const service = new AgentChatService(dependencies);
  await expect(
    service.read("agent", { chatId: "chat", beforeMessageId: null }),
  ).resolves.toMatchObject({
    chatId: "chat",
    hasMore: true,
    isPaused: false,
    messages: [{ text: "Hello" }],
  });
  expect(markRead).toHaveBeenCalledWith(AGENT, {
    conversationId: "chat",
    upToMessageId: "message",
  });
  await service.read("agent", { chatId: "chat", beforeMessageId: "older" });
  expect(markRead).toHaveBeenCalledTimes(1);
});

it("sends a trimmed message after checking conversation and quota", async () => {
  const send = vi.fn(async () => MESSAGE);
  const requireRunning = vi.fn(async () => {});
  const requireQuota = vi.fn(async () => {});
  const dependencies = partial<AgentChatServiceDependencies>({
    users: { findById: async () => AGENT },
    reader: { summary: async () => ({ id: "chat" }) },
    directory: { read: async () => ({}) },
    service: { send },
    guard: { requireRunning, requireQuota, isPaused: async () => false },
    createId: () => "unique",
  });
  const service = new AgentChatService(dependencies);
  const context = partial<Parameters<AgentChatService["send"]>[2]>({
    signal: new AbortController().signal,
  });
  await expect(
    service.send(
      "agent",
      partial<AgentChatSendRequest>({
        chatId: "chat",
        text: " Hello ",
        waitForReply: false,
      }),
      context,
    ),
  ).resolves.toEqual({ chatId: "chat", messageId: "message", status: "sent" });
  expect(requireRunning).toHaveBeenCalledWith("chat");
  expect(requireQuota).toHaveBeenCalledWith("agent");
  expect(send).toHaveBeenCalledWith(
    AGENT,
    expect.objectContaining({ conversationId: "chat", text: "Hello" }),
  );
  await expect(
    service.send(
      "agent",
      partial<AgentChatSendRequest>({ chatId: "chat", text: "  " }),
      context,
    ),
  ).rejects.toMatchObject({ code: "invalid_message" });
});

it("rejects unavailable agents before reading their chats", async () => {
  const service = new AgentChatService(
    partial<AgentChatServiceDependencies>({
      users: { findById: async () => ({ ...AGENT, isActive: false }) },
    }),
  );
  await expect(service.list("agent", { cursor: null })).rejects.toMatchObject({
    code: "agent_unavailable",
  });
});
