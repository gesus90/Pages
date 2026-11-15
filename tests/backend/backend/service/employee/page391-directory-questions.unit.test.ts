import { describe, expect, it, vi } from "vitest";

import { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import { ChatDirectoryService } from "@/backend/service/employee/ChatDirectoryService";

import type { Database } from "@/backend/database/Database";
import type { AgentQuestionView } from "@/definition/AgentChatQuestion";
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

function message(id: string, clientMessageId: string): ConversationMessage {
  return {
    id,
    conversationId: "group-1",
    clientMessageId,
    sender: { id: "agent", kind: "agent", name: "Ada", color: null },
    text: "❓ Welche Datenbank?\n- PostgreSQL (empfohlen)\n- SQLite",
    createdAt: "2026-11-15T12:00:00.000Z",
    mentions: [],
    attachments: [],
    links: [],
  };
}

const QUESTION: AgentQuestionView = {
  id: "question-1",
  status: "answered",
  items: [
    {
      id: "q1",
      text: "Welche Datenbank?",
      options: [
        { id: "o2", label: "PostgreSQL", isRecommended: true },
        { id: "o1", label: "SQLite", isRecommended: false },
      ],
      isMultipleChoice: false,
    },
  ],
  confirmsTool: null,
  answers: [{ questionId: "q1", optionIds: ["o2"], freeText: null }],
  answeredBy: { id: "person", name: "Person" },
  answeredAt: "2026-11-15T12:01:00.000Z",
  expiresAt: "2026-11-15T12:15:00.000Z",
  canAnswer: false,
};

describe("PAGE-391 cards of questions on the chat page", () => {
  it("adds the card of a question to its message and marks an interim message", async () => {
    const database = {
      query: vi.fn(),
      execute: vi.fn(),
      transaction: vi.fn(),
    } as unknown as Database;
    const views = vi.fn(async () => new Map([["m-question", QUESTION]]));
    const service = new ChatDirectoryService({
      store: new EmployeeStore(database),
      users: { findAll: vi.fn().mockResolvedValue([person]) },
      lookups: { listActiveUsers: vi.fn().mockResolvedValue([person]) },
      messages: { messages: vi.fn().mockResolvedValue([]) },
      conversations: {
        views: vi.fn().mockResolvedValue([]),
        history: vi.fn().mockResolvedValue({
          conversationId: "group-1",
          messages: [
            message("m-interim", "agent-interim-1"),
            message("m-question", "agent-question-question-1"),
          ],
          hasMore: false,
        }),
      },
      isWorking: vi.fn().mockResolvedValue(false),
      questions: { views },
    });
    const page = await service.olderMessages(person, {
      conversationId: "group-1",
      beforeId: "m-later",
    });
    expect(views).toHaveBeenCalledWith(person, ["m-interim", "m-question"]);
    expect(page.messages[0]).toMatchObject({ id: "m-interim", isInterim: true });
    expect(page.messages[0]?.question).toBeUndefined();
    expect(page.messages[1]).toMatchObject({ id: "m-question", question: QUESTION });
  });
});
