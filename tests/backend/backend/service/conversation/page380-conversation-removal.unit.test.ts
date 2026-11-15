import { describe, expect, it, vi } from "vitest";

import { answerableMessage } from "@/backend/service/conversation/ConversationAnswerableMessage";
import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";
import {
  ConversationService,
  SYSTEM_LINE_PREFIX,
} from "@/backend/service/conversation/ConversationService";

import type { ConversationServiceDependencies } from "@/backend/service/conversation/ConversationService";
import type { ConversationMessage } from "@/definition/Conversation";
import type { User } from "@/definition/User";

const owner: User = {
  id: "igor",
  username: "igor",
  displayName: "Igor",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const igor = { id: "igor", name: "Igor", kind: "human", color: null } as const;
const ed = { id: "ed", name: "Ed", kind: "agent", color: null } as const;
const anna = { id: "anna", name: "Anna", kind: "human", color: null } as const;
const summary = {
  id: "team",
  kind: "group",
  name: "Team",
  members: [igor, ed, anna],
  lastMessage: null,
  lastActivityAt: "2026-11-14T00:00:00.000Z",
  unreadCount: 0,
  isMuted: false,
} as const;

function systemMessage(): ConversationMessage {
  return {
    id: "line",
    conversationId: "team",
    sender: igor,
    clientMessageId: `${SYSTEM_LINE_PREFIX}x`,
    text: "Igor hat Ed in diesem Chat auf Claude Opus 5.5 · hoch umgestellt.",
    mentions: [],
    createdAt: "2026-11-14T00:00:00.000Z",
    notice: "session_event",
    attachments: [],
    links: [],
  } as unknown as ConversationMessage;
}

function fixture(): {
  readonly removeFiles: ReturnType<typeof vi.fn>;
  readonly conversations: {
    removeMember: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  readonly messages: { insert: ReturnType<typeof vi.fn> };
  readonly attachments: { collectConversation: ReturnType<typeof vi.fn> };
  readonly files: { remove: ReturnType<typeof vi.fn> };
  readonly events: { publish: ReturnType<typeof vi.fn> };
  readonly service: ConversationService;
} {
  const removeFiles = vi.fn();
  const conversations = {
    removeMember: vi.fn(),
    remove: vi.fn().mockResolvedValue(["voice-1.wav"]),
  };
  const messages = {
    insert: vi.fn(async (message: Record<string, unknown>) => ({
      message: { ...message, sequence: 9 },
      isNew: true,
    })),
  };
  const attachments = {
    collectConversation: vi.fn().mockResolvedValue(removeFiles),
  };
  const files = { remove: vi.fn() };
  const events = { publish: vi.fn() };
  const dependencies = {
    conversations,
    messages,
    reader: {
      summary: vi.fn().mockResolvedValue(summary),
      messages: vi.fn().mockResolvedValue([systemMessage()]),
    },
    attachments,
    directory: {
      read: vi.fn().mockResolvedValue(new ConversationAccounts(new Map())),
    },
    files,
    events,
    publisher: { publish: vi.fn() },
    now: () => new Date("2026-11-14T00:00:00Z"),
    createId: () => "new-id",
  };
  return {
    conversations,
    messages,
    attachments,
    files,
    events,
    removeFiles,
    service: new ConversationService(
      dependencies as unknown as ConversationServiceDependencies,
    ),
  };
}

describe("system lines of a chat (PAGE-380)", () => {
  it("stores a line every member sees, which mentions nobody and asks no agent", async () => {
    const { service, messages, events } = fixture();
    await service.postSystemLine(owner, {
      conversationId: "team",
      text: "Igor hat Ed in diesem Chat auf Claude Opus 5.5 · hoch umgestellt.",
    });
    expect(messages.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "team",
        senderId: "igor",
        notice: "session_event",
        mentions: [],
        clientMessageId: `${SYSTEM_LINE_PREFIX}new-id`,
      }),
      { type: "conversation.changed", id: "team" },
    );
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "message",
        recipientIds: ["igor", "ed", "anna"],
      }),
    );
    // A system line never starts an answer or a decision.
    expect(
      answerableMessage({
        kind: "message",
        message: systemMessage(),
        recipientIds: ["igor", "ed", "anna"],
      }),
    ).toBeNull();
  });
});

describe("removing a member and a group (PAGE-380)", () => {
  it("takes a member out of the conversation and tells every former member", async () => {
    const { service, conversations, events } = fixture();
    await service.removeMember(owner, {
      conversationId: "team",
      memberId: "anna",
    });
    expect(conversations.removeMember).toHaveBeenCalledWith("team", "anna", {
      type: "conversation.changed",
      id: "team",
    });
    expect(events.publish).toHaveBeenCalledWith({
      kind: "conversation",
      conversationId: "team",
      recipientIds: ["igor", "ed", "anna"],
    });
    await expect(
      service.removeMember(owner, { conversationId: "team", memberId: "igor" }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("deletes the group with its history, attachments and voice files for good", async () => {
    const { service, conversations, attachments, removeFiles, files, events } =
      fixture();
    await service.removeGroup(owner, "team");
    expect(attachments.collectConversation).toHaveBeenCalledWith("team");
    expect(conversations.remove).toHaveBeenCalledWith("team", {
      type: "conversation.changed",
      id: "team",
    });
    expect(removeFiles).toHaveBeenCalledOnce();
    expect(files.remove).toHaveBeenCalledWith(["voice-1.wav"]);
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "conversation", conversationId: "team" }),
    );
  });
});
