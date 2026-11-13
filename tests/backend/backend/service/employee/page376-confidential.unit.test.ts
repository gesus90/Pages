import { expect, it, vi } from "vitest";

import { ConversationError } from "@/backend/error/ConversationError";
import { AgentChatReader } from "@/backend/service/employee/AgentChatReader";
import { AgentChatToolGuard } from "@/backend/service/employee/AgentChatToolGuard";
import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";

import type { AgentChatEntry, AgentChatTools } from "@/definition/AgentChat";
import type { StoredConversationMessage } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import { partialStub } from "../../stub-fixture";

const SECRET = "Geheimer Inhalt des vertraulichen Chats";

function message(sequence: number, text: string): StoredConversationMessage {
  return {
    id: `m${String(sequence)}`,
    sequence,
    conversationId: "group-own",
    senderId: "person",
    clientMessageId: `c${String(sequence)}`,
    text,
    mentions: [],
    createdAt: `2026-03-04T10:0${String(sequence)}:00.000Z`,
    voice: null,
    notice: null,
  };
}

function guardFixture(): {
  readonly guard: AgentChatToolGuard;
  readonly tools: AgentChatTools;
  readonly read: ReturnType<typeof vi.fn>;
  readonly send: ReturnType<typeof vi.fn>;
} {
  const read = vi.fn(async () => ({
    chatId: "x",
    messages: [],
    hasMore: false,
    isPaused: false,
  }));
  const send = vi.fn(async () => ({
    chatId: "secret-group",
    messageId: "sent",
    status: "replied" as const,
    reply: {
      id: "r",
      sender: { id: "a", name: "A", kind: "agent" as const },
      text: SECRET,
      createdAt: "2026-03-04T10:00:00.000Z",
    },
  }));
  const entry = (id: string): AgentChatEntry => ({
    id,
    kind: "group",
    name: id,
    participants: [],
    lastMessage: {
      id: `last-${id}`,
      sender: { id: "p", name: "P", kind: "human" },
      text: SECRET,
      createdAt: "2026-03-04T10:00:00.000Z",
    },
    unreadCount: 0,
    isPaused: false,
    lastActivityAt: "2026-03-04T10:00:00.000Z",
  });
  const tools: AgentChatTools = {
    list: vi.fn(async () => ({
      chats: [entry("group-own"), entry("secret-group"), entry("open-group")],
      nextCursor: null,
      totalUnread: 0,
    })),
    read,
    send,
  };
  const store = partialStub<unknown>({
    chats: () => ({
      isConfidentialConversation: vi.fn(
        async (agent: string, id: string) => id === "secret-group",
      ),
    }),
  }) as EmployeeStore;
  return { guard: new AgentChatToolGuard({ store }), tools, read, send };
}

const SCOPE = { agentId: "agent", conversationId: "group-own" };
const CONTEXT = {
  reachability: { canReach: vi.fn(async () => true) },
  signal: new AbortController().signal,
};

it("keeps a confidential chat out of every other session of the agent: it reads as a chat that does not exist", async () => {
  const { guard, tools, read } = guardFixture();
  const guarded = guard.tools(tools, SCOPE);
  await expect(
    guarded.read("agent", { chatId: "secret-group", beforeMessageId: null }),
  ).rejects.toMatchObject({ code: "chat_not_found" });
  expect(read).not.toHaveBeenCalled();
  await expect(
    guarded.read("agent", { chatId: "open-group", beforeMessageId: null }),
  ).resolves.toMatchObject({ hasMore: false });
  const list = await guarded.list("agent", { cursor: null });
  const byId = new Map(list.chats.map((chat) => [chat.id, chat]));
  expect(byId.get("secret-group")?.lastMessage).toBeNull();
  expect(byId.get("open-group")?.lastMessage?.text).toBe(SECRET);
  expect(
    JSON.stringify(list.chats.find((chat) => chat.id === "secret-group")),
  ).not.toContain(SECRET);
});

it("lets the session of a confidential chat read its own chat", async () => {
  const { guard, tools, read } = guardFixture();
  const own = guard.tools(tools, {
    agentId: "agent",
    conversationId: "secret-group",
  });
  await own.read("agent", { chatId: "secret-group", beforeMessageId: null });
  expect(read).toHaveBeenCalledOnce();
  const list = await own.list("agent", { cursor: null });
  expect(
    list.chats.find((chat) => chat.id === "secret-group")?.lastMessage?.text,
  ).toBe(SECRET);
});

