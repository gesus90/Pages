import { describe, expect, it, vi } from "vitest";

import { AgentChatQuestionRepository } from "@/backend/database/repositories/conversation/AgentChatQuestionRepository";

const ITEMS = [
  {
    id: "q1",
    text: "Löschen?",
    options: [
      { id: "o1", label: "Löschen", isRecommended: true },
      { id: "o2", label: "Abbrechen", isRecommended: false },
    ],
    isMultipleChoice: false,
  },
];

describe("PAGE-391 AgentChatQuestionRepository", () => {
  it("stores a question open and reads it back with its items and answer", async () => {
    const execute = vi.fn(async () => undefined);
    const query = vi.fn(async () => [
      [
        "question-1",
        "message-1",
        "group-1",
        "agent-1",
        JSON.stringify(ITEMS),
        "igor",
        "ticket.delete",
        "answered",
        JSON.stringify([{ questionId: "q1", optionIds: ["o1"], freeText: null }]),
        "igor",
        "2026-11-15T12:01:00.000Z",
        "2026-11-15T12:15:00.000Z",
        "2026-11-15T12:00:00.000Z",
      ],
    ]);
    const repository = new AgentChatQuestionRepository({ query, execute });
    await repository.insert({
      id: "question-1",
      messageId: "message-1",
      conversationId: "group-1",
      agentId: "agent-1",
      items: ITEMS,
      responderId: "igor",
      confirmsTool: "ticket.delete",
      expiresAt: "2026-11-15T12:15:00.000Z",
      createdAt: "2026-11-15T12:00:00.000Z",
    });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_chat_questions"),
      expect.objectContaining({ items: JSON.stringify(ITEMS), responder: "igor" }),
    );
    const [stored] = await repository.findByMessageIds(["message-1", "message-2"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("string_to_array"), {
      ids: "message-1,message-2",
    });
    expect(stored).toMatchObject({
      status: "answered",
      items: ITEMS,
      answers: [{ questionId: "q1", optionIds: ["o1"], freeText: null }],
      answeredBy: "igor",
      confirmsTool: "ticket.delete",
    });
  });

  it("answers only an open question", async () => {
    const query = vi.fn(async () => []);
    const repository = new AgentChatQuestionRepository({ query, execute: vi.fn() });
    await expect(
      repository.answer("question-1", { answers: [], answeredBy: "igor", answeredAt: "now" }),
    ).resolves.toBe(false);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("AND status = 'open'"), expect.anything());
    await expect(repository.findByMessageIds([])).resolves.toEqual([]);
  });
});
