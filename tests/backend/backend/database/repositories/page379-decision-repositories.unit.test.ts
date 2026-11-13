import { expect, it, vi } from "vitest";

import { ChatDecisionSettingsRepository } from "@/backend/database/repositories/chat/ChatDecisionSettingsRepository";
import { ConversationDecisionRepository } from "@/backend/database/repositories/conversation/ConversationDecisionRepository";
import { ConversationReplySettingsRepository } from "@/backend/database/repositories/conversation/ConversationReplySettingsRepository";
import {
  CONVERSATION_DEFAULT_DECISION_RULES,
  CONVERSATION_NO_RULE_OVERRIDES,
} from "@/definition/ConversationDecision";

import type { DatabaseValue } from "@/backend/database/Database";
import type { StoredConversationDecision } from "@/backend/database/repositories/conversation/ConversationDecisionRepository";

type Row = readonly DatabaseValue[];

/** A database that records every statement and answers each query with the next prepared rows. */
function database(...answers: Row[][]): {
  readonly query: ReturnType<typeof vi.fn>;
  readonly execute: ReturnType<typeof vi.fn>;
} {
  const queue = [...answers];
  return {
    query: vi.fn(async () => queue.shift() ?? []),
    execute: vi.fn(async () => undefined),
  };
}

const STORED: StoredConversationDecision = {
  messageId: "m1",
  conversationId: "group",
  outcome: "responders",
  fallback: "none",
  responderIds: ["ed"],
  model: "perplexity/pplx-decider-v1.3",
  answerProbability: 0.82,
  choices: [
    { agentId: "ed", probability: 0.78 },
    { agentId: null, probability: 0.07 },
  ],
  createdAt: "2026-01-01T00:00:00Z",
};

