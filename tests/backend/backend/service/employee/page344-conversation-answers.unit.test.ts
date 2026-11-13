import { Readable } from "node:stream";

import { expect, it, vi } from "vitest";

import { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import { AgentConversationAnswers } from "@/backend/service/employee/AgentConversationAnswers";

import { OWNER } from "../chat/page48-chat-fixture";

import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { AgentConversationAnswerDependencies } from "@/backend/service/employee/AgentConversationAnswers";
import type { ConversationAgentRequest } from "@/backend/service/conversation/ConversationAgentReplies";
import type { ChatJob } from "@/definition/ChatJob";

const agent = { ...OWNER, id: "agent", isAgent: true };
const employee: StoredAgentEmployee = {
  userId: agent.id,
  connectionId: "connection",
  model: "model",
  reasoningEffort: null,
  access: "pages",
  soul: "",
  instructions: "",
  memory: "",
  dream: "",
  isLearningEnabled: false,
  learningIntervalHours: 24,
  learnedThrough: null,
  lastLearningAt: null,
  lastLearningResult: null,
  revision: 1,
  createdAt: "today",
  updatedAt: "today",
  voiceId: null,
  voiceSpeedTenths: 10,
  memoryCharacters: 1000,
  dreamCharacters: 1000,
};
const completed: ChatJob = {
  id: "job",
  sessionId: "group-session",
  state: "completed",
  errorCode: null,
  createdAt: "today",
  endedAt: "today",
  usage: { context: null, tokens: null, cost: null },
};

function fixture(): {
  dependencies: AgentConversationAnswerDependencies;
  service: AgentConversationAnswers;
} {
  const store = new EmployeeStore({
    query: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  });
  const employees = store.employees();
  vi.spyOn(employees, "find").mockResolvedValue(employee);
  vi.spyOn(store, "employees").mockReturnValue(employees);
  const dependencies: AgentConversationAnswerDependencies = {
    store,
    users: { findById: vi.fn(async () => agent) },
    sessions: {
      run: vi.fn(async () => ({
        sessionId: completed.sessionId,
        start: { job: completed, messageId: "message" },
      })),
      job: vi.fn(async () => completed),
      admit: vi.fn(),
      stopSession: vi.fn(),
    },
    messages: {
      messages: vi.fn<
        AgentConversationAnswerDependencies["messages"]["messages"]
      >(async () => [
        {
          id: "answer",
          role: "assistant",
          content: "Complete answer",
          createdAt: "today",
        },
      ]),
    },
    simulation: null,
    wait: vi.fn(),
  };
  return { dependencies, service: new AgentConversationAnswers(dependencies) };
}

function request(): ConversationAgentRequest {
  return {
    agent,
    person: OWNER,
    conversation: { id: "group", kind: "group", name: "Team" },
    prompt: "Question",
    lastMessage: "Question",
    prepareTurn: vi.fn(async () => ({
      prompt: "All 30 messages",
      attachments: [],
      throughSequence: 31,
    })),
    openAttachment: vi.fn(async () => Readable.from([Buffer.from("image")])),
  };
}

it("PAGE-344 forwards deferred context preparation through the conversation runner into the employee job", async () => {
  const { service, dependencies } = fixture();
  const input = request();
  await expect(service.answer(input)).resolves.toBe("Complete answer");
  const started = vi.mocked(dependencies.sessions.run).mock.calls[0]?.[0];
  if (!started?.prepareTurn) throw new Error("Missing deferred context");
  await expect(started.prepareTurn(1)).resolves.toMatchObject({
    text: "All 30 messages",
    throughSequence: 31,
  });
  expect(input.prepareTurn).toHaveBeenCalledWith(1);
  expect(started).toMatchObject({
    purpose: "conversation",
    conversationId: "group",
    agent,
  });
});

it("PAGE-344 preserves actual login loss from the job and refuses an inactive agent before starting", async () => {
  const { service, dependencies } = fixture();
  vi.mocked(dependencies.sessions.job).mockResolvedValue({
    ...completed,
    state: "failed",
    errorCode: "cli_not_logged_in",
  });
  await expect(service.answer(request())).rejects.toMatchObject({
    failureCode: "cli_not_logged_in",
  });
  vi.mocked(dependencies.users.findById).mockResolvedValue({
    ...agent,
    isActive: false,
  });
  await expect(service.answer(request())).rejects.toMatchObject({
    code: "inactive",
  });
  expect(dependencies.sessions.run).toHaveBeenCalledOnce();
});
