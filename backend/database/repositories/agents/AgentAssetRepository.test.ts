import { expect, it, vi, type Mock } from "vitest";

import {
  AgentAssetRepository,
  type StoredAgentAsset,
} from "./AgentAssetRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: DatabaseTransaction;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () => rows);
  return { database: { execute, query }, execute, query };
}

const ASSET: StoredAgentAsset = {
  id: "a1",
  userId: "u1",
  status: "staged",
  fileName: "a.png",
  contentType: "image/png",
  kind: "media",
  size: 12,
  checksum: "sum",
  storageName: "s1",
  expiresAt: 100,
  pageId: null,
  attachmentId: null,
  createdAt: 50,
};

function rowOf(kind: string, linked: boolean): DatabaseValue[] {
  return [
    "a1",
    "u1",
    "staged",
    "a.png",
    "image/png",
    kind,
    12n,
    "sum",
    "s1",
    100,
    linked ? "p1" : null,
    linked ? "t1" : null,
    50,
  ];
}

it("inserts a staged upload", async () => {
  const { database, execute } = databaseOf();
  await new AgentAssetRepository(database).insert(ASSET);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "a1",
    user_id: "u1",
    file_name: "a.png",
    content_type: "image/png",
    kind: "media",
    size: 12,
    checksum: "sum",
    storage_name: "s1",
    expires_at: 100,
    created_at: 50,
  });
});

it("finds a media asset and maps every column", async () => {
  const { database, query } = databaseOf([rowOf("media", true)]);
  await expect(new AgentAssetRepository(database).find("a1")).resolves.toEqual({
    ...ASSET,
    pageId: "p1",
    attachmentId: "t1",
  });
  expect(query.mock.calls[0]?.[1]).toEqual({ id: "a1" });
});

it("reads any other kind as a file", async () => {
  const { database } = databaseOf([rowOf("other", false)]);
  await expect(new AgentAssetRepository(database).find("a1")).resolves.toEqual({
    ...ASSET,
    kind: "file",
  });
});

it("returns null for an unknown asset", async () => {
  const { database } = databaseOf();
  await expect(
    new AgentAssetRepository(database).find("a1"),
  ).resolves.toBeNull();
});

it("links an asset to a page attachment", async () => {
  const { database, execute } = databaseOf();
  await new AgentAssetRepository(database).link("a1", "p1", "t1");
  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "a1",
    page_id: "p1",
    attachment_id: "t1",
  });
});

it("lists expired assets", async () => {
  const { database, query } = databaseOf([rowOf("media", false)]);
  await expect(
    new AgentAssetRepository(database).expired(200),
  ).resolves.toEqual([ASSET]);
  expect(query.mock.calls[0]?.[1]).toEqual({ now: 200 });
});

it("marks an asset expired and removes it", async () => {
  const { database, execute } = databaseOf();
  const repository = new AgentAssetRepository(database);
  await repository.markExpired("a1");
  await repository.remove("a1");
  expect(execute.mock.calls.map((call) => call[1])).toEqual([
    { id: "a1" },
    { id: "a1" },
  ]);
});

it("lists the storage names of staged assets", async () => {
  const { database } = databaseOf([["s1"], ["s2"]]);
  await expect(
    new AgentAssetRepository(database).stagedStorageNames(),
  ).resolves.toEqual(["s1", "s2"]);
});
