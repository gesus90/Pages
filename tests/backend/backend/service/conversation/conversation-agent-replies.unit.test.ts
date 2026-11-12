import { expect, it, vi } from "vitest";

import { ConversationRoundRepository } from "@/backend/database/repositories/conversation/ConversationRoundRepository";
import { ConversationAgentReplies } from "@/backend/service/conversation/ConversationAgentReplies";
import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";

import type { ConversationAgentRepliesDependencies } from "@/backend/service/conversation/ConversationAgentReplies";
import type { ConversationMessage } from "@/definition/Conversation";
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
  lastActivityAt: "today",
  isMuted: false,
  unreadCount: 0,
} as const;
const message: ConversationMessage = {
  id: "origin",
  conversationId: "group",
  clientMessageId: "client",
  sender: { id: "person", kind: "human", name: "Person", color: null },
  text: "Question",
  createdAt: "today",
  mentions: [],
  attachments: [],
  links: [],
};

function fixture(): {
  service: ConversationAgentReplies;
  dependencies: ConversationAgentRepliesDependencies;
  rounds: ConversationRoundRepository;
} {
  const accounts = new ConversationAccounts(
    new Map([
      [
        person.id,
        {
          user: person,
          participant: message.sender,
          role: "",
          isAvailable: true,
        },
      ],
      [
        agent.id,
        {
          user: agent,
          participant: {
            id: agent.id,
            name: agent.displayName,
            kind: "agent",
            color: null,
          },
          role: "Research",
          isAvailable: true,
        },
      ],
    ]),
  );
  const rounds = new ConversationRoundRepository({
    query: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  });
  vi.spyOn(rounds, "claim").mockResolvedValue("duplicate");
  vi.spyOn(rounds, "round").mockResolvedValue(null);
  vi.spyOn(rounds, "claimRouting").mockResolvedValue(true);
  vi.spyOn(rounds, "finishRouting").mockResolvedValue(undefined);
  vi.spyOn(rounds, "interruptStale").mockResolvedValue(2);
  const dependencies: ConversationAgentRepliesDependencies = {
    conversations: { findForMember: vi.fn().mockResolvedValue(conversation) },
    messages: { find: vi.fn(), history: vi.fn(), insert: vi.fn() },
    directory: { read: vi.fn().mockResolvedValue(accounts) },
    runner: { answer: vi.fn() },
    rounds,
    contexts: { promptContext: vi.fn() },
    routing: {
      choose: vi
        .fn()
        .mockResolvedValue([{ agentId: "agent", reason: "expertise" }]),
    },
    replySettings: { find: vi.fn().mockResolvedValue({ mode: "observer" }) },
    decisions: {
      decide: vi
        .fn()
        .mockResolvedValue([
          { agentId: "agent", trigger: "fallback", reason: "default" },
        ]),
    },
    events: { subscribe: vi.fn().mockReturnValue(vi.fn()), publish: vi.fn() },
    publisher: { publish: vi.fn() },
    agentFiles: { select: vi.fn(), open: vi.fn() },
    attachments: { stage: vi.fn(), bind: vi.fn(), release: vi.fn() },
    content: { describe: vi.fn() },
    now: () => new Date("2026-01-01T00:00:00Z"),
  };
  return {
    service: new ConversationAgentReplies(dependencies),
    dependencies,
    rounds,
  };
}

it("deduplicates valid mentions and claims each agent once", async () => {
  const { service, dependencies, rounds } = fixture();
  await service.answer(
    { ...message, mentions: ["agent", "agent", "person", "unknown"] },
    ["person", "agent"],
  );
  expect(rounds.claim).toHaveBeenCalledOnce();
  expect(rounds.claim).toHaveBeenCalledWith(
    expect.objectContaining({
      agentId: "agent",
      trigger: "mention",
      isAutomatic: false,
      originMessageId: "origin",
    }),
  );
  expect(dependencies.routing.choose).not.toHaveBeenCalled();
  expect(dependencies.runner.answer).not.toHaveBeenCalled();
});

