import { expect, it, vi } from "vitest";

import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";
import { ConversationReplyRunner } from "@/backend/service/conversation/ConversationReplyRunner";

import type {
  ConversationReplyJob,
  ConversationReplyRunnerDependencies,
} from "@/backend/service/conversation/ConversationReplyRunner";
import type { StoredConversationMessage } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
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
const agent: User = {
  ...person,
  id: "agent",
  username: "agent",
  displayName: "Agent",
  isAgent: true,
};
const conversation = {
  id: "group",
  kind: "group",
  name: "Team",
  lastActivityAt: "2026-01-01",
  isMuted: false,
  unreadCount: 0,
} as const;
const message: StoredConversationMessage = {
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
const job: ConversationReplyJob = {
  round: {
    originMessageId: "origin",
    conversation,
    memberIds: ["person", "agent"],
    person,
  },
  agentId: "agent",
  trigger: "mention",
  triggerMessageId: "origin",
  reason: "asked",
};

function fixture(user: User = agent): {
  runner: ConversationReplyRunner;
  messages: Record<"find" | "history" | "insert", Mock>;
  rounds: { setTargetState: Mock };
  events: { publish: Mock };
  answer: Mock;
  dependencies: ConversationReplyRunnerDependencies;
} {
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
    find: vi.fn().mockResolvedValue(message),
    history: vi.fn().mockResolvedValue([message]),
    insert: vi.fn().mockResolvedValue({
      message: {
        ...message,
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
    conversations: { findForMember: vi.fn().mockResolvedValue(conversation) },
    messages,
    directory: { read: vi.fn().mockResolvedValue(accounts) },
    runner: { answer },
    rounds,
    contexts: { promptContext: vi.fn().mockResolvedValue({ context: null }) },
    events,
    publisher: { publish: vi.fn() },
    agentFiles: {
      select: vi.fn().mockResolvedValue({ text: "Answer", files: [] }),
      open: vi.fn(),
    },
    attachments: { attach: vi.fn() },
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

it("stores and announces an agent answer with its round state", async () => {
  const { runner, messages, rounds, events, answer } = fixture();
  const result = await runner.run(job);
  expect(result).toMatchObject({
    id: "answer",
    text: "Answer",
    sender: { id: "agent" },
  });
  expect(answer).toHaveBeenCalledWith(
    expect.objectContaining({ agent, person, lastMessage: "Question" }),
  );
  expect(messages.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      senderId: "agent",
      text: "Answer",
      notice: null,
    }),
    { type: "conversation.changed", id: "group" },
  );
  expect(rounds.setTargetState).toHaveBeenLastCalledWith(
    { originMessageId: "origin", agentId: "agent" },
    expect.objectContaining({ state: "answered", replyMessageId: "answer" }),
  );
  expect(events.publish).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "message",
      recipientIds: ["person", "agent"],
    }),
  );
  expect(runner.workingAgentIds("group")).toEqual([]);
});

it("refuses missing membership and stores an inactive notice", async () => {
  const missing = fixture();
  vi.mocked(
    missing.dependencies.conversations.findForMember,
  ).mockResolvedValueOnce(null);
  await expect(missing.runner.run(job)).resolves.toBeNull();
  expect(missing.rounds.setTargetState).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ state: "failed" }),
  );
  expect(missing.answer).not.toHaveBeenCalled();
  const inactive = fixture({ ...agent, isActive: false });
  await expect(inactive.runner.run(job)).resolves.toBeNull();
  expect(inactive.messages.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      notice: "agent_inactive",
      text: "Agent ist deaktiviert und antwortet nicht auf diese Nachricht.",
    }),
    expect.anything(),
  );
  expect(inactive.answer).not.toHaveBeenCalled();
});
