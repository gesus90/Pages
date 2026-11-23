import { expect, it, vi } from "vitest";

import { WikiRepository } from "./WikiRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: ConstructorParameters<typeof WikiRepository>[0];
  readonly execute: ReturnType<typeof vi.fn>;
  readonly transaction: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async () => {});
  const query = vi.fn(async () => rows);
  const scope: DatabaseTransaction = { execute, query };
  const transaction = vi.fn();
  const run = async <Result>(
    work: (inner: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => {
    transaction();

    return work(scope);
  };

  return {
    database: { execute, query, transaction: run },
    execute,
    transaction,
  };
}

it("wires every aggregate to the same database", async () => {
  const repository = new WikiRepository(databaseOf().database);

  await repository.settings.save({
    fileLimitBytes: 1,
    mediaLimitBytes: 1,
    trashRetentionDays: 1,
    versionKeepLast: 1,
    versionRetentionDays: 1,
  });

  expect(repository.pages).toBeDefined();
  expect(repository.writes).toBeDefined();
  expect(repository.anchors).toBeDefined();
  expect(repository.lookups).toBeDefined();
  expect(repository.comments).toBeDefined();
  expect(repository.feed).toBeDefined();
  expect(repository.mentions).toBeDefined();
  expect(repository.attachments).toBeDefined();
  expect(repository.links).toBeDefined();
  expect(repository.search).toBeDefined();
  expect(repository.versions).toBeDefined();
  expect(repository.state).toBeDefined();
  expect(repository.activity).toBeDefined();
  expect(repository.operations).toBeDefined();
});

it("runs work in a repository bound to the transaction", async () => {
  const { database, execute, transaction } = databaseOf();
  const repository = new WikiRepository(database, "ai");

  const result = await repository.transaction(async (bound) => {
    await bound.settings.save({
      fileLimitBytes: 1,
      mediaLimitBytes: 1,
      trashRetentionDays: 1,
      versionKeepLast: 1,
      versionRetentionDays: 1,
    });
    // A nested transaction joins the open one.
    const nested = await bound.transaction(async () => "nested");

    return nested;
  });

  expect(result).toBe("nested");
  expect(transaction).toHaveBeenCalledOnce();
  expect(execute).toHaveBeenCalledOnce();
});

it("deletes pages through the shared database", async () => {
  const { database, execute } = databaseOf([["file.bin"]]);

  await expect(
    new WikiRepository(database).deletePages({
      sql: "SELECT 1",
      parameters: {},
    }),
  ).resolves.toEqual(["file.bin"]);
  expect(execute).toHaveBeenCalledTimes(11);
});
