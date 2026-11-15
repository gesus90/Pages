import { vi } from "vitest";

import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";
import { ConversationReplyRunner } from "@/backend/service/conversation/ConversationReplyRunner";

import type { StoredConversationAttachment } from "@/backend/database/repositories/conversation/ConversationAttachmentRepository";
import type { StoredConversationMessage } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type {
  ConversationReplyJob,
  ConversationReplyRunnerDependencies,
} from "@/backend/service/conversation/ConversationReplyRunner";
import type { User } from "@/definition/User";
import type { Mock } from "vitest";

/** Default human participant fixture for reply runner tests. */
export const replyPerson: User = {
  id: "person",
  username: "person",
  displayName: "Person",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

/** Default agent participant fixture for reply runner tests. */
export const replyAgent: User = {
  ...replyPerson,
  id: "agent",
  username: "agent",
  displayName: "Agent",
  isAgent: true,
};

/** Default conversation fixture for reply runner tests. */
export const replyConversation = {
  id: "group",
  kind: "group",
  name: "Team",
  lastActivityAt: "2026-01-01",
  isMuted: false,
  unreadCount: 0,
} as const;

/** Default origin message fixture for reply runner tests. */
export const replyMessage: StoredConversationMessage = {
  id: "origin",
  sequence: 1,
  conversationId: "group",
  senderId: "person",
  clientMessageId: "client",
  text: "Question",
  mentions: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  voice: null,
  notice: null,
};

/** Default staged attachment fixture for reply runner tests. */
export const replyStagedAttachment: StoredConversationAttachment = {
  id: "attachment-1",
  conversationId: "group",
  messageId: null,
  uploaderId: "agent",
  name: "eins.png",
  mimeType: "image/png",
  sizeBytes: 3,
  storageName: "stored-1",
  position: 0,
  thumbnail: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

/** Default reply job fixture for reply runner tests. */
export const replyJob: ConversationReplyJob = {
  round: {
    originMessageId: "origin",
    conversation: replyConversation,
    memberIds: ["person", "agent"],
    person: replyPerson,
  },
  agentId: "agent",
  trigger: "mention",
  triggerMessageId: "origin",
  reason: "asked",
};

/** Result returned by {@link createReplyRunnerFixture}. */
export interface ReplyRunnerFixture {
  runner: ConversationReplyRunner;
  messages: Record<"find" | "history" | "insert" | "contextCount", Mock>;
  rounds: { setTargetState: Mock };
  events: { publish: Mock };
  answer: Mock;
  dependencies: ConversationReplyRunnerDependencies;
}

/** Creates an isolated reply runner fixture with mocked dependencies. */
export function createReplyRunnerFixture(
  user: User = replyAgent,
): ReplyRunnerFixture {
  const accounts = new ConversationAccounts(
    new Map([
      [
        "agent",
        {
          user,
          participant: {
            id: "agent",
            name: "Agent",
            kind: "agent",
            color: null,
          },
          role: "",
          isAvailable: true,
        },
      ],
    ]),
  );
  const messages = {
    find: vi.fn().mockResolvedValue(replyMessage),
    history: vi.fn().mockResolvedValue([replyMessage]),
    contextCount: vi.fn().mockResolvedValue(1),
    insert: vi.fn().mockResolvedValue({
      message: {
        ...replyMessage,
        id: "answer",
        senderId: "agent",
        text: "Answer",
      },
      isNew: true,
    }),
  };
  const rounds = { setTargetState: vi.fn().mockResolvedValue(undefined) };
  const events = { publish: vi.fn() };
  const answer = vi.fn().mockResolvedValue(" Answer ");
  const dependencies: ConversationReplyRunnerDependencies = {
    conversations: {
      findForMember: vi.fn().mockResolvedValue(replyConversation),
    },
    messages,
    directory: { read: vi.fn().mockResolvedValue(accounts) },
    runner: { answer },
    rounds,
    contexts: { promptContext: vi.fn().mockResolvedValue({ context: null }) },
    events,
    publisher: { publish: vi.fn() },
    agentFiles: {
      select: vi
        .fn()
        .mockResolvedValue({ text: "Answer", files: [], lines: ["Answer"] }),
      open: vi.fn(),
    },
    attachments: {
      stage: vi.fn(),
      bind: vi.fn(),
      release: vi.fn(),
      open: vi.fn(),
    },
    content: { describe: vi.fn().mockResolvedValue(new Map()) },
    now: () => new Date("2026-01-01T00:00:00Z"),
  };
  return {
    runner: new ConversationReplyRunner(dependencies),
    messages,
    rounds,
    events,
    answer,
    dependencies,
  };
}
