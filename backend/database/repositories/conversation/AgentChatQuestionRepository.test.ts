import { expect, it, vi, type Mock } from "vitest";

import {
  AgentChatQuestionRepository,
  type NewAgentQuestion,
} from "./AgentChatQuestionRepository";

import type { DatabaseValue } from "@/backend/database/Database";

const ITEMS = [
  {
    id: "i1",
    text: "Which?",
    options: [{ id: "o1", label: "One", isRecommended: true }],
    isMultipleChoice: false,
  },
];

const NEW_QUESTION: NewAgentQuestion = {
  id: "q1",
  messageId: "m1",
  conversationId: "c1",
  agentId: "a1",
  items: ITEMS,
  responderId: null,
  confirmsTool: "tool",
  expiresAt: "2030-01-01",
  createdAt: "2029-01-01",
};

function rowOf(
  overrides: Partial<Record<number, DatabaseValue>> = {},
): DatabaseValue[] {
  const row: DatabaseValue[] = [
    "q1",
    "m1",
    "c1",
    "a1",
    JSON.stringify(ITEMS),
    "p1",
    null,
    "open",
    null,
    null,
    null,
    "2030-01-01",
    "2029-01-01",
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value as DatabaseValue;
  return row;
}

function repositoryOf(rows: DatabaseValue[][] = []): {
  readonly repository: AgentChatQuestionRepository;
  readonly execute: Mock;
  readonly query: Mock;
} {
  const execute = vi.fn(async () => {});
  const query = vi.fn(async () => rows);
  return {
    repository: new AgentChatQuestionRepository({ execute, query }),
    execute,
    query,
  };
}

it("inserts an open question with serialized items", async () => {
  const { repository, execute } = repositoryOf();
  await repository.insert(NEW_QUESTION);
  expect(execute.mock.calls[0]).toHaveProperty(
    "1",
    expect.objectContaining({
      id: "q1",
      items: JSON.stringify(ITEMS),
      confirms: "tool",
      responder: null,
    }),
  );
});

it("finds nothing for an unknown id", async () => {
  const { repository } = repositoryOf();
  await expect(repository.find("x")).resolves.toBeNull();
});

it("finds an open question without answers", async () => {
  const { repository } = repositoryOf([rowOf()]);
  await expect(repository.find("q1")).resolves.toEqual({
    id: "q1",
    messageId: "m1",
    conversationId: "c1",
    agentId: "a1",
    items: ITEMS,
    responderId: "p1",
    confirmsTool: null,
    status: "open",
    answers: [],
    answeredBy: null,
    answeredAt: null,
    expiresAt: "2030-01-01",
    createdAt: "2029-01-01",
  });
});

it("reads the answers of an answered question", async () => {
  const answers = [{ questionId: "i1", optionIds: ["o1"], freeText: null }];
  const { repository } = repositoryOf([
    rowOf({ 7: "answered", 8: JSON.stringify(answers), 9: "u", 10: "t" }),
  ]);
  await expect(repository.find("q1")).resolves.toMatchObject({
    status: "answered",
    answers,
    answeredBy: "u",
    answeredAt: "t",
  });
});

it("rejects a question with an unknown status", async () => {
  const { repository } = repositoryOf([rowOf({ 7: "weird" })]);
  await expect(repository.find("q1")).rejects.toThrow(
    'invalid value for "status"',
  );
});

it("finds no questions without message ids", async () => {
  const { repository, query } = repositoryOf();
  await expect(repository.findByMessageIds([])).resolves.toEqual([]);
  expect(query).not.toHaveBeenCalled();
});

it("finds the questions of several messages", async () => {
  const { repository, query } = repositoryOf([rowOf()]);
  const questions = await repository.findByMessageIds(["m1", "m2"]);
  expect(questions).toHaveLength(1);
  expect(query.mock.calls[0]).toHaveProperty("1", { ids: "m1,m2" });
});

it("reports whether the question was still open when answered", async () => {
  const answer = { answers: [], answeredBy: "u", answeredAt: "t" };
  await expect(
    repositoryOf([["q1"]]).repository.answer("q1", answer),
  ).resolves.toBe(true);
  await expect(repositoryOf().repository.answer("q1", answer)).resolves.toBe(
    false,
  );
});

it("closes an open question with the given status", async () => {
  const { repository, execute } = repositoryOf();
  await repository.close("q1", "expired");
  expect(execute.mock.calls[0]).toHaveProperty("1", {
    id: "q1",
    status: "expired",
  });
});
