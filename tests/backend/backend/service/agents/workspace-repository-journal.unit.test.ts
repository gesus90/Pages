import { beforeEach, expect, it, vi } from "vitest";

import { AgentWorkspaceRepository } from "@/backend/database/repositories/agent/AgentWorkspaceRepository";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AgentWorkspace } from "@/definition/AgentWorkspace";

const STORED: readonly DatabaseValue[] = [
  "workspace-1",
  "Repo",
  "/work/repo",
  "1:7",
  "project-1",
  "person-1",
  2,
];

const CHANGED: AgentWorkspace = {
  id: "workspace-1",
  name: "Renamed",
  path: "/work/repo",
  directoryIdentity: "1:7",
  projectId: "project-1",
  registeredBy: "person-1",
  revision: 2,
};

/** A transaction that answers the three kinds of reads of the repository and logs its writes. */
class ScriptedDatabase {
  public readonly log: string[] = [];
  public isRecordStored = true;
  public hasOverlap = false;
  public hasUsage = false;
  public commits = 0;

  /** The database contract the repository is built on. */
  public asDatabase(): Pick<Database, "transaction"> {
    const transaction: DatabaseTransaction = {
      query: async (statement) => this.answer(statement),
      execute: async (statement) => {
        this.log.push(statement.includes("DELETE") ? "delete" : "upsert");
      },
    };
    return {
      transaction: async (work) => {
        const result = await work(transaction);
        this.commits += 1;
        return result;
      },
    };
  }

  private answer(statement: string): DatabaseValue[][] {
    if (statement.includes("agent_execution_profiles"))
      return this.hasUsage ? [["run-1", null, "run"]] : [];
    if (statement.includes("WHERE id <> $id"))
      return this.hasOverlap ? [["workspace-2"]] : [];
    return this.isRecordStored ? [[...STORED]] : [];
  }
}

let database = new ScriptedDatabase();
let repository = new AgentWorkspaceRepository(database.asDatabase());

beforeEach(() => {
  database = new ScriptedDatabase();
  repository = new AgentWorkspaceRepository(database.asDatabase());
});

it("runs the journal after the record is written and in the same transaction", async () => {
  const journal = vi.fn(async () => {
    database.log.push("journal");
  });

  await repository.save(CHANGED, false, journal);

  expect(database.log).toEqual(["upsert", "journal"]);
  expect(database.commits).toBe(1);
});

it("hands the journal the registration with its new revision", async () => {
  const journal = vi.fn(async () => undefined);

  await repository.save(CHANGED, false, journal);

  expect(journal).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      id: "workspace-1",
      name: "Renamed",
      revision: 3,
    }),
  );
});

it("starts a new registration at revision 1", async () => {
  database.isRecordStored = false;
  const journal = vi.fn(async () => undefined);

  await repository.save({ ...CHANGED, revision: 1 }, true, journal);

  expect(journal).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ revision: 1 }),
  );
});

it("fails the whole change when the journal fails", async () => {
  await expect(
    repository.save(CHANGED, false, async () => {
      throw new Error("operation ID taken");
    }),
  ).rejects.toThrow("operation ID taken");
  expect(database.commits).toBe(0);
});

it("does not run the journal for a stale revision", async () => {
  const journal = vi.fn(async () => undefined);

  await expect(
    repository.save({ ...CHANGED, revision: 1 }, false, journal),
  ).rejects.toMatchObject({ code: "workspace_conflict" });
  expect(journal).not.toHaveBeenCalled();
  expect(database.log).toEqual([]);
});

it("does not run the journal for an overlapping directory", async () => {
  database.hasOverlap = true;
  const journal = vi.fn(async () => undefined);

  await expect(repository.save(CHANGED, false, journal)).rejects.toMatchObject({
    code: "workspace_path_conflict",
  });
  expect(journal).not.toHaveBeenCalled();
  expect(database.log).toEqual([]);
});

it("does not run the journal when rebinding a workspace that is in use", async () => {
  database.hasUsage = true;
  const journal = vi.fn(async () => undefined);

  await expect(
    repository.save({ ...CHANGED, path: "/work/other" }, false, journal),
  ).rejects.toMatchObject({ code: "workspace_in_use" });
  expect(journal).not.toHaveBeenCalled();
});

it("runs the journal for a removal with the record that was removed", async () => {
  const journal = vi.fn(async () => {
    database.log.push("journal");
  });

  await repository.remove("workspace-1", 2, journal);

  expect(database.log).toEqual(["delete", "journal"]);
  expect(journal).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ id: "workspace-1", revision: 2 }),
  );
});

it("leaves a workspace with an active run or changed revision in place and runs no journal", async () => {
  const journal = vi.fn(async () => undefined);

  await expect(
    repository.remove("workspace-1", 1, journal),
  ).rejects.toMatchObject({ code: "workspace_conflict" });
  database.hasUsage = true;
  await expect(
    repository.remove("workspace-1", 2, journal),
  ).rejects.toMatchObject({ code: "workspace_running" });
  expect(journal).not.toHaveBeenCalled();
  expect(database.log).toEqual([]);
});
