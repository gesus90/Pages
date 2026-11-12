import { vi } from "vitest";

import { ConversationRoundRepository } from "@/backend/database/repositories/conversation/ConversationRoundRepository";
import { ConversationAgentReplies } from "@/backend/service/conversation/ConversationAgentReplies";
import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";
import { ConversationEvents } from "@/backend/service/conversation/ConversationEvents";
import { toConversationMessage } from "@/backend/service/conversation/ConversationReader";
import { conversationRoundLimits } from "@/definition/ConversationObserver";

import type { ConversationFollowUp } from "@/backend/database/repositories/conversation/ConversationFollowUpRepository";
import type {
  NewConversationMessage,
  StoredConversationMessage,
} from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type { ConversationReplyClaim } from "@/backend/database/repositories/conversation/ConversationRoundRepository";
import type { ConversationAgentRepliesDependencies } from "@/backend/service/conversation/ConversationAgentReplies";
import type { User } from "@/definition/User";

const person: User = {
  id: "person",
  username: "person",
  displayName: "Person",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const conversation = {
  id: "group",
  kind: "group",
  name: "Team",
  lastActivityAt: "today",
  isMuted: false,
  unreadCount: 0,
} as const;

function mockRounds(
  rounds: ConversationRoundRepository,
  claims: ConversationReplyClaim[],
): () => boolean {
  let endedAt: string | null = null;
  vi.spyOn(rounds, "claim").mockImplementation(async (claim) => {
    const own = claims.filter((previous) => previous.agentId === claim.agentId);
    if (
      own.some(
        (previous) => previous.triggerMessageId === claim.triggerMessageId,
      )
    )
      return "duplicate";
    if (own.length > 0 && !claim.isFollowUp) return "duplicate";
    const limits = conversationRoundLimits(claim.limits ?? {});
    if (
      endedAt ||
      own.length >= limits.repliesPerAgentPerOrigin ||
      claims.length >= limits.automaticRepliesPerOrigin
    )
      return "limit";
    if (
      claim.isFollowUp &&
      !(await rounds.followUps.consume(claim.triggerMessageId, claim.createdAt))
    )
      return "duplicate";
    claims.push(claim);
    return "claimed";
  });
  vi.spyOn(rounds, "setTargetState").mockResolvedValue(undefined);
  vi.spyOn(rounds, "round").mockImplementation(async () => ({
    personId: person.id,
    automaticCount: claims.filter((claim) => claim.isAutomatic).length,
    replyCount: claims.length,
    agentIds: claims.map((claim) => claim.agentId),
    endedAt,
  }));
  vi.spyOn(rounds, "end").mockImplementation(async (originMessageId, now) => {
    endedAt = now;
  });
  vi.spyOn(rounds, "unannouncedEnds").mockResolvedValue([]);
  vi.spyOn(rounds, "interruptStale").mockResolvedValue(0);
  return () => endedAt !== null;
}

function mockBatches({
  rounds,
  questions,
  stored,
  isEnded,
}: {
  readonly rounds: ConversationRoundRepository;
  readonly questions: Map<string, ConversationFollowUp>;
  readonly stored: StoredConversationMessage[];
  readonly isEnded: () => boolean;
}): void {
  const consumed = new Set<string>();
  vi.spyOn(rounds.followUps, "open").mockImplementation(async (question) => {
    if (questions.has(question.questionMessageId)) return;
    questions.set(question.questionMessageId, {
      ...question,
      personId: person.id,
      answers: question.askedAgentIds.map((agentId) => ({
        agentId,
        replyMessageId: null,
      })),
    });
  });
  vi.spyOn(rounds.followUps, "record").mockImplementation(
    async (originMessageId, reply) => {
      for (const question of questions.values()) {
        if (
          consumed.has(question.questionMessageId) ||
          !reply.mentions.includes(question.agentId)
        )
          continue;
        const answer = question.answers.find(
          (entry) => entry.agentId === reply.senderId,
        );
        if (answer?.replyMessageId === null)
          question.answers.splice(question.answers.indexOf(answer), 1, {
            ...answer,
            replyMessageId: reply.id,
          });
      }
    },
  );
  vi.spyOn(rounds.followUps, "pending").mockImplementation(async () =>
    isEnded()
      ? []
      : [...questions.values()].filter(
          (question) => !consumed.has(question.questionMessageId),
        ),
  );
  vi.spyOn(rounds.followUps, "consume").mockImplementation(async (id) => {
    if (consumed.has(id)) return false;
    consumed.add(id);
    return true;
  });
  vi.spyOn(rounds.followUps, "context").mockImplementation(
    async (originMessageId, id) =>
      stored
        .filter(
          (entry) =>
            entry.sequence >
              (stored.find((candidate) => candidate.id === id)?.sequence ??
                0) && entry.notice === null,
        )
        .map((entry) => entry.id),
  );
}

function mockMessages(
  stored: StoredConversationMessage[],
): ConversationAgentRepliesDependencies["messages"] {
  return {
    find: vi.fn(
      async (conversationId: string, id: string) =>
        stored.find((entry) => entry.id === id) ?? null,
    ),
    history: vi.fn(
      async (conversationId: string, before: number | null, limit: number) =>
        stored
          .filter((entry) => before === null || entry.sequence < before)
          .slice(-limit)
          .reverse(),
    ),
    insert: vi.fn(async (message: NewConversationMessage) => {
      const duplicate = stored.find(
        (entry) =>
          entry.senderId === message.senderId &&
          entry.clientMessageId === message.clientMessageId,
      );
      if (duplicate) return { message: duplicate, isNew: false };
      const entry = {
        ...message,
        notice: message.notice ?? null,
        sequence: stored.length + 1,
      };
      stored.push(entry);
      return { message: entry, isNew: true };
    }),
  };
}

function testAccounts(users: readonly User[]): ConversationAccounts {
  return new ConversationAccounts(
    new Map(
      users.map((user) => [
        user.id,
        {
          user,
          participant: {
            id: user.id,
            name: user.displayName,
            kind: user.isAgent ? "agent" : "human",
            color: null,
          },
          role: "",
          isAvailable: true,
        },
      ]),
    ),
  );
}

/** Mocked persistence boundaries; the production reply orchestration and runner stay real. */
export function followUpFixture(): {
  service: ConversationAgentReplies;
  dependencies: ConversationAgentRepliesDependencies;
  claims: ConversationReplyClaim[];
  questions: Map<string, ConversationFollowUp>;
  stored: StoredConversationMessage[];
  origin: ReturnType<typeof toConversationMessage>;
  memberIds: string[];
} {
  const users = [
    person,
    ...["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((id) => ({
      ...person,
      id,
      username: id,
      displayName: id.toUpperCase(),
      isAgent: true,
    })),
  ];
  const accounts = testAccounts(users);
  const stored: StoredConversationMessage[] = [
    {
      id: "origin",
      sequence: 1,
      conversationId: "group",
      senderId: "person",
      clientMessageId: "client",
      text: "@a Bitte abstimmen",
      mentions: ["a"],
      createdAt: new Date().toISOString(),
      voice: null,
      notice: null,
    },
  ];
  const claims: ConversationReplyClaim[] = [];
  const questions = new Map<string, ConversationFollowUp>();
  const rounds = new ConversationRoundRepository({
    query: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  });
  const isEnded = mockRounds(rounds, claims);
  mockBatches({ rounds, questions, stored, isEnded });
  const dependencies: ConversationAgentRepliesDependencies = {
    conversations: {
      findForMember: vi.fn().mockResolvedValue(conversation),
      memberIds: vi
        .fn()
        .mockResolvedValue(new Map([["group", users.map((user) => user.id)]])),
    },
    messages: mockMessages(stored),
    directory: { read: vi.fn().mockResolvedValue(accounts) },
    runner: { answer: vi.fn().mockResolvedValue("Fertig") },
    rounds,
    contexts: { promptContext: vi.fn().mockResolvedValue({ context: null }) },
    routing: { choose: vi.fn().mockResolvedValue([]) },
    replySettings: {
      find: vi.fn().mockResolvedValue({
        conversationId: "group",
        mode: "mentions",
        defaultResponderId: null,
        maximumResponders: 2,
      }),
    },
    decisions: { decide: vi.fn().mockResolvedValue([]) },
    events: new ConversationEvents(),
    publisher: { publish: vi.fn() },
    guard: { isPaused: vi.fn().mockResolvedValue(false) },
    agentFiles: {
      select: vi.fn(async (text: string) => ({
        text,
        lines: [text],
        files: [],
      })),
      open: vi.fn(),
    },
    attachments: { stage: vi.fn(), bind: vi.fn(), release: vi.fn() },
    content: { describe: vi.fn().mockResolvedValue(new Map()) },
  };
  const [origin] = stored;
  if (!origin) throw new Error("Missing fixture origin");
  return {
    service: new ConversationAgentReplies(dependencies),
    dependencies,
    claims,
    questions,
    stored,
    origin: toConversationMessage(origin, accounts),
    memberIds: users.map((user) => user.id),
  };
}
