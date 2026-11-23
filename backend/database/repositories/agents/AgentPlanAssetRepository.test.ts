import { expect, it, vi } from "vitest";

import {
  AgentPlanAssetRepository,
  type StoredPlanAsset,
} from "./AgentPlanAssetRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

function databaseOf(rows: DatabaseValue[][]): {
  readonly database: DatabaseTransaction;
  readonly query: ReturnType<typeof vi.fn<DatabaseTransaction["query"]>>;
} {
  const query = vi.fn<DatabaseTransaction["query"]>(async () => rows);
  return {
    database: { execute: vi.fn<DatabaseTransaction["execute"]>(), query },
    query,
  };
}

const ASSET: StoredPlanAsset = {
  id: "a1",
  projectId: "p1",
  ownerId: "u1",
  fileName: "a.png",
  mediaType: "image/png",
  kind: "image",
  size: 7,
  checksum: "sum",
  storageName: "s1",
  originRunId: "r1",
  originStepId: null,
  originAssetId: null,
  createdAt: "2026-01-01",
};

const INPUT: Omit<StoredPlanAsset, "createdAt"> = {
  id: "a1",
  projectId: "p1",
  ownerId: "u1",
  fileName: "a.png",
  mediaType: "image/png",
  kind: "image",
  size: 7,
  checksum: "sum",
  storageName: "s1",
  originRunId: "r1",
  originStepId: null,
  originAssetId: null,
};

function rowOf(kind: string): DatabaseValue[] {
  return [
    "a1",
    "p1",
    "u1",
    "a.png",
    "image/png",
    kind,
    7,
    "sum",
    "s1",
    "r1",
    null,
    null,
    "2026-01-01",
  ];
}

it("inserts an asset and returns the stored row", async () => {
  const { database, query } = databaseOf([rowOf("image")]);
  await expect(
    new AgentPlanAssetRepository(database).insert(INPUT),
  ).resolves.toEqual(ASSET);
  expect(query.mock.calls[0]?.[1]).toMatchObject({
    id: "a1",
    project_id: "p1",
    owner_id: "u1",
    origin_run_id: "r1",
    origin_step_id: null,
  });
});

it("fails when the insert returns no row", async () => {
  const { database } = databaseOf([]);
  await expect(
    new AgentPlanAssetRepository(database).insert(INPUT),
  ).rejects.toThrow("The plan asset was not stored.");
});

it("finds an asset and reads an unknown kind as other", async () => {
  const { database } = databaseOf([rowOf("unknown")]);
  await expect(
    new AgentPlanAssetRepository(database).find("a1"),
  ).resolves.toEqual({ ...ASSET, kind: "other" });
});

it("returns null for an unknown asset", async () => {
  const { database } = databaseOf([]);
  await expect(
    new AgentPlanAssetRepository(database).find("a1"),
  ).resolves.toBeNull();
});

it("lists the result files of a run", async () => {
  const { database, query } = databaseOf([rowOf("image")]);
  await expect(
    new AgentPlanAssetRepository(database).results("r1"),
  ).resolves.toEqual([ASSET]);
  expect(query.mock.calls[0]?.[1]).toEqual({ run_id: "r1" });
});
