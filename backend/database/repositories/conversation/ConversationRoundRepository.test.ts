import { expect, it, vi, type Mock } from "vitest";

import {
  ConversationRoundRepository,
  type ConversationReplyClaim,
} from "./ConversationRoundRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";

type Rows = (string | number | bigint | null)[][];

function databaseOf(...results: Rows[]): {
  readonly repository: ConversationRoundRepository;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<Database["query"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => []);
  for (const rows of results) query.mockResolvedValueOnce(rows);
  const transaction = vi.fn(
    async (work: (transaction: DatabaseTransaction) => Promise<unknown>) =>
      work({ execute, query }),
  ) as unknown as Database["transaction"];
  return {
    repository: new ConversationRoundRepository({
      execute,
      query,
      transaction,
    }),
    execute,
    query,
  };
}

const CLAIM: ConversationReplyClaim = {
  originMessageId: "o1",
  conversationId: "c1",
  personId: "p1",
  createdAt: "t",
  agentId: "a1",
  trigger: "mention",
  triggerMessageId: "m1",
  requestedBy: null,
  reason: "why",
  isAutomatic: false,
};

it("stores the round of a message", async () => {
  const { repository, execute } = databaseOf();
  await repository.ensureRound(CLAIM);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    origin_message_id: "o1",
    conversation_id: "c1",
    person_id: "p1",
    created_at: "t",
  });
});

it("claims an answer without counting a mentioned one", async () => {
  const { repository, execute, query } = databaseOf([[0]], [["a1"]]);
  await expect(repository.claim(CLAIM)).resolves.toBe("claimed");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[1]?.[1]).toMatchObject({
    delivery_intent: null,
    is_automatic: false,
  });
});

it("counts an automatic answer and keeps the delivery intent", async () => {
  const { repository, execute, query } = databaseOf([], [["a1"]]);
  const claim: ConversationReplyClaim = {
    ...CLAIM,
    isAutomatic: true,
    deliveryIntent: "steer",
  };
  await expect(repository.claim(claim)).resolves.toBe("claimed");
  expect(execute).toHaveBeenCalledTimes(2);
  expect(query.mock.calls[1]?.[1]).toMatchObject({ delivery_intent: "steer" });
});

it("never lets an agent answer its own mention", async () => {
  const { repository } = databaseOf([[0]]);
  await expect(repository.claim({ ...CLAIM, requestedBy: "a1" })).resolves.toBe(
    "duplicate",
  );
});

it("stops an automatic answer at the limit of the group", async () => {
  const reached = databaseOf([[2]], []);
  await expect(
    reached.repository.claim({
      ...CLAIM,
      isAutomatic: true,
      limits: { automaticRepliesPerOrigin: 2 },
    }),
  ).resolves.toBe("limit");
  const known = databaseOf([[8]], [["a1"]]);
  await expect(
    known.repository.claim({ ...CLAIM, isAutomatic: true }),
  ).resolves.toBe("duplicate");
});

it("takes a stored hand-over once", async () => {
  const taken = databaseOf([[0]], [["a1"]], [], [["a1"]]);
  await expect(
    taken.repository.claim({
      ...CLAIM,
      trigger: "handoff",
      handoff: "pending",
    }),
  ).resolves.toBe("claimed");
  const lost = databaseOf([[0]], []);
  await expect(
    lost.repository.claim({ ...CLAIM, handoff: "pending" }),
  ).resolves.toBe("duplicate");
});

it("leaves a hand-over to the batch that already holds its reply", async () => {
  const { repository } = databaseOf([[0]], [[1]]);
  await expect(
    repository.claim({ ...CLAIM, trigger: "handoff" }),
  ).resolves.toBe("duplicate");
});

it("consumes a ready batch for its follow-up", async () => {
  const done = databaseOf([[0]], [["q"]], [["a1"]]);
  await expect(
    done.repository.claim({ ...CLAIM, trigger: "handoff", isFollowUp: true }),
  ).resolves.toBe("claimed");
  const open = databaseOf([[0]], []);
  await expect(
    open.repository.claim({ ...CLAIM, isFollowUp: true }),
  ).resolves.toBe("duplicate");
});

it("reports a duplicate for an agent that was started already", async () => {
  const { repository } = databaseOf([[0]], []);
  await expect(repository.claim(CLAIM)).resolves.toBe("duplicate");
});

