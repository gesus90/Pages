import { expect, it, vi } from "vitest";

import {
  ConversationHandoffRepository,
  takeHandoff,
  type NewConversationHandoff,
} from "./ConversationHandoffRepository";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

type Rows = DatabaseValue[][];

function databaseOf(queryRows: Rows[] = []): {
  readonly repository: ConversationHandoffRepository;
  readonly execute: ReturnType<typeof vi.fn<Database["execute"]>>;
  readonly query: ReturnType<typeof vi.fn<Database["query"]>>;
} {
  const execute = vi.fn<Database["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => []);
  for (const rows of queryRows) query.mockResolvedValueOnce(rows);
  const transaction: DatabaseTransaction = { execute, query };
  const transact: Database["transaction"] = async (work) => work(transaction);
  return {
    repository: new ConversationHandoffRepository({
      execute,
      query,
      transaction: transact,
    }),
    execute,
    query,
  };
}

function handoff(triggerMessageId: string): NewConversationHandoff {
  return {
    triggerMessageId,
    agentId: "a1",
    originMessageId: "o1",
    conversationId: "c1",
    requestedBy: null,
    reason: "because",
    personId: "p1",
    state: "pending",
    pauseReason: null,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

const requestRow: DatabaseValue[] = ["t1", "a1", "o1", "c1", "u1", "because"];

it("stores nothing for an empty list", async () => {
  const { repository, execute } = databaseOf();
  await expect(repository.request([])).resolves.toEqual([]);
  expect(execute).not.toHaveBeenCalled();
});

it("returns only the hand-overs it stored", async () => {
  const { repository, execute } = databaseOf([[["a1"]], []]);
  const first = handoff("t1");
  await expect(repository.request([first, handoff("t2")])).resolves.toEqual([
    first,
  ]);
  expect(execute).toHaveBeenCalledTimes(2);
});

it("reads the paused hand-overs of a conversation", async () => {
  const { repository } = databaseOf([
    [requestRow, ["t2", "a2", "o1", "c1", null, "r"]],
  ]);
  await expect(repository.paused("c1")).resolves.toEqual([
    {
      triggerMessageId: "t1",
      agentId: "a1",
      originMessageId: "o1",
      conversationId: "c1",
      requestedBy: "u1",
      reason: "because",
    },
    {
      triggerMessageId: "t2",
      agentId: "a2",
      originMessageId: "o1",
      conversationId: "c1",
      requestedBy: null,
      reason: "r",
    },
  ]);
});

it("pauses unstarted hand-overs and interrupts their targets", async () => {
  const { repository, execute } = databaseOf([[requestRow]]);
  await expect(
    repository.pauseUnstarted("2026-02-01T00:00:00Z"),
  ).resolves.toHaveLength(1);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    before: "2026-02-01T00:00:00Z",
  });
});

it("takes a stored hand-over once", async () => {
  const query = vi.fn<Database["query"]>();
  query.mockResolvedValueOnce([["a1"]]).mockResolvedValueOnce([]);
  const key = {
    triggerMessageId: "t1",
    agentId: "a1",
    expected: "paused",
    now: "2026-01-01T00:00:00Z",
  } as const;
  await expect(takeHandoff({ query }, key)).resolves.toBe(true);
  await expect(takeHandoff({ query }, key)).resolves.toBe(false);
  expect(query.mock.calls[0]?.[1]).toEqual({
    trigger_message_id: "t1",
    agent_id: "a1",
    expected: "paused",
    now: "2026-01-01T00:00:00Z",
  });
});
