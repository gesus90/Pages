import { expect, it, vi, type Mock } from "vitest";

import { ChatJobRepository } from "./ChatJobRepository";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { ChatJobEvent } from "@/definition/ChatJob";

function databaseOf(...results: DatabaseValue[][][]): {
  readonly database: Pick<Database, "query" | "execute" | "transaction">;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
} {
  const query = vi.fn<DatabaseTransaction["query"]>(
    async () => results.shift() ?? [],
  );
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const transaction = vi.fn(
    async (work: (inner: DatabaseTransaction) => Promise<unknown>) =>
      work({ query, execute }),
  );
  return {
    database: { query, execute, transaction } as unknown as Pick<
      Database,
      "query" | "execute" | "transaction"
    >,
    query,
    execute,
  };
}

function jobRow(
  overrides: Record<number, DatabaseValue> = {},
): DatabaseValue[] {
  const row: DatabaseValue[] = [
    "j1",
    "s1",
    "running",
    null,
    "c",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    0,
    null,
    null,
    "m1",
    null,
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

const END: ChatJobEvent = { kind: "end", state: "completed", errorCode: null };

it("creates a running job", async () => {
  const { database, execute } = databaseOf();
  await new ChatJobRepository(database).create({
    id: "j1",
    sessionId: "s1",
    userId: "u1",
    messageId: "m1",
  });
  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "j1",
    session_id: "s1",
    user_id: "u1",
    message_id: "m1",
  });
});

it("finishes a job with and without failure detail", async () => {
  const { database, execute } = databaseOf();
  const repository = new ChatJobRepository(database);
  await repository.finish("j1", "completed", null);
  await repository.finish("j1", "failed", "boom", { stage: "turn" });
  expect(execute.mock.calls[0]?.[1]).toMatchObject({ error_detail: null });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    state: "failed",
    error_code: "boom",
    error_detail: '{"stage":"turn"}',
  });
});

it("saves the context and the cost, or clears them", async () => {
  const { database, execute } = databaseOf();
  const repository = new ChatJobRepository(database);
  await repository.saveContext(
    "j1",
    { used: 1, size: 2 },
    { amount: 3, currency: "USD", isEstimated: true, scope: "session" },
  );
  await repository.saveContext("j1", null, null);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "j1",
    context_used: 1,
    context_size: 2,
    cost_amount: 3,
    cost_currency: "USD",
    cost_is_estimated: true,
    cost_scope: "session",
  });
  expect(execute.mock.calls[1]?.[1]).toEqual({
    id: "j1",
    context_used: null,
    context_size: null,
    cost_amount: null,
    cost_currency: null,
    cost_is_estimated: null,
    cost_scope: null,
  });
});

it("saves the tokens of a turn", async () => {
  const { database, execute } = databaseOf();
  const repository = new ChatJobRepository(database);
  await repository.saveTurn("j1", 1, { input: 1, output: 2, total: 3 });
  await repository.saveTurn("j1", 2, null, true);
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    input_tokens: 1,
    output_tokens: 2,
    total_tokens: 3,
    tokens_are_partial: false,
  });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    tokens_are_partial: true,
  });
});

it("appends a journal entry as JSON", async () => {
  const { database, execute } = databaseOf();
  await new ChatJobRepository(database).append("j1", 4, END);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    job_id: "j1",
    sequence: 4,
    payload: JSON.stringify(END),
  });
});

it("reads a job without usage", async () => {
  const { database } = databaseOf([jobRow()]);
  await expect(
    new ChatJobRepository(database).find("u1", "j1"),
  ).resolves.toEqual({
    id: "j1",
    sessionId: "s1",
    messageId: "m1",
    state: "running",
    errorCode: null,
    errorDetail: null,
    createdAt: "c",
    endedAt: null,
    usage: { context: null, tokens: null, cost: null },
  });
});