function decisionRow(overrides: Partial<Record<number, DatabaseValue>> = {}): Row {
  const row: DatabaseValue[] = [
    "m1",
    "group",
    "responders",
    "none",
    '["ed"]',
    "perplexity/pplx-decider-v1.3",
    0.82,
    '[{"agentId":"ed","probability":0.78},{"agentId":null,"probability":0.07}]',
    "2026-01-01T00:00:00Z",
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

it("gives a group without a row the mode \"@ + Decision\" and no values of its own", async () => {
  const repository = new ConversationReplySettingsRepository(database());
  await expect(repository.find("group")).resolves.toEqual({
    conversationId: "group",
    mode: "decision",
    overrides: CONVERSATION_NO_RULE_OVERRIDES,
  });
});

it("reads a stored group with its own values and keeps \"Nur @\"", async () => {
  const repository = new ConversationReplySettingsRepository(
    database([["mentions", 80, null, 30, 1]]),
  );
  await expect(repository.find("group")).resolves.toEqual({
    conversationId: "group",
    mode: "mentions",
    overrides: {
      answerThreshold: 80,
      responsibilityThreshold: null,
      secondThreshold: 30,
      maximumResponders: 1,
    },
  });
});

it("reads a mode of the removed kind as \"@ + Decision\"", async () => {
  const repository = new ConversationReplySettingsRepository(
    database([["observer", null, null, null, null]]),
  );
  expect((await repository.find("group")).mode).toBe("decision");
});

it("reads the mode of several groups at once and asks nothing for none", async () => {
  const empty = database();
  const none = new ConversationReplySettingsRepository(empty);
  expect((await none.modes([])).size).toBe(0);
  expect(empty.query).not.toHaveBeenCalled();
  const repository = new ConversationReplySettingsRepository(
    database([
      ["a", "mentions"],
      ["b", "decision"],
      ["c", "observer"],
    ]),
  );
  expect([...(await repository.modes(["a", "b", "c", "d"]))]).toEqual([
    ["a", "mentions"],
    ["b", "decision"],
    ["c", "decision"],
  ]);
});

it("saves the values of a group, a missing one as NULL", async () => {
  const connection = database();
  await new ConversationReplySettingsRepository(connection).save({
    settings: {
      conversationId: "group",
      mode: "decision",
      overrides: { ...CONVERSATION_NO_RULE_OVERRIDES, answerThreshold: 70 },
    },
    updatedBy: "manager",
    updatedAt: "2026-01-01T00:00:00Z",
  });
  expect(connection.execute).toHaveBeenCalledWith(
    expect.stringContaining("ON CONFLICT (conversation_id) DO UPDATE"),
    {
      conversation_id: "group",
      mode: "decision",
      answer_threshold: 70,
      responsibility_threshold: null,
      second_threshold: null,
      max_responders: null,
      updated_by: "manager",
      updated_at: "2026-01-01T00:00:00Z",
    },
  );
});

it("stores a decision once with model, probabilities and outcome", async () => {
  const connection = database();
  await new ConversationDecisionRepository(connection).record(STORED);
  expect(connection.execute).toHaveBeenCalledWith(
    expect.stringContaining("ON CONFLICT (message_id) DO NOTHING"),
    {
      message_id: "m1",
      conversation_id: "group",
      outcome: "responders",
      fallback: "none",
      responders: '["ed"]',
      model: "perplexity/pplx-decider-v1.3",
      answer_probability: 0.82,
      choices:
        '[{"agentId":"ed","probability":0.78},{"agentId":null,"probability":0.07}]',
      created_at: "2026-01-01T00:00:00Z",
    },
  );
});

it("reads decisions of messages and of answers, dropping malformed parts", async () => {
  const repository = new ConversationDecisionRepository(
    database(
      [decisionRow()],
      [["reply-1", ...decisionRow({ 2: "nobody" })]],
      [
        decisionRow({
          2: "bogus",
          3: "bogus",
          4: "not json",
          5: null,
          6: null,
          7: '[{"agentId":5,"probability":1},{"agentId":"x"},"junk",{"agentId":null,"probability":0.5}]',
        }),
      ],
    ),
  );
  expect((await repository.forMessages(["m1"])).get("m1")).toEqual(STORED);
  const byReply = await repository.forReplies(["reply-1"]);
  expect(byReply.get("reply-1")).toMatchObject({
    messageId: "m1",
    outcome: "nobody",
  });
  const lenient = (await repository.forMessages(["m2"])).get("m1");
  expect(lenient).toMatchObject({
    outcome: "nobody",
    fallback: "none",
    responderIds: [],
    model: null,
    answerProbability: null,
    choices: [{ agentId: null, probability: 0.5 }],
  });
});

it("asks nothing for no messages and no answers", async () => {
  const connection = database();
  const repository = new ConversationDecisionRepository(connection);
  expect((await repository.forMessages([])).size).toBe(0);
  expect((await repository.forReplies([])).size).toBe(0);
  expect(connection.query).not.toHaveBeenCalled();
});

it("lists the newest decisions of a group with the text of their messages", async () => {
  const connection = database([[...decisionRow(), "Bitte prüfen"]]);
  const [entry] = await new ConversationDecisionRepository(connection).recent(
    "group",
    30,
  );
  expect(connection.query).toHaveBeenCalledWith(
    expect.stringContaining("ORDER BY decisions.created_at DESC"),
    { conversation_id: "group", limit: 30 },
  );
  expect(entry).toEqual({ ...STORED, text: "Bitte prüfen" });
});

it("tells how the newest call of the model of a group went, ignoring @ addressings", async () => {
  const connection = database([["model_failed"]], []);
  const repository = new ConversationDecisionRepository(connection);
  await expect(repository.latestFallback("group")).resolves.toBe("model_failed");
  expect(connection.query).toHaveBeenCalledWith(
    expect.stringContaining("outcome <> 'mention'"),
    { conversation_id: "group" },
  );
  await expect(repository.latestFallback("group")).resolves.toBeNull();
});

it("reads and saves the decision model and the default rules of the instance", async () => {
  const connection = database([
    ["openrouter", "perplexity/pplx-decider-v1.3", null, 4, 70, 55, 35, 3],
  ]);
  const repository = new ChatDecisionSettingsRepository({
    query: connection.query,
  });
  await expect(repository.read()).resolves.toEqual({
    selection: {
      connectionId: "openrouter",
      model: "perplexity/pplx-decider-v1.3",
      reasoningEffort: null,
    },
    rules: {
      answerThreshold: 70,
      responsibilityThreshold: 55,
      secondThreshold: 35,
      maximumResponders: 3,
    },
    revision: 4,
  });
  connection.query.mockResolvedValueOnce([[1]]);
  await repository.save({
    selection: null,
    rules: CONVERSATION_DEFAULT_DECISION_RULES,
    revision: 4,
  });
  expect(connection.query).toHaveBeenLastCalledWith(
    expect.stringContaining("max_responders = $max_responders"),
    expect.objectContaining({
      connection_id: null,
      model: null,
      answer_threshold: 60,
      responsibility_threshold: 50,
      second_threshold: 40,
      max_responders: 2,
      revision: 4,
    }),
  );
  connection.query.mockResolvedValueOnce([]);
  await expect(
    repository.save({
      selection: null,
      rules: CONVERSATION_DEFAULT_DECISION_RULES,
      revision: 3,
    }),
  ).rejects.toMatchObject({ code: "profile_conflict" });
});
