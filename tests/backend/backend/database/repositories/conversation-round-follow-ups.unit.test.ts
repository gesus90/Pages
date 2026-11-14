import { expect, it } from "vitest";

import { ConversationReplySettingsRepository } from "@/backend/database/repositories/conversation/ConversationReplySettingsRepository";
import { ConversationRoundRepository } from "@/backend/database/repositories/conversation/ConversationRoundRepository";

import { scriptedDatabase } from "./scripted-database";

import type { ConversationReplyClaim } from "@/backend/database/repositories/conversation/ConversationRoundRepository";

const followUp: ConversationReplyClaim = {
  originMessageId: "origin",
  conversationId: "group",
  personId: "person",
  createdAt: "now",
  agentId: "a",
  trigger: "handoff",
  triggerMessageId: "question",
  requestedBy: null,
  reason: "Replies to a question",
  isAutomatic: false,
  isFollowUp: true,
};

const handoff: ConversationReplyClaim = {
  ...followUp,
  triggerMessageId: "answer-of-b",
  requestedBy: "b",
  isFollowUp: false,
  handoff: "pending",
};

function statementsOf(
  boundary: ReturnType<typeof scriptedDatabase>,
  text: string,
): number {
  return boundary.statements.filter((entry) => entry.statement.includes(text))
    .length;
}

it("atomically consumes a ready batch and claims its continuation", async () => {
  const boundary = scriptedDatabase();
  // round lock, consume, target insert
  boundary.answer([[0]], [["question"]], [["a"]]);
  const repository = new ConversationRoundRepository(boundary.database);
  expect(await repository.claim(followUp)).toBe("claimed");
  expect(boundary.transactions()).toBe(1);
  expect(boundary.statements.every((entry) => entry.inTransaction)).toBe(true);
  expect(boundary.ofKind("query")[0]?.statement).toContain("FOR UPDATE");
  expect(boundary.ofKind("query")[1]?.statement).toContain(
    "SET consumed_at = $now",
  );
  expect(boundary.ofKind("query").at(-1)?.statement).toContain(
    "INSERT INTO conversation_reply_targets",
  );
  // A follow-up is no contribution without @.
  expect(statementsOf(boundary, "automatic_count = automatic_count + 1")).toBe(
    0,
  );
});

it("propagates a failed target insert from the batch consumption transaction", async () => {
  const boundary = scriptedDatabase();
  const failure = new Error("Target could not be stored");
  boundary.answer([[0]], [["question"]], failure);
  await expect(
    new ConversationRoundRepository(boundary.database).claim(followUp),
  ).rejects.toBe(failure);
  expect(boundary.transactions()).toBe(1);
});

it("claims an @ hand-over to an agent that answered the round before, without any round or agent limit", async () => {
  const boundary = scriptedDatabase();
  // round lock with 9 contributions without @, take request, not bundled, target insert
  boundary.answer([[9]], [["a"]], [], [["a"]]);
  const repository = new ConversationRoundRepository(boundary.database);
  expect(
    await repository.claim({
      ...handoff,
      limits: { automaticRepliesPerOrigin: 8 },
    }),
  ).toBe("claimed");
  const queries = boundary.ofKind("query");
  expect(queries[1]?.statement).toContain(
    "UPDATE conversation_handoff_requests",
  );
  expect(queries[1]?.parameters).toMatchObject({ expected: "pending" });
  expect(queries[2]?.statement).toContain("conversation_follow_up_answers");
  expect(queries[3]?.statement).toContain("ON CONFLICT DO NOTHING");
  expect(statementsOf(boundary, "automatic_count = automatic_count + 1")).toBe(
    0,
  );
});

it("refuses a self mention before touching any stored state", async () => {
  const boundary = scriptedDatabase();
  boundary.answer([[0]]);
  expect(
    await new ConversationRoundRepository(boundary.database).claim({
      ...handoff,
      requestedBy: "a",
    }),
  ).toBe("duplicate");
  expect(statementsOf(boundary, "conversation_handoff_requests")).toBe(0);
  expect(statementsOf(boundary, "INSERT INTO conversation_reply_targets")).toBe(
    0,
  );
});

it("refuses a repeated trigger: the request is taken already, or the target exists", async () => {
  const boundary = scriptedDatabase();
  const repository = new ConversationRoundRepository(boundary.database);
  boundary.answer([[0]], []);
  expect(await repository.claim(handoff)).toBe("duplicate");
  expect(statementsOf(boundary, "INSERT INTO conversation_reply_targets")).toBe(
    0,
  );
  // Without a stored request (a person's mention), the unique target key decides.
  boundary.answer([[0]], []);
  expect(
    await repository.claim({
      ...handoff,
      trigger: "mention",
      triggerMessageId: "origin",
      requestedBy: null,
      handoff: undefined,
    }),
  ).toBe("duplicate");
});

it("leaves a reply that joined the agent's batch to the batch and ends its request", async () => {
  const boundary = scriptedDatabase();
  boundary.answer([[0]], [["a"]], [[1]]);
  expect(
    await new ConversationRoundRepository(boundary.database).claim(handoff),
  ).toBe("duplicate");
  expect(statementsOf(boundary, "SET state = 'done'")).toBe(1);
  expect(statementsOf(boundary, "INSERT INTO conversation_reply_targets")).toBe(
    0,
  );
});

