import { expect, it, vi } from "vitest";

import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";
import { ConversationService } from "@/backend/service/conversation/ConversationService";

import type { ConversationServiceDependencies } from "@/backend/service/conversation/ConversationService";
import type { Mock } from "vitest";
import type { User } from "@/definition/User";

const person: User = {
  id: "person",
  username: "person",
  displayName: "Person",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const partner: User = { ...person, id: "partner", username: "partner" };
const participant = {
  id: "person",
  name: "Person",
  kind: "human",
  color: null,
} as const;
const other = {
  id: "partner",
  name: "Partner",
  kind: "human",
  color: null,
} as const;
const summary = {
  id: "group",
  kind: "group",
  name: "Group",
  members: [participant, other],
  lastMessage: null,
  lastActivityAt: "2026-01-01T00:00:00.000Z",
  unreadCount: 0,
  isMuted: false,
} as const;
const stored = {
  id: "message",
  sequence: 2,
  conversationId: "group",
  senderId: "person",
  clientMessageId: "client",
  text: "Hello",
  mentions: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  voice: null,
  notice: null,
};
const sent = { ...stored, sender: participant };

function fixture(): {
  service: ConversationService;
  conversations: Record<
    "findDirect" | "create" | "exists" | "addMembers" | "markRead" | "setMuted",
    Mock
  >;
  messages: Record<"insert" | "find" | "findById" | "remove", Mock>;
  attachments: Record<"bind" | "collect", Mock>;
  events: { publish: Mock };
  publisher: { publish: Mock };
} {
  const accounts = new ConversationAccounts(
    new Map([
      [
        "partner",
        { user: partner, participant: other, role: "", isAvailable: true },
      ],
    ]),
  );
  const conversations = {
    findDirect: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "group", isNew: true }),
    exists: vi.fn().mockResolvedValue(true),
    addMembers: vi.fn(),
    markRead: vi.fn(),
    setMuted: vi.fn(),
  };
  const messages = {
    insert: vi.fn().mockResolvedValue({ message: stored, isNew: true }),
    find: vi.fn().mockResolvedValue(stored),
    findById: vi.fn().mockResolvedValue(stored),
    remove: vi.fn().mockResolvedValue(stored),
  };
  const reader = {
    summary: vi.fn().mockResolvedValue(summary),
    memberIds: vi.fn().mockResolvedValue(["person"]),
    messages: vi.fn().mockResolvedValue([sent]),
    readState: vi.fn().mockResolvedValue({ unreadCount: 0 }),
  };
  const attachments = {
    bind: vi.fn(),
    collect: vi.fn().mockResolvedValue(vi.fn()),
  };
  const voices = { discard: vi.fn(), declare: vi.fn(), store: vi.fn() };
  const events = { publish: vi.fn() };
  const publisher = { publish: vi.fn() };
  const dependencies = {
    conversations,
    messages,
    reader,
    attachments,
    voices,
    events,
    publisher,
    directory: { read: vi.fn().mockResolvedValue(accounts) },
    files: { open: vi.fn() },
    transcriber: { transcribe: vi.fn() },
    now: () => new Date("2026-01-01T00:00:00Z"),
    createId: () => "new-id",
  };
  return {
    ...dependencies,
    service: new ConversationService(
      dependencies as unknown as ConversationServiceDependencies,
    ),
  };
}

