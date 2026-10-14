import { beforeEach, expect, it, vi } from "vitest";

import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

/** A user-owned stored profile and transaction log; no real database is opened. */
class RemovalDatabase {
  public revision: number | null = 2;
  public readonly statements: string[] = [];
  public commits = 0;
  public rollbacks = 0;

  /** Returns the transaction boundary used by the production repository. */
  public asDatabase(): Pick<Database, "transaction"> {
    const transaction: DatabaseTransaction = {
      query: async (statement, parameters): Promise<DatabaseValue[][]> => {
        if (statement.includes("SELECT revision")) {
          expect(parameters).toEqual({ id: "agent" });
          return this.revision === null ? [] : [[this.revision]];
        }
        if (statement.includes("FROM agent_execution_profiles"))
          return [
            [
              "agent",
              "Synthetic agent",
              "connection",
              "model",
              null,
              1,
              JSON.stringify(emptyAgentConfiguration()),
              2,
              "igor",
              "model-profile",
            ],
          ];
        if (statement.includes("FROM agent_profile_purposes"))
          return [["agent", "agent"]];
        if (statement.includes("FROM agent_profile_targets")) return [];
        throw new Error("Unexpected query");
      },
      execute: async (statement, parameters) => {
        expect(parameters).toEqual({ id: "agent" });
        this.statements.push(statement);
      },
    };
    return {
      transaction: async (work) => {
        try {
          const result = await work(transaction);
          this.commits += 1;
          return result;
        } catch (error: unknown) {
          this.rollbacks += 1;
          throw error;
        }
      },
    };
  }
}

let database: RemovalDatabase;
let repository: AgentProfileRepository;
beforeEach(() => {
  database = new RemovalDatabase();
  repository = new AgentProfileRepository(database.asDatabase());
});

it.each([3, null])(
  "refuses revision %s inside the removal transaction before deletion or journaling",
  async (revision) => {
    database.revision = revision;
    const journal = vi.fn(async () => undefined);
    await expect(
      repository.remove("agent", { expectedRevision: 2, journal }),
    ).rejects.toMatchObject({ code: "profile_conflict" });
    expect(database.statements).toEqual([]);
    expect(journal).not.toHaveBeenCalled();
    expect(database.commits).toBe(0);
  },
);

it("commits the deletion receipt with the profile removal and preserves historical run records", async () => {
  await repository.remove("agent", {
    expectedRevision: 2,
    journal: async () => {
      database.statements.push("journal");
    },
  });
  expect(database.statements.at(-1)).toBe("journal");
  expect(
    database.statements.some((statement) =>
      statement.includes("DELETE FROM agent_execution_profiles"),
    ),
  ).toBe(true);
  expect(database.statements.join("\n")).not.toContain("agent_run_records");
  expect(database.commits).toBe(1);
});

it("rolls back deletion when the receipt journal fails", async () => {
  await expect(
    repository.remove("agent", {
      expectedRevision: 2,
      journal: async () => {
        throw new Error("Receipt failed");
      },
    }),
  ).rejects.toThrow("Receipt failed");
  expect(database.commits).toBe(0);
  expect(database.rollbacks).toBe(1);
});

it("preserves callers that delete without an expected revision", async () => {
  await repository.remove("agent");
  expect(database.commits).toBe(1);
});