it("revives an interrupted answer of a paused hand-over", async () => {
  const revived = databaseOf([[0]], [["h"]], [], [["a1"]]);
  await expect(
    revived.repository.claim({ ...CLAIM, handoff: "paused" }),
  ).resolves.toBe("claimed");
  const gone = databaseOf([[0]], [["h"]], [], []);
  await expect(
    gone.repository.claim({ ...CLAIM, handoff: "paused" }),
  ).resolves.toBe("duplicate");
});

it("sets the state of a target with and without optional values", async () => {
  const { repository, execute } = databaseOf();
  await repository.setTargetState(
    { originMessageId: "o", agentId: "a" },
    { state: "running", updatedAt: "u" },
  );
  expect(execute.mock.calls[0]?.[1]).toEqual({
    origin_message_id: "o",
    agent_id: "a",
    trigger_message_id: "o",
    state: "running",
    reply_message_id: null,
    notice: null,
    updated_at: "u",
  });
  await repository.setTargetState(
    { originMessageId: "o", agentId: "a", triggerMessageId: "t" },
    {
      state: "failed",
      replyMessageId: "r",
      notice: "agent_failed",
      updatedAt: "u",
    },
  );
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    trigger_message_id: "t",
    reply_message_id: "r",
    notice: "agent_failed",
  });
});

it("reads a round with its asked agents", async () => {
  const { repository } = databaseOf([
    ["p1", 2n, "a1"],
    ["p1", 2, null],
    ["p1", 2, "a2"],
  ]);
  await expect(repository.round("o1")).resolves.toEqual({
    personId: "p1",
    automaticCount: 2,
    agentIds: ["a1", "a2"],
  });
});

it("reads no round for an unknown origin", async () => {
  await expect(databaseOf().repository.round("o1")).resolves.toBeNull();
});

it("finds the round of a reply with a known or unknown trigger", async () => {
  await expect(
    databaseOf([["o1", "p1", "a1", "context"]]).repository.findByReply("r1"),
  ).resolves.toEqual({
    originMessageId: "o1",
    personId: "p1",
    agentId: "a1",
    trigger: "context",
  });
  await expect(
    databaseOf([["o1", "p1", "a1", "odd"]]).repository.findByReply("r1"),
  ).resolves.toMatchObject({ trigger: "mention" });
  await expect(databaseOf().repository.findByReply("r1")).resolves.toBeNull();
});

it("reopens a failed answer once", async () => {
  const target = { replyMessageId: "r1", agentId: "a1", now: "n" };
  await expect(
    databaseOf([["o1", "p1", "fallback", "m1", "why"]]).repository.reopenFailed(
      target,
    ),
  ).resolves.toEqual({
    originMessageId: "o1",
    personId: "p1",
    agentId: "a1",
    trigger: "fallback",
    triggerMessageId: "m1",
    reason: "why",
  });
  await expect(
    databaseOf().repository.reopenFailed(target),
  ).resolves.toBeNull();
});

it("takes the routing decision of a message once", async () => {
  const routing = { triggerMessageId: "m1", origin: CLAIM };
  const first = databaseOf([["m1"]]);
  await expect(first.repository.claimRouting(routing)).resolves.toBe(true);
  expect(first.execute).toHaveBeenCalledTimes(1);
  await expect(databaseOf().repository.claimRouting(routing)).resolves.toBe(
    false,
  );
});

it("records how a routing decision ended", async () => {
  const { repository, execute } = databaseOf();
  await repository.finishRouting("m1", {
    state: "routed",
    selection: [{ agentId: "a1", reason: "r" }],
    errorCode: null,
    finishedAt: "f",
  });
  expect(execute.mock.calls[0]?.[1]).toEqual({
    trigger_message_id: "m1",
    state: "routed",
    selection: '[{"agentId":"a1","reason":"r"}]',
    error_code: null,
    finished_at: "f",
  });
});

it("interrupts stale answers and decisions", async () => {
  const { repository, execute } = databaseOf([["a1"], ["a2"]]);
  await expect(repository.interruptStale("b")).resolves.toBe(2);
  expect(execute.mock.calls[0]?.[1]).toEqual({ before: "b" });
});
