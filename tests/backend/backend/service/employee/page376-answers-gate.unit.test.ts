import { expect, it, vi } from "vitest";

import { AgentConversationAnswers } from "@/backend/service/employee/AgentConversationAnswers";
import { AgentSessionMemoryModel } from "@/backend/service/employee/AgentMemoryModel";

import type { ConversationAgentRequest } from "@/backend/service/conversation/ConversationAgentReplies";
import type { AgentConversationAnswerDependencies } from "@/backend/service/employee/AgentConversationAnswers";
import type { AgentSessionMemoryModelDependencies } from "@/backend/service/employee/AgentMemoryModel";
import type { User } from "@/definition/User";
import { partialStub } from "../../stub-fixture";

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
  displayName: "Ed",
  isAgent: true,
};

function request(throughSequence = 12): ConversationAgentRequest {
  return {
    agent,
    person,
    conversation: { id: "group-1", kind: "group", name: "Team" },
    prompt: "Neue Nachrichten",
    lastMessage: "Hallo",
    throughSequence,
  };
}

function answersFixture(simulation: object | null = null): {
  readonly answers: AgentConversationAnswers;
  readonly saveDelivered: ReturnType<typeof vi.fn>;
  readonly steerChat: ReturnType<typeof vi.fn>;
  readonly run: ReturnType<typeof vi.fn>;
} {
  const saveDelivered = vi.fn(async () => undefined);
  const steerChat = vi.fn(async () => true);
  const run = vi.fn(async () => ({
    sessionId: "session-1",
    start: { job: { id: "job" } },
  }));
  const dependencies = {
    store: {
      employees: () => ({ find: vi.fn(async () => ({ revision: 1 })) }),
      conversations: () => ({
        find: vi.fn(async () => ({ sessionId: "session-1" })),
      }),
      chatSessions: () => ({
        saveDelivered,
        delivered: vi.fn(async () => 9),
      }),
    },
    users: { findById: vi.fn(async () => agent) },
    sessions: {
      run,
      steerChat,
      job: vi.fn(async () => ({ state: "completed" })),
      admit: vi.fn(),
      stopSession: vi.fn(async () => undefined),
    },
    messages: {
      messages: vi.fn(async () => [
        { id: "a", role: "assistant", content: "Antwort" },
      ]),
    },
    simulation,
  };
  return {
    answers: new AgentConversationAnswers(
      dependencies as unknown as AgentConversationAnswerDependencies,
    ),
    saveDelivered,
    steerChat,
    run,
  };
}

it("tells which messages of a conversation the session of an agent received", async () => {
  const { answers } = answersFixture();
  await expect(answers.deliveredThrough("agent", "group-1")).resolves.toBe(9);
});

it("moves the position of the session forward once the round reached it", async () => {
  const { answers, saveDelivered, run } = answersFixture();
  await expect(answers.answer(request(12))).resolves.toBe("Antwort");
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      purpose: "conversation",
      conversationId: "group-1",
    }),
  );
  expect(saveDelivered).toHaveBeenCalledWith("session-1", 12);
});

it("steers a round into the running answer of the group's session and moves the position forward", async () => {
  const { answers, steerChat, saveDelivered } = answersFixture();
  await expect(answers.steer(request(15))).resolves.toBe(true);
  expect(steerChat).toHaveBeenCalledWith(
    agent,
    { purpose: "conversation", conversationId: "group-1" },
    "Neue Nachrichten",
  );
  expect(saveDelivered).toHaveBeenCalledWith("session-1", 15);
  steerChat.mockResolvedValueOnce(false);
  saveDelivered.mockClear();
  await expect(answers.steer(request(16))).resolves.toBe(false);
  expect(saveDelivered).not.toHaveBeenCalled();
});

it("steers nothing while the simulation answers", async () => {
  const { answers, steerChat } = answersFixture({ answer: vi.fn() });
  await expect(answers.steer(request())).resolves.toBe(false);
  expect(steerChat).not.toHaveBeenCalled();
});

function modelFixture(isFree: boolean): {
  readonly model: AgentSessionMemoryModel;
  readonly run: ReturnType<typeof vi.fn>;
  readonly whenOutOfChats: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn(async () => ({
    sessionId: "memory-session",
    start: { job: { id: "job" } },
  }));
  const whenOutOfChats = vi.fn(async () => isFree);
  const dependencies = {
    sessions: {
      run,
      job: vi.fn(async () => ({ state: "completed" })),
      whenOutOfChats,
    },
    messages: {
      messages: vi.fn(async () => [
        { id: "a", role: "assistant", content: "Die Lage des Chats" },
      ]),
    },
  };
  return {
    model: new AgentSessionMemoryModel(
      dependencies as unknown as AgentSessionMemoryModelDependencies,
    ),
    run,
    whenOutOfChats,
  };
}

const CALLER = {
  agent,
  employee: partialStub<never>({ revision: 1 }),
};
const SUMMARY_INPUT = {
  previous: null,
  messages: [{ from: "chat", text: "Hallo" }],
};

it("runs the upkeep of the memory only while the agent works in no chat", async () => {
  const busy = modelFixture(false);
  await expect(busy.model.summarize(CALLER, SUMMARY_INPUT)).resolves.toBeNull();
  expect(busy.whenOutOfChats).toHaveBeenCalledWith("agent");
  expect(busy.run).not.toHaveBeenCalled();

  const free = modelFixture(true);
  await expect(free.model.summarize(CALLER, SUMMARY_INPUT)).resolves.toBe(
    "Die Lage des Chats",
  );
  // A short run of its own in the memory session, never in a chat session.
  expect(free.run).toHaveBeenCalledWith(
    expect.objectContaining({ purpose: "memory", person: null }),
  );
});

it("does not hold back the summary a chat session writes before its restart", async () => {
  const busy = modelFixture(false);
  await expect(
    busy.model.summarize({ ...CALLER, runsNow: true }, SUMMARY_INPUT),
  ).resolves.toBe("Die Lage des Chats");
  expect(busy.whenOutOfChats).not.toHaveBeenCalled();
});
