import { afterEach, expect, it, vi, type Mock } from "vitest";

import {
  AgentImportRepository,
  type StoredAgentImportRun,
  type StoredAgentImportSource,
} from "./AgentImportRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AgentImportItem } from "@/definition/AgentImportApply";
import type { AgentStructuredImportItem } from "@/definition/AgentStructuredImportManifest";

/** Answers the count statement with `counts` and every other query with `rows`. */
function databaseOf(
  rows: DatabaseValue[][] = [],
  counts: DatabaseValue[][] = [[1, 0, 0, 0]],
): {
  readonly database: DatabaseTransaction;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async (statement) =>
    statement.includes("COUNT(*)") ? counts : rows,
  );
  return { database: { execute, query }, execute, query };
}

const RUN: StoredAgentImportRun = {
  id: "r1",
  userId: "u1",
  projectId: "p1",
  status: "running",
  snapshotJson: "{}",
};

const SOURCE: StoredAgentImportSource = {
  projectId: "p1",
  sourceKey: "k1",
  targetKind: "page",
  targetId: "t1",
  contentHash: "h",
  targetRevision: 3,
  resultJson: "{}",
  lastRunId: "r1",
};

const ITEM: AgentImportItem = {
  sourceKey: "k1",
  targetKey: "tk",
  action: "created",
  pageId: "pg1",
  link: null,
  assets: [],
  errorCode: null,
};

const STRUCTURED: AgentStructuredImportItem = {
  kind: "ticket",
  sourceKey: "k2",
  targetKey: "tk2",
  action: "skipped",
  targetId: "t2",
  key: null,
  link: null,
  parentId: null,
  milestoneId: null,
  assets: [],
  reason: null,
  errorCode: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

it("creates a running run", async () => {
  vi.spyOn(Date, "now").mockReturnValue(10);
  const { database, execute } = databaseOf();
  await new AgentImportRepository(database).insertRun(RUN);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "r1",
    user_id: "u1",
    project_id: "p1",
    snapshot_json: "{}",
    now: 10,
  });
});

it("finds a run only within its owner and project", async () => {
  const { database, query } = databaseOf([["running", "{}"]]);
  await expect(
    new AgentImportRepository(database).findRun("r1", "u1", "p1"),
  ).resolves.toEqual(RUN);
  expect(query.mock.calls[0]?.[1]).toEqual({
    id: "r1",
    user_id: "u1",
    project_id: "p1",
  });
});

it("returns null for an unknown run or source", async () => {
  const { database } = databaseOf();
  const repository = new AgentImportRepository(database);
  await expect(repository.findRun("r1", "u1", "p1")).resolves.toBeNull();
  await expect(repository.findSource("p1", "k1")).resolves.toBeNull();
});

it("finds the mapping of a source", async () => {
  const { database } = databaseOf([["page", "t1", "h", 3n, "{}", "r1"]]);
  await expect(
    new AgentImportRepository(database).findSource("p1", "k1"),
  ).resolves.toEqual(SOURCE);
});

it("registers, refreshes and touches a source", async () => {
  vi.spyOn(Date, "now").mockReturnValue(10);
  const { database, execute } = databaseOf();
  const repository = new AgentImportRepository(database);
  await repository.insertSource(SOURCE);
  await repository.refreshSource(SOURCE);
  await repository.touchSource("p1", "k1", "r2");
  expect(execute.mock.calls.map((call) => call[1])).toEqual([
    {
      project_id: "p1",
      source_key: "k1",
      target_kind: "page",
      target_id: "t1",
      content_hash: "h",
      target_revision: 3,
      result_json: "{}",
      last_run_id: "r1",
      now: 10,
    },
    {
      project_id: "p1",
      source_key: "k1",
      content_hash: "h",
      target_revision: 3,
      last_run_id: "r1",
      now: 10,
    },
    { project_id: "p1", source_key: "k1", run_id: "r2", now: 10 },
  ]);
});

it("reads committed items", async () => {
  const stored = [[JSON.stringify(ITEM)]];
  const repository = new AgentImportRepository(databaseOf(stored).database);
  await expect(repository.findItem("r1", "k1")).resolves.toEqual(ITEM);
  await expect(repository.findStoredItem("r1", "k1")).resolves.toEqual(ITEM);
  await expect(repository.listStoredItems("r1")).resolves.toEqual([ITEM]);
  await expect(repository.listItems("r1")).resolves.toEqual([ITEM]);
});

it("returns null for an item that was not committed", async () => {
  const repository = new AgentImportRepository(databaseOf().database);
  await expect(repository.findItem("r1", "k1")).resolves.toBeNull();
  await expect(repository.findStoredItem("r1", "k1")).resolves.toBeNull();
});

it("records an item with the page as target and refreshes the counts", async () => {
  vi.spyOn(Date, "now").mockReturnValue(10);
  const { database, execute } = databaseOf();
  await new AgentImportRepository(database).recordItem("r1", 2, ITEM);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    run_id: "r1",
    source_key: "k1",
    target_key: "tk",
    ordinal: 2,
    action: "created",
    target_id: "pg1",
    error_code: null,
    result_json: JSON.stringify(ITEM),
    now: 10,
  });
  expect(execute.mock.calls[1]?.[1]).toEqual({
    id: "r1",
    created: 1,
    skipped: 0,
    conflict: 0,
    failed: 0,
    now: 10,
  });
});

it("records a structured item as it is", async () => {
  const { database, execute } = databaseOf();
  await new AgentImportRepository(database).recordStructuredItem(
    "r1",
    0,
    STRUCTURED,
  );
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    source_key: "k2",
    target_id: "t2",
    result_json: JSON.stringify(STRUCTURED),
  });
});

it("fails when the counts are unavailable", async () => {
  const { database } = databaseOf([], []);
  await expect(
    new AgentImportRepository(database).recordItem("r1", 0, ITEM),
  ).rejects.toThrow("Import counts unavailable.");
});

it("finishes a clean run as complete", async () => {
  const { database, execute } = databaseOf();
  await expect(
    new AgentImportRepository(database).finishRun("r1"),
  ).resolves.toEqual({ created: 1, skipped: 0, conflict: 0, failed: 0 });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({ status: "complete" });
});

it("finishes a run with a conflict or a failure as partial", async () => {
  for (const counts of [
    [1, 0, 1, 0],
    [1, 0, 0, 1],
  ]) {
    const { database, execute } = databaseOf([], [counts]);
    await new AgentImportRepository(database).finishRun("r1");
    expect(execute.mock.calls[1]?.[1]).toMatchObject({ status: "partial" });
  }
});
