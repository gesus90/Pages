import { expect, it, vi } from "vitest";

import {
  ConversationDecisionRepository,
  type StoredConversationDecision,
} from "./ConversationDecisionRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly repository: ConversationDecisionRepository;
  readonly execute: ReturnType<typeof vi.fn<Database["execute"]>>;
  readonly query: ReturnType<typeof vi.fn<Database["query"]>>;
} {
  const execute = vi.fn<Database["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => rows);
  return {
    repository: new ConversationDecisionRepository({ execute, query }),
    execute,
    query,
  };
}

function row(
  overrides: Partial<Record<number, DatabaseValue>> = {},
): DatabaseValue[] {
  const base: DatabaseValue[] = [
    "m1",
    "c1",
    "responders",
    "model_failed",
    '["a1",2]',
    "model-x",
    0.5,
    '[{"agentId":"a1","probability":0.7},{"agentId":null,"probability":0.3}]',
    "2026-01-01T00:00:00Z",
  ];
  Object.assign(base, overrides);
  return base;
}

const decision: StoredConversationDecision = {
  messageId: "m1",
  conversationId: "c1",
  outcome: "responders",
  fallback: "none",
  responderIds: ["a1"],
  model: null,
  answerProbability: null,
  choices: [{ agentId: null, probability: 1 }],
  createdAt: "2026-01-01T00:00:00Z",
};

it("records a decision with and without a cost", async () => {
  const { repository, execute } = databaseOf();
  await repository.record(decision);
  await repository.record({ ...decision, costUsd: 0.25 });
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    responders: '["a1"]',
    cost_usd: null,
  });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({ cost_usd: 0.25 });
});

it("reads decisions by message and filters malformed JSON entries", async () => {
  const { repository } = databaseOf([row()]);
  const decisions = await repository.forMessages(["m1"]);
  expect(decisions.get("m1")).toEqual({
    messageId: "m1",
    conversationId: "c1",
    outcome: "responders",
    fallback: "model_failed",
    responderIds: ["a1"],
    model: "model-x",
    answerProbability: 0.5,
    choices: [
      { agentId: "a1", probability: 0.7 },
      { agentId: null, probability: 0.3 },
    ],
    createdAt: "2026-01-01T00:00:00Z",
  });
});

it("does not query without messages or replies", async () => {
  const { repository, query } = databaseOf();
  await expect(repository.forMessages([])).resolves.toEqual(new Map());
  await expect(repository.forReplies([])).resolves.toEqual(new Map());
  expect(query).not.toHaveBeenCalled();
});

it("falls back for unknown values and unusable JSON", async () => {
  const { repository } = databaseOf([
    row({ 2: "weird", 3: "weird", 4: "not json", 5: null, 6: null, 7: "{" }),
    row({ 0: "m2", 4: '{"a":1}', 7: '{"a":1}' }),
  ]);
  const decisions = await repository.forMessages(["m1", "m2"]);
  expect(decisions.get("m1")).toMatchObject({
    outcome: "nobody",
    fallback: "none",
    responderIds: [],
    model: null,
    answerProbability: null,
    choices: [],
  });
  expect(decisions.get("m2")).toMatchObject({ responderIds: [], choices: [] });
});

it("drops choices that are not well formed", async () => {
  const choices = JSON.stringify([
    1,
    null,
    { agentId: "a1", probability: "high" },
    { agentId: "a1", probability: null },
    { agentId: 5, probability: 0.5 },
    { agentId: "a1", probability: 0.4 },
  ]);
  const { repository } = databaseOf([row({ 7: choices })]);
  const decisions = await repository.forMessages(["m1"]);
  expect(decisions.get("m1")?.choices).toEqual([
    { agentId: "a1", probability: 0.4 },
  ]);
});

it("reads the decisions that started the given answers", async () => {
  const { repository } = databaseOf([["r1", ...row()]]);
  const decisions = await repository.forReplies(["r1"]);
  expect(decisions.get("r1")?.messageId).toBe("m1");
});

it("lists the newest decisions with their text", async () => {
  const { repository, query } = databaseOf([[...row(), "hello"]]);
  const listing = await repository.recent("c1", 5);
  expect(listing[0]).toMatchObject({ messageId: "m1", text: "hello" });
  expect(query.mock.calls[0]?.[1]).toEqual({ conversation_id: "c1", limit: 5 });
});

it("tells how the newest model call went", async () => {
  const { repository } = databaseOf();
  await expect(repository.latestFallback("c1")).resolves.toBeNull();
});

it("reads the stored fallback and maps an unknown one to none", async () => {
  const known = databaseOf([["no_model"]]);
  await expect(known.repository.latestFallback("c1")).resolves.toBe("no_model");
  const unknown = databaseOf([["weird"]]);
  await expect(unknown.repository.latestFallback("c1")).resolves.toBe("none");
});

it("rethrows a JSON failure that is not a syntax error", async () => {
  const parse = vi.spyOn(JSON, "parse").mockImplementation(() => {
    throw new RangeError("boom");
  });
  const { repository } = databaseOf([row()]);
  await expect(repository.forMessages(["m1"])).rejects.toThrow("boom");
  parse.mockRestore();
});
