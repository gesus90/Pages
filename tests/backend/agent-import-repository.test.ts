import { describe, expect, it, vi } from "vitest";

import { AgentImportRepository } from "@/backend/database/repositories/agents/AgentImportRepository";

import { useMigratedDatabase } from "../helpers/test-database";

import type {
  StoredAgentImportRun,
  StoredAgentImportSource,
} from "@/backend/database/repositories/agents/AgentImportRepository";
import type { AgentImportItem } from "@/definition/AgentImportApply";
import type { AgentStructuredImportItem } from "@/definition/AgentStructuredImportManifest";

const run: StoredAgentImportRun = {
  id: "run",
  userId: "writer",
  projectId: "alpha",
  status: "running",
  snapshotJson: '{"plan":{}}',
};
const source: StoredAgentImportSource = {
  projectId: "alpha",
  sourceKey: "a.md",
  targetKind: "wiki",
  targetId: "page",
  contentHash: "hash",
  targetRevision: 1,
  resultJson: '{"pageId":"page"}',
  lastRunId: "run",
};
const created: AgentImportItem = {
  sourceKey: "a.md",
  targetKey: "file:a.md",
  action: "created",
  pageId: "page",
  link: "/wiki/page",
  assets: [],
  errorCode: null,
};

describe("agent import persistence and migration 029", () => {
  const getDatabase = useMigratedDatabase();

  it("isolates durable runs by account and project and enforces valid run states", async () => {
    const database = getDatabase();
    const repository = new AgentImportRepository(database);
    expect(await repository.findRun("run", "writer", "alpha")).toBeNull();
    await repository.insertRun(run);
    expect(await repository.findRun("run", "writer", "alpha")).toEqual(run);
    expect(await repository.findRun("run", "other", "alpha")).toBeNull();
    expect(await repository.findRun("run", "writer", "beta")).toBeNull();
    await expect(repository.insertRun(run)).rejects.toThrow();
    await expect(
      database.execute("UPDATE agent_import_runs SET status = 'invalid';"),
    ).rejects.toThrow();
  });

  it("reserves a source per project and updates only its baseline and last successful run", async () => {
    const repository = new AgentImportRepository(getDatabase());
    expect(await repository.findSource("alpha", "a.md")).toBeNull();
    await repository.insertSource(source);
    await expect(repository.insertSource(source)).rejects.toThrow();
    await repository.insertSource({ ...source, projectId: "beta" });
    await repository.touchSource("alpha", "a.md", "repeat");
    expect(await repository.findSource("alpha", "a.md")).toEqual({
      ...source,
      lastRunId: "repeat",
    });
    await repository.refreshSource({
      ...source,
      contentHash: "updated",
      targetRevision: 2,
      lastRunId: "update",
    });
    expect(await repository.findSource("alpha", "a.md")).toEqual({
      ...source,
      contentHash: "updated",
      targetRevision: 2,
      lastRunId: "update",
    });
    expect(await repository.findSource("beta", "a.md")).toEqual({
      ...source,
      projectId: "beta",
    });
  });

  it("retains exact ordered source outcomes, counters and the first completion time", async () => {
    const database = getDatabase();
    const repository = new AgentImportRepository(database);
    await repository.insertRun(run);
    expect(await repository.findItem(run.id, "missing")).toBeNull();
    expect(await repository.listItems(run.id)).toEqual([]);
    const skipped: AgentImportItem = {
      ...created,
      sourceKey: "b.md",
      action: "skipped",
    };
    await repository.recordItem(run.id, 1, skipped);
    await repository.recordItem(run.id, 0, created);
    expect(await repository.findItem(run.id, created.sourceKey)).toEqual(
      created,
    );
    expect(await repository.listItems(run.id)).toEqual([created, skipped]);
    await expect(repository.recordItem(run.id, 2, created)).rejects.toThrow();
    expect(await repository.finishRun(run.id)).toEqual({
      created: 1,
      skipped: 1,
      conflict: 0,
      failed: 0,
    });
    expect(
      await repository.findRun(run.id, run.userId, run.projectId),
    ).toMatchObject({ status: "complete" });
    const finished = await database.query(
      "SELECT finished_at FROM agent_import_runs;",
    );
    await repository.finishRun(run.id);
    expect(
      await database.query("SELECT finished_at FROM agent_import_runs;"),
    ).toEqual(finished);
    await expect(
      database.execute("UPDATE agent_import_items SET action = 'invalid';"),
    ).rejects.toThrow();
  });

  it.each(["conflict", "failed"] as const)(
    "finishes a %s outcome as partial",
    async (action) => {
      const repository = new AgentImportRepository(getDatabase());
      await repository.insertRun(run);
      await repository.recordItem(run.id, 0, {
        ...created,
        action,
        pageId: null,
        link: null,
        errorCode: action === "conflict" ? "CONFLICT" : "FORBIDDEN",
      });
      expect(await repository.finishRun(run.id)).toEqual({
        created: 0,
        skipped: 0,
        conflict: Number(action === "conflict"),
        failed: Number(action === "failed"),
      });
      expect(
        await repository.findRun(run.id, run.userId, run.projectId),
      ).toMatchObject({ status: "partial" });
    },
  );
});

describe("agent import shared repository contracts", () => {
  const getDatabase = useMigratedDatabase();

  it("stores and reads structured outcomes alongside wiki outcomes without losing their schemas", async () => {
    const repository = new AgentImportRepository(getDatabase());
    const ticket: AgentStructuredImportItem = {
      kind: "ticket",
      sourceKey: "ticket",
      targetKey: "ticket:ticket",
      action: "created",
      targetId: "id",
      key: "PAGE-1",
      link: "/tickets/PAGE-1",
      parentId: null,
      milestoneId: null,
      assets: [],
      reason: null,
      errorCode: null,
    };
    await repository.insertRun(run);
    expect(await repository.findStoredItem(run.id, "missing")).toBeNull();
    expect(await repository.listStoredItems(run.id)).toEqual([]);
    await repository.recordStructuredItem(run.id, 1, ticket);
    await repository.recordItem(run.id, 0, created);
    expect(await repository.findStoredItem(run.id, ticket.sourceKey)).toEqual(
      ticket,
    );
    expect(await repository.findStoredItem(run.id, created.sourceKey)).toEqual(
      created,
    );
    expect(await repository.listStoredItems(run.id)).toEqual([created, ticket]);
  });

  it("rejects unavailable aggregate counts rather than persisting invented totals", async () => {
    const database = getDatabase();
    const query = vi.spyOn(database, "query").mockResolvedValueOnce([]);
    await expect(
      new AgentImportRepository(database).finishRun(run.id),
    ).rejects.toThrow("Import counts unavailable.");
    expect(query).toHaveBeenCalledOnce();
    expect(await database.query("SELECT id FROM agent_import_runs;")).toEqual(
      [],
    );
  });
});
