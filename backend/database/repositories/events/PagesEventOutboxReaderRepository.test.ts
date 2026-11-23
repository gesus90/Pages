import { expect, it, vi } from "vitest";

import { PagesEventOutboxReaderRepository } from "./PagesEventOutboxReaderRepository";

import type { Database } from "@/backend/database/Database";

function repositoryOf(options: {
  query?: ReturnType<typeof vi.fn>;
  execute?: ReturnType<typeof vi.fn>;
}): PagesEventOutboxReaderRepository {
  const query = options.query ?? vi.fn(async () => []);
  const execute =
    options.execute ??
    vi.fn<(statement: string, parameters?: unknown) => Promise<void>>(
      async () => undefined,
    );
  const scope = { query, execute };
  return new PagesEventOutboxReaderRepository({
    query,
    execute,
    transaction: async (work: (value: typeof scope) => unknown) => work(scope),
    readTransaction: async (work: (value: typeof scope) => unknown) =>
      work(scope),
  } as unknown as Pick<
    Database,
    "query" | "execute" | "transaction" | "readTransaction"
  >);
}

it("reads events with and without audience or storage and the floor", async () => {
  const usage = { totalBytes: 1, limitBytes: 2, largestDirectoryBytes: [] };
  const query = vi
    .fn()
    .mockResolvedValueOnce([[7]])
    .mockResolvedValueOnce([
      [8, "ticket.deleted", "t1", "p1", '["d1"]', "2026-01-01T00:00:00Z", null],
      [
        9,
        "storage.usage",
        "s1",
        null,
        "[]",
        "2026-01-01T00:00:01Z",
        JSON.stringify(usage),
      ],
    ]);
  const repository = repositoryOf({ query });

  await expect(repository.readAfter(7, 10)).resolves.toEqual({
    prunedThrough: 7,
    events: [
      {
        position: 8,
        type: "ticket.deleted",
        id: "t1",
        audience: { projectId: "p1", departmentIds: ["d1"] },
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        position: 9,
        type: "storage.usage",
        id: "s1",
        audience: null,
        createdAt: "2026-01-01T00:00:01Z",
        storage: usage,
      },
    ],
  });
  expect(query.mock.calls[1]?.[1]).toEqual({ after: 7, limit: 10 });
});

it("rejects a floor row that is missing", async () => {
  const repository = repositoryOf({});

  await expect(repository.readAfter(0, 1)).rejects.toThrow("pruned_through");
});

it("finds the position of a reader or null", async () => {
  const found = repositoryOf({ query: vi.fn(async () => [[5]]) });
  const missing = repositoryOf({});

  await expect(found.findReaderPosition("pages-core")).resolves.toBe(5);
  await expect(missing.findReaderPosition("pages-core")).resolves.toBeNull();
});

it("saves the position of a reader", async () => {
  const execute = vi.fn<
    (statement: string, parameters?: unknown) => Promise<void>
  >(async () => undefined);
  const repository = repositoryOf({ execute });

  await repository.saveReaderPosition("pages-core", 9);

  expect(execute.mock.calls[0]?.[1]).toEqual({
    reader: "pages-core",
    position: 9,
  });
});

it("raises the floor after removing events", async () => {
  const execute = vi.fn<
    (statement: string, parameters?: unknown) => Promise<void>
  >(async () => undefined);
  const query = vi
    .fn()
    .mockResolvedValueOnce([[3, 12]])
    .mockResolvedValueOnce([[12]]);
  const repository = repositoryOf({ query, execute });

  await expect(
    repository.removeExpired({ minimumAgeSeconds: 60, batchSize: 100 }),
  ).resolves.toEqual({ removed: 3, prunedThrough: 12 });
  expect(execute.mock.calls[0]?.[1]).toEqual({ pruned_through: 12 });
});

it("keeps the floor when nothing was removed", async () => {
  const execute = vi.fn<
    (statement: string, parameters?: unknown) => Promise<void>
  >(async () => undefined);
  const query = vi
    .fn()
    .mockResolvedValueOnce([[0, 0]])
    .mockResolvedValueOnce([[4]]);
  const repository = repositoryOf({ query, execute });

  await expect(
    repository.removeExpired({ minimumAgeSeconds: 60, batchSize: 100 }),
  ).resolves.toEqual({ removed: 0, prunedThrough: 4 });
  expect(execute).not.toHaveBeenCalled();
});

it("rejects an empty removal result", async () => {
  const repository = repositoryOf({});

  await expect(
    repository.removeExpired({ minimumAgeSeconds: 60, batchSize: 100 }),
  ).rejects.toThrow("removed");
});

it("rejects a removal row without the highest position", async () => {
  const repository = repositoryOf({ query: vi.fn(async () => [[3]]) });

  await expect(
    repository.removeExpired({ minimumAgeSeconds: 60, batchSize: 100 }),
  ).rejects.toThrow("highest_removed");
});

it("rejects a missing floor after a removal", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([[0, 0]])
    .mockResolvedValueOnce([]);
  const repository = repositoryOf({ query });

  await expect(
    repository.removeExpired({ minimumAgeSeconds: 60, batchSize: 100 }),
  ).rejects.toThrow("pruned_through");
});