it("returns no reply of a confidential chat to the session that wrote into it", async () => {
  const { guard, tools, send } = guardFixture();
  const guarded = guard.tools(tools, SCOPE);
  const known = await guarded.send(
    "agent",
    {
      chatId: "secret-group",
      text: "Hallo",
      waitForReply: true,
      timeoutSeconds: 30,
    },
    CONTEXT,
  );
  // The session does not even wait for the reply.
  expect(send.mock.calls[0]?.[1]).toMatchObject({ waitForReply: false });
  expect(known).toEqual({
    chatId: "secret-group",
    messageId: "sent",
    status: "sent",
  });
  const byTarget = await guarded.send(
    "agent",
    {
      target: { type: "group", id: "g" },
      text: "Hallo",
      waitForReply: true,
      timeoutSeconds: 30,
    },
    CONTEXT,
  );
  expect(byTarget.reply).toBeUndefined();
  expect(JSON.stringify(byTarget)).not.toContain(SECRET);
});

it("refuses the stored context of another confidential group", async () => {
  const { guard } = guardFixture();
  const read = vi.fn(async () => ({ summary: SECRET }));
  const reader = guard.contextReader(read, SCOPE);
  await expect(
    reader({ conversationId: "secret-group" }),
  ).rejects.toBeInstanceOf(ConversationError);
  expect(read).not.toHaveBeenCalled();
  await expect(reader({ conversationId: "open-group" })).resolves.toEqual({
    summary: SECRET,
  });
  await expect(reader({ conversationId: "group-own" })).resolves.toBeDefined();
});

function readerFixture(): AgentChatReader {
  const accounts = new ConversationAccounts(
    new Map([
      [
        "person",
        {
          user: partialStub<never>({ id: "person" }),
          participant: {
            id: "person",
            name: "Igor",
            kind: "human",
            color: null,
          },
          role: "",
          isAvailable: true,
        },
      ],
    ]),
  );
  const all = [1, 2, 3, 4, 5].map((sequence) =>
    message(sequence, `Text ${String(sequence)}`),
  );
  return new AgentChatReader({
    messages: {
      messages: vi.fn(async () =>
        [1, 2, 3].map((index) => ({
          id: `c${String(index)}`,
          role: index % 2 === 1 ? ("user" as const) : ("assistant" as const),
          content: `Direkt ${String(index)}`,
          createdAt: `2026-03-04T10:0${String(index)}:00.000Z`,
        })),
      ),
    },
    conversationMessages: {
      contentAfter: vi.fn(async (id: string, after: number, limit: number) =>
        all.filter((entry) => entry.sequence > after).slice(0, limit),
      ),
    },
    directory: { read: vi.fn(async () => accounts) },
  });
}

it("reads further messages of the own group after a number, with sender and time", async () => {
  const reader = readerFixture();
  const page = await reader.read(
    { sessionId: "s", kind: "group", chatId: "group-own" },
    "Ed",
    { ab: 1, limit: 2 },
  );
  expect(page.messages).toEqual([
    { nr: 2, from: "Igor", at: "2026-03-04T10:02:00.000Z", text: "Text 2" },
    { nr: 3, from: "Igor", at: "2026-03-04T10:03:00.000Z", text: "Text 3" },
  ]);
  expect(page.next).toBe(3);
  const last = await reader.read(
    { sessionId: "s", kind: "group", chatId: "group-own" },
    "Ed",
    { ab: 4 },
  );
  expect(last.messages.map((entry) => entry.nr)).toEqual([5]);
  expect(last.next).toBeNull();
});

it("reads the own direct chat from a position and names its senders", async () => {
  const reader = readerFixture();
  const page = await reader.read(
    { sessionId: "s", kind: "direct", chatId: "person" },
    "Ed",
    { ab: 1 },
  );
  expect(page.messages.map((entry) => [entry.nr, entry.from])).toEqual([
    [2, "Ed"],
    [3, "person"],
  ]);
  expect(page.next).toBeNull();
});