it("creates a group with unique participants and announces the committed conversation", async () => {
  const { service, conversations, events, publisher } = fixture();
  await expect(
    service.create(
      person,
      { kind: "group", participantIds: ["partner", "partner"], name: " Team " },
      { originId: "phone" },
    ),
  ).resolves.toEqual(summary);
  expect(conversations.create).toHaveBeenCalledWith(
    {
      id: "new-id",
      kind: "group",
      name: "Team",
      directKey: null,
      memberIds: ["person", "partner"],
      createdBy: "person",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    { type: "conversation.changed", id: "new-id" },
  );
  expect(events.publish).toHaveBeenCalledWith({
    kind: "conversation",
    conversationId: "group",
    recipientIds: ["person", "partner"],
    originId: "phone",
  });
  expect(publisher.publish).toHaveBeenCalledWith({
    type: "conversation.changed",
    id: "group",
  });
});

it("rejects invalid participants and group names without writing", async () => {
  const { service, conversations } = fixture();
  for (const creation of [
    { kind: "direct", participantIds: ["person"] },
    { kind: "direct", participantIds: [] },
    { kind: "group", participantIds: ["unknown"], name: "Team" },
    { kind: "group", participantIds: ["partner"], name: "  " },
  ] as const) {
    await expect(service.create(person, creation)).rejects.toMatchObject({
      code: "invalid",
    });
  }
  expect(conversations.create).not.toHaveBeenCalled();
});

it("opens an existing direct conversation without creating or announcing it", async () => {
  const { service, conversations, events } = fixture();
  conversations.findDirect.mockResolvedValue("existing");
  await expect(service.openDirect(person, "partner")).resolves.toEqual(summary);
  expect(conversations.findDirect).toHaveBeenCalledWith("partner:person");
  expect(conversations.create).not.toHaveBeenCalled();
  expect(events.publish).not.toHaveBeenCalled();
});

it("sends trimmed text once and does not announce a repeated client ID", async () => {
  const { service, messages, attachments, events } = fixture();
  const input = {
    conversationId: "group",
    clientMessageId: "client",
    text: " Hello ",
  };
  await expect(
    service.send(person, input, { originId: "phone" }),
  ).resolves.toEqual(sent);
  expect(messages.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      text: "Hello",
      senderId: "person",
      clientMessageId: "client",
    }),
    { type: "conversation.changed", id: "group" },
  );
  expect(attachments.bind).toHaveBeenCalledWith(stored, []);
  expect(events.publish).toHaveBeenCalledWith({
    kind: "message",
    message: sent,
    recipientIds: ["person", "partner"],
    originId: "phone",
  });
  messages.insert.mockResolvedValueOnce({ message: stored, isNew: false });
  await service.send(person, input);
  expect(attachments.bind).toHaveBeenCalledTimes(1);
  expect(events.publish).toHaveBeenCalledTimes(1);
});

it("refuses invalid text and rolls back a message when attachment binding fails", async () => {
  const { service, messages, attachments, events } = fixture();
  await expect(
    service.send(person, {
      conversationId: "group",
      clientMessageId: "client",
      text: " ",
    }),
  ).rejects.toMatchObject({ code: "invalid" });
  await expect(
    service.send(person, {
      conversationId: "group",
      clientMessageId: "client",
      text: "x".repeat(16001),
    }),
  ).rejects.toMatchObject({ code: "too_long" });
  const failure = new Error("binding failed");
  attachments.bind.mockRejectedValueOnce(failure);
  await expect(
    service.send(person, {
      conversationId: "group",
      clientMessageId: "client",
      text: "Hello",
    }),
  ).rejects.toBe(failure);
  expect(messages.remove).toHaveBeenCalledWith(stored, {
    type: "conversation.changed",
    id: "group",
  });
  expect(events.publish).not.toHaveBeenCalled();
});

it("marks read and mutes only for the requesting member", async () => {
  const { service, conversations, events } = fixture();
  await service.markRead(
    person,
    { conversationId: "group", upToMessageId: "message" },
    { originId: "phone" },
  );
  expect(conversations.markRead).toHaveBeenCalledWith("group", "person", 2);
  expect(events.publish).toHaveBeenCalledWith({
    kind: "read",
    conversationId: "group",
    upToMessageId: "message",
    recipientIds: ["person"],
    originId: "phone",
  });
  await service.setMuted(person, { conversationId: "group", isMuted: true });
  expect(conversations.setMuted).toHaveBeenCalledWith("group", "person", true);
  expect(events.publish).toHaveBeenLastCalledWith({
    kind: "conversation",
    conversationId: "group",
    recipientIds: ["person"],
    originId: undefined,
  });
});

it("does not remove files when deletion is refused and removes them after success", async () => {
  const { service, messages, attachments, events } = fixture();
  const removeFiles = vi.fn();
  attachments.collect.mockResolvedValue(removeFiles);
  messages.remove.mockResolvedValueOnce(null);
  await expect(service.deleteMessage(person, "message")).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(removeFiles).not.toHaveBeenCalled();
  await service.deleteMessage(person, "message");
  expect(removeFiles).toHaveBeenCalledOnce();
  expect(events.publish).toHaveBeenCalledWith({
    kind: "conversation",
    conversationId: "group",
    recipientIds: ["person", "partner"],
    originId: undefined,
  });
});
