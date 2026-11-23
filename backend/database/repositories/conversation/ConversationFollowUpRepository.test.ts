import { expect, it, vi } from "vitest";

import { ConversationFollowUpRepository } from "./ConversationFollowUpRepository";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

type Rows = DatabaseValue[][];

function databaseOf(queryRows: Rows[] = []): {
  readonly repository: ConversationFollowUpRepository;
  readonly execute: ReturnType<typeof vi.fn<Database["execute"]>>;
  readonly query: ReturnType<typeof vi.fn<Database["query"]>>;
} {
  const execute = vi.fn<Database["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => []);
  for (const rows of queryRows) query.mockResolvedValueOnce(rows);
  const transaction: DatabaseTransaction = { execute, query };
  const transact: Database["transaction"] = async (work) => work(transaction);
  return {
    repository: new ConversationFollowUpRepository({
      execute,
      query,
      transaction: transact,
    }),
    execute,
    query,
  };
}

it("opens a question with one answer row per asked agent", async () => {
  const { repository, execute } = databaseOf();
  await repository.open({
    questionMessageId: "q1",
    originMessageId: "o1",
    conversationId: "c1",
    agentId: "a1",
    askedAgentIds: ["a2", "a3"],
    deadlineAt: "2026-01-01T00:00:00Z",
  });
  expect(execute).toHaveBeenCalledTimes(3);
  expect(execute.mock.calls[2]?.[1]).toEqual({ question: "q1", agent: "a3" });
});

it("bundles a reply for each mentioned questioner once", async () => {
  // per mention: lock query, update (execute), check query
  const { repository, execute } = databaseOf([[], [[1]], [], [], [], []]);
  await expect(
    repository.record("o1", {
      id: "r1",
      senderId: "a2",
      mentions: ["a1", "a1", "a2", "a3"],
    }),
  ).resolves.toEqual(new Set(["a1"]));
  expect(execute).toHaveBeenCalledTimes(2);
});

it("groups the pending answers by question", async () => {
  const { repository, query } = databaseOf([
    [
      ["q1", "o1", "c1", "p1", "a1", "d1", "a2", "r1"],
      ["q1", "o1", "c1", "p1", "a1", "d1", "a3", null],
      ["q2", "o2", "c1", "p2", "a1", "d2", "a2", null],
    ],
  ]);
  const pending = await repository.pending({
    originMessageId: "o1",
    conversationId: "c1",
  });
  expect(pending.map((entry) => entry.answers)).toEqual([
    [
      { agentId: "a2", replyMessageId: "r1" },
      { agentId: "a3", replyMessageId: null },
    ],
    [{ agentId: "a2", replyMessageId: null }],
  ]);
  expect(pending[0]).toMatchObject({ questionMessageId: "q1", personId: "p1" });
  expect(query.mock.calls[0]?.[1]).toEqual({
    origin: "o1",
    conversation: "c1",
  });
});

it("reads pending questions without a filter", async () => {
  const { repository, query } = databaseOf();
  await expect(repository.pending()).resolves.toEqual([]);
  expect(query.mock.calls[0]?.[1]).toEqual({
    origin: null,
    conversation: null,
  });
});

it("consumes a batch only when a row was updated", async () => {
  const { repository } = databaseOf([[["q1"]], []]);
  await expect(repository.consume("q1", "now")).resolves.toBe(true);
  await expect(repository.consume("q1", "now")).resolves.toBe(false);
});

it("reads the round replies after a question", async () => {
  const { repository } = databaseOf([[["r1"], ["r2"]]]);
  await expect(repository.context("o1", "q1")).resolves.toEqual(["r1", "r2"]);
});