it("revives the interrupted target of a resumed hand-over once", async () => {
  const boundary = scriptedDatabase();
  const repository = new ConversationRoundRepository(boundary.database);
  // lock, take paused, not bundled, insert conflicts, revive succeeds
  boundary.answer([[0]], [["a"]], [], [], [["a"]]);
  expect(await repository.claim({ ...handoff, handoff: "paused" })).toBe(
    "claimed",
  );
  expect(boundary.ofKind("query").at(-1)?.statement).toContain(
    "state = 'interrupted'",
  );
  // A target that already answered is not started again.
  boundary.answer([[0]], [["a"]], [], [], []);
  expect(await repository.claim({ ...handoff, handoff: "paused" })).toBe(
    "duplicate",
  );
});

it.each([
  { count: 7, outcome: "claimed" },
  { count: 8, outcome: "limit" },
])(
  "limits contributions without @ to eight per round: $count before, $outcome",
  async ({ count, outcome }) => {
    const boundary = scriptedDatabase();
    boundary.answer([[count]], [["c"]]);
    expect(
      await new ConversationRoundRepository(boundary.database).claim({
        ...followUp,
        trigger: "context",
        triggerMessageId: "origin",
        isAutomatic: true,
        isFollowUp: false,
      }),
    ).toBe(outcome);
    expect(
      statementsOf(boundary, "automatic_count = automatic_count + 1"),
    ).toBe(outcome === "claimed" ? 1 : 0);
  },
);

it("clamps a configured limit without @ to nine", async () => {
  const boundary = scriptedDatabase();
  boundary.answer([[9]]);
  expect(
    await new ConversationRoundRepository(boundary.database).claim({
      ...followUp,
      trigger: "context",
      isAutomatic: true,
      isFollowUp: false,
      limits: { automaticRepliesPerOrigin: 100 },
    }),
  ).toBe("limit");
});

it("refuses an unproven follow-up", async () => {
  const boundary = scriptedDatabase();
  boundary.answer([[0]], []);
  expect(
    await new ConversationRoundRepository(boundary.database).claim(followUp),
  ).toBe("duplicate");
});

it("stores hand-overs once and pauses unstarted ones at a restart", async () => {
  const boundary = scriptedDatabase();
  const repository = new ConversationRoundRepository(boundary.database)
    .handoffs;
  const entry = {
    triggerMessageId: "answer-of-b",
    agentId: "a",
    originMessageId: "origin",
    conversationId: "group",
    personId: "person",
    requestedBy: "b",
    reason: "B",
    state: "paused" as const,
    pauseReason: "agent_streak" as const,
    createdAt: "now",
  };
  boundary.answer([["a"]]);
  expect(await repository.request([entry])).toEqual([entry]);
  boundary.answer([]);
  expect(await repository.request([entry])).toEqual([]);
  boundary.answer([["answer-of-b", "a", "origin", "group", "b", "B"]]);
  expect(await repository.pauseUnstarted("start")).toEqual([
    {
      triggerMessageId: "answer-of-b",
      agentId: "a",
      originMessageId: "origin",
      conversationId: "group",
      requestedBy: "b",
      reason: "B",
    },
  ]);
  expect(boundary.ofKind("query").at(-1)?.statement).toContain(
    "targets.state = 'queued'",
  );
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
  const [question] = await repository.pending({ originMessageId: "origin" });
  expect(question?.answers).toEqual([
    { agentId: "b", replyMessageId: "reply-b" },
    { agentId: "c", replyMessageId: null },
  ]);
  boundary.answer([["question"]], []);
  expect(await repository.consume("question", "now")).toBe(true);
  expect(await repository.consume("question", "now")).toBe(false);
});

it("records a reply into the questioner's batch under a row lock and reports it on every call", async () => {
  const boundary = scriptedDatabase();
  const repository = new ConversationRoundRepository(boundary.database)
    .followUps;
  boundary.answer([], [[1]]);
  expect(
    await repository.record("origin", {
      id: "reply-b",
      senderId: "b",
      mentions: ["a", "b"],
    }),
  ).toEqual(new Set(["a"]));
  expect(boundary.ofKind("query")[0]?.statement).toContain("FOR UPDATE");
  expect(boundary.transactions()).toBe(1);
});

it("keeps the default and the hard maximum of the limit without @ in persistence", async () => {
  const boundary = scriptedDatabase();
  const repository = new ConversationReplySettingsRepository(boundary.database);
  expect(await repository.find("group")).toMatchObject({
    automaticRepliesPerOrigin: 8,
  });
  boundary.answer([["mentions", null, null, null, null, 9]]);
  const settings = await repository.find("group");
  expect(settings).toMatchObject({ automaticRepliesPerOrigin: 9 });
  expect(settings).not.toHaveProperty("repliesPerAgentPerOrigin");
  await repository.save({
    settings: { ...settings, automaticRepliesPerOrigin: 100 },
    updatedBy: "person",
    updatedAt: "now",
  });
  expect(boundary.ofKind("execute").at(-1)?.parameters).toMatchObject({
    replies_per_round: 9,
  });
});
