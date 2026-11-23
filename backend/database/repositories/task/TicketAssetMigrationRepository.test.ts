import { expect, it, vi } from "vitest";

import { TicketAssetMigrationRepository } from "./TicketAssetMigrationRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";

const ATTACHMENT_ROW = [
  "a1",
  "w1",
  "f.png",
  "image/png",
  "media",
  5,
  "sum",
  "s.png",
  "u1",
  "User",
  "2026",
  1,
];

function databaseOf(
  transaction: DatabaseTransaction,
  query: DatabaseTransaction["query"],
): Database {
  return Object.assign(Object.create(null) as Database, {
    query,
    execute: transaction.execute,
    transaction: async <Result>(
      work: (inner: DatabaseTransaction) => Promise<Result>,
    ): Promise<Result> => work(transaction),
  });
}

it("lists every stored attachment", async () => {
  const transaction = {
    execute: vi.fn(),
    query: vi.fn(async () => [ATTACHMENT_ROW]),
  };
  const repository = new TicketAssetMigrationRepository(
    databaseOf(transaction, transaction.query),
  );

  const attachments = await repository.attachments();

  expect(attachments).toHaveLength(1);
  expect(attachments[0]?.storageName).toBe("s.png");
});

it("checkpoints without work", async () => {
  const transaction = { execute: vi.fn(), query: vi.fn() };
  const repository = new TicketAssetMigrationRepository(
    databaseOf(transaction, transaction.query),
  );

  await expect(repository.checkpoint()).resolves.toBeUndefined();
});

it("relocates all attachments in one transaction", async () => {
  const transaction = { execute: vi.fn(), query: vi.fn() };
  const repository = new TicketAssetMigrationRepository(
    databaseOf(transaction, transaction.query),
  );

  await repository.relocate([
    { id: "a1", storageName: "n1", contentType: "image/png", kind: "media" },
    { id: "a2", storageName: "n2", contentType: "text/plain", kind: "file" },
  ]);

  expect(transaction.execute).toHaveBeenCalledTimes(2);
  expect(transaction.execute).toHaveBeenCalledWith(
    expect.stringContaining("UPDATE work_item_attachments"),
    { id: "a2", storage_name: "n2", content_type: "text/plain", kind: "file" },
  );
});
