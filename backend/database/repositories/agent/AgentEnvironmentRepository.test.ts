import { expect, it, vi, type Mock } from "vitest";

import { AgentEnvironmentRepository } from "./AgentEnvironmentRepository";
import { purgeObsoletePlanRuns } from "./AgentPlanRunPurge";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";

vi.mock("./AgentPlanRunPurge", () => ({
  purgeObsoletePlanRuns: vi.fn(async () => {}),
}));

type Handle = Pick<Database, "transaction" | "query">;

function databaseOf(answers: DatabaseValue[][][]): {
  readonly database: Handle;
  readonly query: Mock<Database["query"]>;
} {
  const query = vi.fn<Database["query"]>(async () => answers.shift() ?? []);
  const transaction: DatabaseTransaction = {
    execute: async () => {},
    query,
  };
  return {
    database: {
      query,
      transaction: async (work) => work(transaction),
    },
    query,
  };
}

it("purges obsolete runs through the shared purge", async () => {
  const { database } = databaseOf([]);
  await new AgentEnvironmentRepository(database).purgeObsoleteRuns();
  expect(purgeObsoletePlanRuns).toHaveBeenCalledWith(database);
});

it("reports active workers while a lease exists", async () => {
  const { database } = databaseOf([[["i1"]]]);
  await expect(
    new AgentEnvironmentRepository(database).hasActiveWorkers(),
  ).resolves.toBe(true);
});

it("reports no active worker without a lease", async () => {
  const { database } = databaseOf([[]]);
  await expect(
    new AgentEnvironmentRepository(database).hasActiveWorkers(),
  ).resolves.toBe(false);
});

it("maintains connection caches during quiescence", async () => {
  const { database } = databaseOf([[]]);
  const maintain = vi.fn(async () => {});
  await new AgentEnvironmentRepository(database).maintainConnectionCaches(
    maintain,
  );
  expect(maintain).toHaveBeenCalledOnce();
});

it("skips cache maintenance while owners are busy", async () => {
  const { database } = databaseOf([[["i1"]]]);
  const maintain = vi.fn(async () => {});
  await new AgentEnvironmentRepository(database).maintainConnectionCaches(
    maintain,
  );
  expect(maintain).not.toHaveBeenCalled();
});

it("empties the home of an existing plan without open runs", async () => {
  const { database, query } = databaseOf([[["p1"]], []]);
  const maintain = vi.fn(async () => {});
  await new AgentEnvironmentRepository(database).maintainPlan("p1", maintain);
  expect(maintain).toHaveBeenCalledWith("empty");
  expect(query.mock.calls[1]?.[1]).toEqual({ plan_id: "p1" });
});

it("removes the home of a deleted plan", async () => {
  const { database } = databaseOf([[], []]);
  const maintain = vi.fn(async () => {});
  await new AgentEnvironmentRepository(database).maintainPlan("p1", maintain);
  expect(maintain).toHaveBeenCalledWith("remove");
});

it("keeps a plan home while a run is unsettled", async () => {
  const { database } = databaseOf([[["p1"]], [["r1"]]]);
  const maintain = vi.fn(async () => {});
  await new AgentEnvironmentRepository(database).maintainPlan("p1", maintain);
  expect(maintain).not.toHaveBeenCalled();
});

it("allows removing a run folder without blocking rows", async () => {
  const { database, query } = databaseOf([[]]);
  await expect(
    new AgentEnvironmentRepository(database).canRemoveRun("r1"),
  ).resolves.toBe(true);
  expect(query.mock.calls[0]?.[1]).toEqual({ run_id: "r1" });
});

it("keeps a run folder while a resource is outstanding", async () => {
  const { database } = databaseOf([[["r1"]]]);
  await expect(
    new AgentEnvironmentRepository(database).canRemoveRun("r1"),
  ).resolves.toBe(false);
});
