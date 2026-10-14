import { beforeEach, expect, it, vi } from "vitest";

import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { AgentError } from "@/backend/error/AgentErrors";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AgentProfile } from "@/definition/AgentProfile";

const PROFILE: AgentProfile = {
  id: "agent-1",
  name: "Reviewer",
  ownerId: "owner",
  modelProfileId: "model-1",
  connectionId: "connection-1",
  model: "model-a",
  reasoningEffort: null,
  isActive: true,
  purposes: ["agent"],
  targets: [],
  configuration: emptyAgentConfiguration("person"),
  revision: 2,
};

/** A transaction that answers the revision read and logs the statements of a save. */
class ScriptedDatabase {
  public readonly log: string[] = [];
  public currentRevision: number | null = 2;
  public commits = 0;
  public rollbacks = 0;

  /** The database contract the repository is built on. */
  public asDatabase(): Pick<Database, "transaction"> {
    const transaction: DatabaseTransaction = {
      query: async (statement): Promise<DatabaseValue[][]> => {
        if (statement.includes("SELECT revision"))
          return this.currentRevision === null ? [] : [[this.currentRevision]];
        throw new Error("Unexpected query");
      },
      execute: async (statement) => {
        if (statement.includes("INSERT INTO agent_execution_profiles"))
          this.log.push("upsert");
        else this.log.push("scope");
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

let database = new ScriptedDatabase();
let repository = new AgentProfileRepository(database.asDatabase());

beforeEach(() => {
  database = new ScriptedDatabase();
  repository = new AgentProfileRepository(database.asDatabase());
});

it("runs the journal after the profile is written and in the same transaction", async () => {
  const journal = vi.fn(async () => {
    database.log.push("journal");
  });

  await repository.save(PROFILE, journal);

  expect(database.log.at(-1)).toBe("journal");
  expect(database.log).toContain("upsert");
  expect(database.commits).toBe(1);
  expect(journal).toHaveBeenCalledWith(expect.anything(), PROFILE);
});

it("rolls the profile back when the journal throws", async () => {
  const failure = new Error("An earlier call with this operation ID won.");

  await expect(
    repository.save(PROFILE, async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);

  expect(database.commits).toBe(0);
  expect(database.rollbacks).toBe(1);
});

it("does not run the journal for a stale revision", async () => {
  database.currentRevision = 3;
  const journal = vi.fn(async () => undefined);

  await expect(repository.save(PROFILE, journal)).rejects.toThrow(AgentError);

  expect(journal).not.toHaveBeenCalled();
  expect(database.log).not.toContain("upsert");
});

it("saves without a journal as before", async () => {
  await repository.save({ ...PROFILE, revision: undefined });

  expect(database.commits).toBe(1);
  expect(database.log).toContain("upsert");
});
