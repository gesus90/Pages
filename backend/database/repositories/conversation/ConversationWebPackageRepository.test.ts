import { expect, it, vi, type Mock } from "vitest";

import { ConversationWebPackageRepository } from "./ConversationWebPackageRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";

type Rows = (string | number | bigint | null)[][];

function databaseOf(rows: Rows = []): {
  readonly repository: ConversationWebPackageRepository;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<Database["query"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => rows);
  const transaction = vi.fn(
    async (work: (transaction: DatabaseTransaction) => Promise<unknown>) =>
      work({ execute, query }),
  ) as unknown as Database["transaction"];
  return {
    repository: new ConversationWebPackageRepository({
      execute,
      query,
      transaction,
    }),
    execute,
    query,
  };
}

it("inserts every file in one transaction", async () => {
  const { repository, execute } = databaseOf();
  await repository.insertFiles("a1", [
    { path: "p", storageName: "s", mimeType: "m", sizeBytes: 1, sha256: "h" },
    { path: "q", storageName: "t", mimeType: "m", sizeBytes: 2, sha256: "i" },
  ]);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[1]?.[1]).toEqual({
    attachment_id: "a1",
    path: "q",
    storage_name: "t",
    mime_type: "m",
    size_bytes: 2,
    sha256: "i",
  });
});

it("reads the files of a package", async () => {
  const { repository } = databaseOf([["p", "s", "m", 7n, "h"]]);
  await expect(repository.files("a1")).resolves.toEqual([
    { path: "p", storageName: "s", mimeType: "m", sizeBytes: 7, sha256: "h" },
  ]);
});

it("reads no storage names without attachments", async () => {
  const { repository, query } = databaseOf();
  await expect(repository.storageNamesOf([])).resolves.toEqual([]);
  expect(query).not.toHaveBeenCalled();
});

it("reads the storage names of attachments", async () => {
  const { repository } = databaseOf([["s1"], ["s2"]]);
  await expect(repository.storageNamesOf(["a", "b"])).resolves.toEqual([
    "s1",
    "s2",
  ]);
});

it("collects the storage names of live packages", async () => {
  const { repository } = databaseOf([["s1"], ["s1"], ["s2"]]);
  await expect(repository.storageNames()).resolves.toEqual(
    new Set(["s1", "s2"]),
  );
});

it("removes expired files and returns their storage names", async () => {
  const { repository } = databaseOf([["s1"]]);
  await expect(repository.removeExpired()).resolves.toEqual(["s1"]);
});

it("drops stale starts before it inserts a new one", async () => {
  const { repository, execute } = databaseOf();
  await repository.insertGrant({
    tokenHash: "h",
    attachmentId: "a",
    userId: "u",
    createdAt: "c",
    expiresAt: "e",
    staleBefore: "old",
  });
  expect(execute.mock.calls[0]?.[1]).toEqual({ stale_before: "old" });
  expect(execute.mock.calls[1]?.[1]).toEqual({
    token_hash: "h",
    attachment_id: "a",
    user_id: "u",
    created_at: "c",
    expires_at: "e",
  });
});

it("finds a grant or nothing", async () => {
  const found = databaseOf([["a", "u", "e", null]]);
  await expect(found.repository.findGrant("h")).resolves.toEqual({
    attachmentId: "a",
    userId: "u",
    expiresAt: "e",
    revokedAt: null,
  });
  const none = databaseOf();
  await expect(none.repository.findGrant("h")).resolves.toBeNull();
});

it("tells whether a running start ended", async () => {
  await expect(
    databaseOf([["h"]]).repository.revokeGrant("h", "u", "t"),
  ).resolves.toBe(true);
  await expect(
    databaseOf().repository.revokeGrant("h", "u", "t"),
  ).resolves.toBe(false);
});
