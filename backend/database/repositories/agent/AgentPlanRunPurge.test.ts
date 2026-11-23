import { beforeEach, expect, it, vi } from "vitest";

import {
  PLAN_RUN_PURGE_PREFIX,
  purgeAllPlanRuns,
  purgeEarlierPlanRuns,
  purgeObsoletePlanRuns,
  queueEarlierRunPurge,
} from "./AgentPlanRunPurge";

import type {
  DatabaseTransaction,
  Database,
} from "@/backend/database/Database";
import type { PlanRunPurgeDatabase } from "./AgentPlanRunPurge";

const { indexRunFailures } = vi.hoisted(() => ({
  indexRunFailures: vi.fn(),
}));

vi.mock("@/backend/service/agents/diagnosis/AgentRunFailureIndexer", () => ({
  indexRunFailures,
}));
vi.mock(
  "@/backend/database/repositories/diagnosis/AgentRunFailureRepository",
  () => ({ AgentRunFailureRepository: class {} }),
);

type Rows = unknown[][];

/** A database that answers each query by matching a fragment of its text. */
function fixture(options: {
  readonly earlier?: Rows;
  readonly settledOutside?: boolean;
  readonly settledInside?: boolean;
  readonly refusals?: boolean;
  readonly anchor?: boolean;
}): {
  readonly database: PlanRunPurgeDatabase;
  readonly query: ReturnType<typeof vi.fn<Database["query"]>>;
  readonly transaction: {
    readonly query: ReturnType<typeof vi.fn<DatabaseTransaction["query"]>>;
  };
  readonly executed: string[];
} {
  const executed: string[] = [];
  const transaction = {
    query: vi.fn<DatabaseTransaction["query"]>(async () =>
      (options.settledInside ?? true) ? ([["x"]] as never) : ([] as never),
    ),
    execute: vi.fn<DatabaseTransaction["execute"]>(async (sql: string) => {
      executed.push(sql);
      return undefined;
    }),
  };
  const query = vi.fn<Database["query"]>(async (sql: string) => {
    if (sql.includes("earlier.id")) return (options.earlier ?? []) as never;
    if (sql.includes("agent_plan_start_rejections"))
      return options.refusals ? [[1]] : [];
    if (sql.includes("WHERE runs.id = $run_id"))
      return (options.settledOutside ?? true)
        ? ([["x"]] as never)
        : ([] as never);
    if (sql.includes("SELECT id FROM agent_plan_runs WHERE id"))
      return options.anchor ? [["kept"]] : [];
    if (sql.includes("WHERE plan_id = $plan_id"))
      return (options.earlier ?? []) as never;
    return (options.earlier ?? []) as never;
  });
  const database = {
    query,
    transaction: vi.fn(async (work: (t: DatabaseTransaction) => unknown) =>
      work(transaction as unknown as DatabaseTransaction),
    ),
  } as unknown as PlanRunPurgeDatabase;
  return { database, query, transaction, executed };
}

beforeEach(() => {
  indexRunFailures.mockReset();
});

it("queues the purge intent of a new run", async () => {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => undefined);

  await queueEarlierRunPurge(
    { execute } as unknown as DatabaseTransaction,
    "r9",
  );

  expect(execute.mock.calls[0]?.[1]).toEqual({
    storage_name: `${PLAN_RUN_PURGE_PREFIX}r9`,
  });
});

it("purges settled earlier runs and their refusals", async () => {
  const { database, executed, transaction } = fixture({
    earlier: [["a"], ["b"]],
    refusals: true,
  });

  await expect(purgeEarlierPlanRuns(database, "kept")).resolves.toBe(true);

  expect(indexRunFailures).toHaveBeenCalledTimes(2);
  expect(executed.some((sql) => sql.includes("agent_session_attempts"))).toBe(
    true,
  );
  expect(
    executed.some((sql) => sql.includes("DELETE FROM agent_plan_runs")),
  ).toBe(true);
  expect(
    executed.some((sql) => sql.includes("agent_plan_start_rejections")),
  ).toBe(true);
  expect(transaction.query).toHaveBeenCalledTimes(2);
});

it("leaves a run that is not settled and reports it incomplete", async () => {
  const { database } = fixture({
    earlier: [["a"]],
    settledOutside: false,
    anchor: true,
  });

  await expect(purgeEarlierPlanRuns(database, "kept")).resolves.toBe(false);
  expect(indexRunFailures).not.toHaveBeenCalled();
});

it("treats a purge whose anchor is gone as complete", async () => {
  const { database } = fixture({
    earlier: [["a"]],
    settledOutside: false,
    anchor: false,
  });

  await expect(purgeEarlierPlanRuns(database, "kept")).resolves.toBe(true);
});

it("keeps a run that settled differently under its lock", async () => {
  const { database, executed } = fixture({
    earlier: [["a"]],
    settledInside: false,
    anchor: true,
  });

  await expect(purgeEarlierPlanRuns(database, "kept")).resolves.toBe(false);
  expect(executed).toHaveLength(0);
});

it("reports a full batch as incomplete", async () => {
  const earlier = Array.from({ length: 64 }, (_, index) => [
    `r${String(index)}`,
  ]);
  const { database } = fixture({ earlier, anchor: true });

  await expect(purgeEarlierPlanRuns(database, "kept")).resolves.toBe(false);
});

it("purges every run of a plan", async () => {
  const { database } = fixture({ earlier: [["a"]] });

  await expect(purgeAllPlanRuns(database, "p1")).resolves.toBe(true);
});

it("reports a plan purge incomplete while a run is unsettled", async () => {
  const { database } = fixture({ earlier: [["a"]], settledOutside: false });

  await expect(purgeAllPlanRuns(database, "p1")).resolves.toBe(false);
});

it("purges one batch of obsolete runs", async () => {
  const { database, executed } = fixture({ earlier: [["a"]] });

  await purgeObsoletePlanRuns(database);

  expect(
    executed.some((sql) => sql.includes("DELETE FROM agent_plan_runs")),
  ).toBe(true);
});