it("reads context, cost and tokens of a job", async () => {
  const detail = JSON.stringify({ stage: "turn", cause: "timeout" });
  const { database } = databaseOf(
    [
      jobRow({
        2: "failed",
        3: "boom",
        5: "e",
        6: 10,
        7: 100n,
        8: 1.5,
        9: "USD",
        10: 4,
        11: 5,
        12: 9,
        13: 1,
        14: 1,
        15: "session",
        17: detail,
      }),
    ],
    [jobRow({ 6: 10, 8: 2, 9: "EUR", 10: null, 11: null, 12: 3, 14: null })],
  );
  const repository = new ChatJobRepository(database);
  await expect(repository.find("u1", "j1")).resolves.toMatchObject({
    state: "failed",
    errorCode: "boom",
    errorDetail: { stage: "turn", cause: "timeout" },
    endedAt: "e",
    usage: {
      context: { used: 10, size: 100 },
      tokens: { input: 4, output: 5, total: 9, isPartial: true },
      cost: {
        amount: 1.5,
        currency: "USD",
        isEstimated: true,
        scope: "session",
      },
    },
  });
  await expect(repository.find("u1", "j2")).resolves.toMatchObject({
    usage: {
      context: null,
      tokens: { input: 0, output: 0, total: 3, isPartial: false },
      cost: { amount: 2, currency: "EUR", isEstimated: false },
    },
  });
});

it("ignores an unreadable failure detail", async () => {
  const { database } = databaseOf([jobRow({ 17: "{broken" })]);
  await expect(
    new ChatJobRepository(database).find("u1", "j1"),
  ).resolves.toMatchObject({ errorDetail: null });
});

it("rejects an unknown job state", async () => {
  const { database } = databaseOf([jobRow({ 2: "paused" })]);
  await expect(
    new ChatJobRepository(database).find("u1", "j1"),
  ).rejects.toThrow("Invalid chat job state");
});

it("returns null when a lookup finds no job", async () => {
  const { database } = databaseOf([], [], []);
  const repository = new ChatJobRepository(database);
  await expect(repository.find("u1", "j1")).resolves.toBeNull();
  await expect(repository.findByMessage("u1", "m1")).resolves.toBeNull();
  await expect(repository.latest("u1", "s1")).resolves.toBeNull();
});

it("finds jobs by message, latest and recent", async () => {
  const { database, query } = databaseOf([jobRow()], [jobRow()], [jobRow()]);
  const repository = new ChatJobRepository(database);
  await expect(repository.findByMessage("u1", "m1")).resolves.toMatchObject({
    id: "j1",
  });
  await expect(repository.latest("u1", "s1")).resolves.toMatchObject({
    id: "j1",
  });
  await expect(repository.recent("u1", "s1", 3)).resolves.toHaveLength(1);
  expect(query.mock.calls[2]?.[1]).toEqual({
    session_id: "s1",
    user_id: "u1",
    limit: 3,
  });
});

it("reads the journal entries after a cursor", async () => {
  const { database, query } = databaseOf([[2, JSON.stringify(END)]]);
  await expect(
    new ChatJobRepository(database).events("u1", "j1", {
      after: 1,
      limit: 10,
    }),
  ).resolves.toEqual([{ sequence: 2, event: END }]);
  expect(query.mock.calls[0]?.[1]).toEqual({
    job_id: "j1",
    user_id: "u1",
    after: 1,
    limit: 10,
  });
});

it("interrupts the running jobs in ID order and journals the end", async () => {
  const { database, execute } = databaseOf([["j2"], ["j1"]]);
  await expect(
    new ChatJobRepository(database).interruptRunning(),
  ).resolves.toEqual(["j1", "j2"]);
  expect(execute).toHaveBeenCalledTimes(4);
  expect(execute.mock.calls[0]?.[1]).toEqual({ job_id: "j1" });
  expect(execute.mock.calls[3]?.[1]).toMatchObject({ job_id: "j2" });
});

it("interrupts nothing when no job runs", async () => {
  const { database, execute } = databaseOf([]);
  await expect(
    new ChatJobRepository(database).interruptRunning(),
  ).resolves.toEqual([]);
  expect(execute).not.toHaveBeenCalled();
});