it("routes an unmentioned group message and records the observer selection", async () => {
  const { service, dependencies, rounds } = fixture();
  await service.answer(message, ["person", "agent"]);
  expect(dependencies.routing.choose).toHaveBeenCalledWith(
    expect.objectContaining({
      candidates: [
        { id: "agent", name: "Agent", username: "agent", role: "Research" },
      ],
      handoff: null,
    }),
  );
  expect(rounds.finishRouting).toHaveBeenCalledWith(
    "origin",
    expect.objectContaining({
      state: "routed",
      selection: [{ agentId: "agent", reason: "expertise" }],
    }),
  );
  expect(rounds.claim).toHaveBeenCalledWith(
    expect.objectContaining({
      agentId: "agent",
      trigger: "context",
      isAutomatic: true,
    }),
  );
});

it("uses decision mode and honors mentions-only mode", async () => {
  const { service, dependencies, rounds } = fixture();
  vi.mocked(dependencies.replySettings.find).mockResolvedValueOnce({
    mode: "decision",
    conversationId: "group",
    defaultResponderId: null,
    maximumResponders: 1,
  });
  await service.answer(message, ["person", "agent"]);
  expect(dependencies.decisions.decide).toHaveBeenCalledOnce();
  expect(rounds.claim).toHaveBeenCalledWith(
    expect.objectContaining({ trigger: "fallback", reason: "default" }),
  );
  vi.mocked(dependencies.replySettings.find).mockResolvedValueOnce({
    mode: "mentions",
    conversationId: "group",
    defaultResponderId: null,
    maximumResponders: 1,
  });
  await service.answer(message, ["person", "agent"]);
  expect(rounds.claim).toHaveBeenCalledOnce();
});

it("claims a direct partner and ignores unknown senders or missing conversations", async () => {
  const { service, dependencies, rounds } = fixture();
  vi.mocked(dependencies.conversations.findForMember).mockResolvedValueOnce({
    ...conversation,
    kind: "direct",
  });
  await service.answer(message, ["person", "agent"]);
  expect(rounds.claim).toHaveBeenCalledWith(
    expect.objectContaining({ agentId: "agent", trigger: "direct" }),
  );
  await service.answer(
    { ...message, sender: { ...message.sender, id: "unknown" } },
    ["person", "agent"],
  );
  vi.mocked(dependencies.conversations.findForMember).mockResolvedValueOnce(
    null,
  );
  await service.answer(message, ["person", "agent"]);
  expect(rounds.claim).toHaveBeenCalledOnce();
});

it("records observer failure without starting an agent", async () => {
  const { service, dependencies, rounds } = fixture();
  vi.mocked(dependencies.routing.choose).mockRejectedValueOnce(
    new Error("observer unavailable"),
  );
  await service.answer(message, ["person", "agent"]);
  expect(rounds.finishRouting).toHaveBeenCalledWith(
    "origin",
    expect.objectContaining({
      state: "failed",
      selection: [],
      errorCode: "observer_failed",
    }),
  );
  expect(rounds.claim).not.toHaveBeenCalled();
});

it("requires membership to stop and interrupts stale work during recovery", async () => {
  const { service, dependencies, rounds } = fixture();
  expect(await service.stop(person, "group", "agent")).toBe(false);
  vi.mocked(dependencies.conversations.findForMember).mockResolvedValueOnce(
    null,
  );
  await expect(service.stop(person, "group", "agent")).rejects.toMatchObject({
    code: "not_found",
  });
  await service.recover(new Date("2026-01-01T00:00:00Z"));
  expect(rounds.interruptStale).toHaveBeenCalledWith(
    "2026-01-01T00:00:00.000Z",
  );
  expect(service.workingAgentIds("group")).toEqual([]);
  expect(service.queuedMessages("group").size).toBe(0);
});
