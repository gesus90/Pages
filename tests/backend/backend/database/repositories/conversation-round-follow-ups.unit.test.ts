import { expect, it } from "vitest";

import { ConversationReplySettingsRepository } from "@/backend/database/repositories/conversation/ConversationReplySettingsRepository";
import { ConversationRoundRepository } from "@/backend/database/repositories/conversation/ConversationRoundRepository";

import { scriptedDatabase } from "./scripted-database";

import type { ConversationReplyClaim } from "@/backend/database/repositories/conversation/ConversationRoundRepository";

const claim: ConversationReplyClaim = {
  originMessageId: "origin",
  conversationId: "group",
  personId: "person",
  createdAt: "now",
  agentId: "a",
  trigger: "handoff",
  triggerMessageId: "question",
  requestedBy: null,
  reason: "Replies to a question",
  isAutomatic: true,
  isFollowUp: true,
};

it("atomically consumes a ready batch and claims the fourth answer", async () => {
  const boundary = scriptedDatabase();
  boundary.answer([[null]], [[6, 3, 0]], [["question"]], [["a"]]);
  const repository = new ConversationRoundRepository(boundary.database);
  expect(await repository.claim(claim)).toBe("claimed");
  expect(boundary.transactions()).toBe(1);
  expect(boundary.ofKind("query").every((entry) => entry.inTransaction)).toBe(
    true,
  );
  expect(
    boundary
      .ofKind("query")
      .some((entry) => entry.statement.includes("FOR UPDATE")),
  ).toBe(true);
  expect(
    boundary
      .ofKind("query")
      .some((entry) => entry.statement.includes("SET consumed_at = $now")),
  ).toBe(true);
  expect(boundary.ofKind("query")[2]?.parameters).toMatchObject({
    question: "question",
    now: "now",
  });
  expect(boundary.ofKind("query").at(-1)?.statement).toContain(
    "ON CONFLICT (origin_message_id, agent_id, trigger_message_id) DO NOTHING",
  );
});

it("propagates a failed target insert from the batch consumption transaction", async () => {
  const boundary = scriptedDatabase();
  const failure = new Error("Target could not be stored");
  boundary.answer([[null]], [[3, 1, 0]], [["question"]], failure);
  await expect(
    new ConversationRoundRepository(boundary.database).claim(claim),
  ).rejects.toBe(failure);
  const writes = boundary.ofKind("query").slice(-2);
  expect(writes[0]?.statement).toContain("SET consumed_at = $now");
  expect(writes[1]?.statement).toContain(
    "INSERT INTO conversation_reply_targets",
  );
  expect(writes.every((entry) => entry.inTransaction)).toBe(true);
  expect(boundary.transactions()).toBe(1);
});

it.each([
  { counts: [7, 4, 0], outcome: "limit", isFollowUp: true },
  { counts: [8, 1, 0], outcome: "limit", isFollowUp: true },
  { counts: [5, 2, 1], outcome: "duplicate", isFollowUp: true },
  { counts: [5, 2, 0], outcome: "duplicate", isFollowUp: false },
])(
  "guards persisted counts and repeated events: $counts, $outcome",
  async ({ counts, outcome, isFollowUp }) => {
    const boundary = scriptedDatabase();
    boundary.answer([[null]], [counts]);
    expect(
      await new ConversationRoundRepository(boundary.database).claim({
        ...claim,
        isFollowUp,
      }),
    ).toBe(outcome);
    expect(
      boundary
        .ofKind("query")
        .some((entry) =>
          entry.statement.includes("INSERT INTO conversation_reply_targets"),
        ),
    ).toBe(false);
  },
);

it("refuses an ended round, an unproven follow-up and unsafe configured limits", async () => {
  const boundary = scriptedDatabase();
  const repository = new ConversationRoundRepository(boundary.database);
  boundary.answer([["ended"]]);
  expect(await repository.claim(claim)).toBe("limit");
  boundary.answer([[null]], [[3, 1, 0]], []);
  expect(await repository.claim(claim)).toBe("duplicate");
  boundary.answer([[null]], [[9, 2, 0]]);
  expect(
    await repository.claim({
      ...claim,
      limits: { repliesPerAgentPerOrigin: 100, automaticRepliesPerOrigin: 100 },
    }),
  ).toBe("limit");
});

it("updates only the claimed answer and keeps every earlier reply associated with its round", async () => {
  const boundary = scriptedDatabase();
  const repository = new ConversationRoundRepository(boundary.database);
  await repository.setTargetState(
    { originMessageId: "origin", agentId: "a", triggerMessageId: "question" },
    { state: "answered", replyMessageId: "reply", updatedAt: "now" },
  );
  expect(boundary.statements[0]?.parameters).toMatchObject({
    trigger_message_id: "question",
    reply_message_id: "reply",
  });
  expect(boundary.statements[0]?.statement).toContain(
    "AND trigger_message_id = $trigger_message_id",
  );
  boundary.answer([["origin", "person", "a", "handoff"]]);
  expect(await repository.findByReply("reply")).toMatchObject({
    originMessageId: "origin",
    agentId: "a",
  });
});

it("reads and consumes a durable batch once, retaining unanswered agents for the timeout", async () => {
  const boundary = scriptedDatabase();
  const repository = new ConversationRoundRepository(boundary.database)
    .followUps;
  boundary.answer([
    ["question", "origin", "group", "person", "a", "deadline", "b", "reply-b"],
    ["question", "origin", "group", "person", "a", "deadline", "c", null],
  ]);
  const [question] = await repository.pending("origin");
  expect(question?.answers).toEqual([
    { agentId: "b", replyMessageId: "reply-b" },
    { agentId: "c", replyMessageId: null },
  ]);
  boundary.answer([["question"]], []);
  expect(await repository.consume("question", "now")).toBe(true);
  expect(await repository.consume("question", "now")).toBe(false);
  expect(boundary.ofKind("query").at(-1)?.statement).toContain(
    "deadline_at <= $now OR NOT EXISTS",
  );
});

it("keeps settings defaults, stored group limits and the hard maximum in persistence", async () => {
  const boundary = scriptedDatabase();
  const repository = new ConversationReplySettingsRepository(boundary.database);
  expect(await repository.find("group")).toMatchObject({
    repliesPerAgentPerOrigin: 4,
    automaticRepliesPerOrigin: 8,
  });
  boundary.answer([["mentions", null, 2, 2, 9]]);
  const settings = await repository.find("group");
  expect(settings).toMatchObject({
    repliesPerAgentPerOrigin: 2,
    automaticRepliesPerOrigin: 9,
  });
  await repository.save({
    settings: { ...settings, automaticRepliesPerOrigin: 100 },
    updatedBy: "person",
    updatedAt: "now",
  });
  expect(boundary.ofKind("execute").at(-1)?.parameters).toMatchObject({
    replies_per_agent: 2,
    replies_per_round: 9,
  });
});
