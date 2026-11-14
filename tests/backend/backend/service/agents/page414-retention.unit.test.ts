import { beforeEach, expect, it, vi } from "vitest";

import { AgentEnvironmentRepository } from "@/backend/database/repositories/agent/AgentEnvironmentRepository";
import {
  purgeAllPlanRuns,
  purgeEarlierPlanRuns,
  purgeObsoletePlanRuns,
} from "@/backend/database/repositories/agent/AgentPlanRunPurge";
import { AgentDeferredGarbage } from "@/backend/storage/AgentDeferredGarbage";
import { AgentEnvironmentMaintenance } from "@/backend/storage/AgentEnvironmentMaintenance";
import { AgentPayloadFileStore } from "@/backend/storage/AgentPayloadFileStore";

import { environmentFiles as files } from "./page352-files";
import { RetentionDatabase } from "./page414-retention-fixture";

import type { DatabaseTransaction } from "@/backend/database/Database";

vi.mock("@/backend/service/agents/diagnosis/AgentRunFailureIndexer", () => ({
  indexRunFailures: vi.fn(),
}));
vi.mock(import("@/backend/logging/Logger"), async (importOriginal) => ({
  ...(await importOriginal()),
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));
vi.mock("node:fs/promises", async () => {
  const { environmentFiles } = await import("./page352-files");
  return {
    ...environmentFiles.module(),
    open: async () => ({
      sync: async () => undefined,
      close: async () => undefined,
    }),
    readdir: async (
      directory: string,
      options?: { withFileTypes?: boolean },
    ) => {
      const children = [...environmentFiles.entries].filter(
        ([location]) =>
          location.startsWith(`${directory}/`) &&
          !location.slice(directory.length + 1).includes("/"),
      );
      return children.map(([location, entry]) => {
        const name = location.slice(directory.length + 1);
        return options?.withFileTypes
          ? { name, isDirectory: () => entry.kind === "directory" }
          : name;
      });
    },
  };
});

const ROOT = "/synthetic/page414";
const PLAN = "11111111-1111-4111-8111-111111111111";
const OLD = "22222222-2222-4222-8222-222222222222";
const LATEST = "33333333-3333-4333-8333-333333333333";
const INSTANCE = "44444444-4444-4444-8444-444444444444";

beforeEach(() => files.reset());

function seedRuns(database: RetentionDatabase): void {
  database.plans.add(PLAN);
  database.runs.set(OLD, {
    id: OLD,
    planId: PLAN,
    startedAt: "2026-10-13",
    status: "failed",
  });
  database.runs.set(LATEST, {
    id: LATEST,
    planId: PLAN,
    startedAt: "2026-11-14",
    status: "succeeded",
  });
  database.owners.set(INSTANCE, { runId: OLD, released: true });
}

function expectSettlementGuards(statement: string): void {
  expect(statement).toContain(
    "runs.status IN ('succeeded', 'failed', 'cancelled', 'work_done_closeout_open')",
  );
  for (const table of [
    "acp_resource_leases",
    "agent_plan_workspace_locks",
    "agent_workspace_cleanup",
    "agent_local_session_owners",
    "plan_run_api_cleanup",
    "plan_run_commands",
  ])
    expect(statement).toMatch(
      new RegExp(`NOT EXISTS \\(\\s*SELECT 1\\s+FROM ${table}\\b`, "u"),
    );
  expect(statement).toContain("state = 'pending'");
  expect(statement).toContain("released_at IS NULL");
  expect(statement).toContain("status = 'accepted'");
  expect(statement).not.toContain("resourceReleases");
}

it("periodic maintenance purges orphaned runs and their released owners without a plan action", async () => {
  const database = new RetentionDatabase();
  seedRuns(database);
  database.plans.clear();
  await new AgentEnvironmentMaintenance(
    ROOT,
    new AgentEnvironmentRepository(database),
  ).run();
  expect(database.runs.size).toBe(0);
  expect(database.owners.size).toBe(0);
  const selection =
    database.queries.find((query) => query.includes("AS newer")) ?? "";
  expectSettlementGuards(selection);
  expect(selection).toContain(
    "NOT EXISTS (\n                SELECT 1 FROM agent_plans WHERE id = runs.plan_id",
  );
});

it("periodic retention keeps only the latest started run, also when the latest is failed", async () => {
  const database = new RetentionDatabase();
  seedRuns(database);
  const latest = database.runs.get(LATEST);
  if (latest) latest.status = "failed";
  await purgeObsoletePlanRuns(database);
  expect([...database.runs.keys()]).toEqual([LATEST]);
  expect(database.owners.size).toBe(0);
  const selection = database.queries[0] ?? "";
  expect(selection).toContain("newer.plan_id = runs.plan_id");
  expect(selection).toContain(
    "(newer.started_at, newer.id) > (runs.started_at, runs.id)",
  );
  expect(selection).toContain("LIMIT 64");
});

it("breaks equal start times deterministically by run id", async () => {
  const database = new RetentionDatabase();
  seedRuns(database);
  database.runs.set(OLD, {
    id: OLD,
    planId: PLAN,
    startedAt: "2026-11-14",
    status: "succeeded",
  });
  await purgeObsoletePlanRuns(database);
  expect([...database.runs.keys()]).toEqual([LATEST]);
});

it("uses the common purge after plan deletion and deletes the existing run-owned row sets", async () => {
  const database = new RetentionDatabase();
  seedRuns(database);
  database.plans.delete(PLAN);
  expect(await purgeAllPlanRuns(database, PLAN)).toBe(true);
  expect(database.runs.size).toBe(0);
  expect(database.owners.size).toBe(0);
  for (const table of [
    "agent_plan_checkpoints",
    "agent_session_attempts",
    "agent_local_session_owners",
    "plan_run_commands",
    "agent_run_credentials",
    "agent_plan_runs",
  ])
    expect(
      database.deletes.some((query) => query.includes(`DELETE FROM ${table}`)),
    ).toBe(true);
});

it.each(["succeeded", "failed", "cancelled", "work_done_closeout_open"])(
  "allows settled %s run folders to be removed",
  async (status) => {
    const database = new RetentionDatabase();
    seedRuns(database);
    database.runs.set(OLD, {
      id: OLD,
      planId: PLAN,
      startedAt: "2026-10-13",
      status,
    });
    const repository = new AgentEnvironmentRepository(database);
    expect(await repository.canRemoveRun(OLD)).toBe(true);
    expectSettlementGuards(database.queries[0] ?? "");
  },
);

it.each([true, false])(
  "maintains a settled failed plan home with plan present=%s",
  async (exists) => {
    const query = vi
      .fn<DatabaseTransaction["query"]>()
      .mockResolvedValueOnce(exists ? [[PLAN]] : [])
      .mockResolvedValueOnce([]);
    const transaction: DatabaseTransaction = { query, execute: vi.fn() };
    const repository = new AgentEnvironmentRepository({
      query,
      transaction: async (work) => work(transaction),
    });
    const maintain = vi.fn();
    await repository.maintainPlan(PLAN, maintain);
    expect(maintain).toHaveBeenCalledWith(exists ? "empty" : "remove");
    const busyQuery = query.mock.calls[1]?.[0] ?? "";
    expectSettlementGuards(busyQuery);
    expect(busyQuery).toContain("NOT (");
  },
);

it("keeps plan homes while any run is nonterminal or has outstanding resources", async () => {
  const query = vi
    .fn<DatabaseTransaction["query"]>()
    .mockResolvedValueOnce([[PLAN]])
    .mockResolvedValueOnce([[OLD]]);
  const transaction: DatabaseTransaction = { query, execute: vi.fn() };
  const repository = new AgentEnvironmentRepository({
    query,
    transaction: async (work) => work(transaction),
  });
  const maintain = vi.fn();
  await repository.maintainPlan(PLAN, maintain);
  expect(maintain).not.toHaveBeenCalled();
});

it.each(["running", "pausing", "paused", "stopping", "queued", "unknown"])(
  "retains a %s run in both retention and directory maintenance",
  async (status) => {
    const database = new RetentionDatabase();
    seedRuns(database);
    database.runs.set(OLD, {
      id: OLD,
      planId: PLAN,
      startedAt: "2026-10-13",
      status,
    });
    await purgeObsoletePlanRuns(database);
    const repository = new AgentEnvironmentRepository(database);
    expect(await repository.canRemoveRun(OLD)).toBe(false);
    expect(database.runs.has(OLD)).toBe(true);
    expectSettlementGuards(database.queries.at(-1) ?? "");
  },
);

it.each([
  "lease",
  "workspace-lock",
  "pending-cleanup",
  "api-cleanup",
  "accepted-command",
  "local-owner",
])(
  "waits for %s, then finishes at the next periodic cleanup",
  async (protection) => {
    const database = new RetentionDatabase();
    seedRuns(database);
    const old = database.runs.get(OLD);
    if (!old) throw new Error("Missing fixture run");
    if (protection === "local-owner")
      database.owners.set(INSTANCE, { runId: OLD, released: false });
    else old.protection = protection;
    database.plans.clear();
    expect(await purgeAllPlanRuns(database, PLAN)).toBe(false);
    expect(database.runs.has(OLD)).toBe(true);
    const repository = new AgentEnvironmentRepository(database);
    expect(await repository.canRemoveRun(OLD)).toBe(false);
    expectSettlementGuards(
      database.queries.find((query) => query.includes("FOR UPDATE")) ?? "",
    );
    old.protection = undefined;
    database.owners.set(INSTANCE, { runId: OLD, released: true });
    await purgeObsoletePlanRuns(database);
    expect(database.runs.has(OLD)).toBe(false);
    expect(database.owners.size).toBe(0);
  },
);

it("rechecks protection under a row lock if a selected run became active", async () => {
  const database = new RetentionDatabase();
  seedRuns(database);
  database.beforeLock = () => {
    const run = database.runs.get(OLD);
    if (run) run.status = "running";
  };
  await purgeObsoletePlanRuns(database);
  expect(database.runs.has(OLD)).toBe(true);
  expect(database.deletes).toEqual([]);
});

it("a start-triggered purge includes older recovery and force-release records by started_at", async () => {
  const database = new RetentionDatabase();
  seedRuns(database);
  expect(await purgeEarlierPlanRuns(database, LATEST)).toBe(true);
  expect([...database.runs.keys()]).toEqual([LATEST]);
  expect(database.queries[0]).toContain(
    "(earlier.started_at, earlier.id) < (kept.started_at, kept.id)",
  );
  expect(database.queries[0]).not.toContain("creation_order");
  expect(database.queries[0]).not.toContain("resourceReleases");
});

it("processes a backlog in batches without protected runs starving the removable ones", async () => {
  const database = new RetentionDatabase();
  for (let index = 0; index < 150; index += 1) {
    const id = String(index).padStart(4, "0");
    database.runs.set(id, {
      id,
      planId: PLAN,
      startedAt: "2026-10-13",
      status: index < 70 ? "paused" : "failed",
    });
  }
  await purgeObsoletePlanRuns(database);
  expect(database.runs.size).toBe(86);
  await purgeObsoletePlanRuns(database);
  expect(database.runs.size).toBe(70);
  expect(
    [...database.runs.values()].every((run) => run.status === "paused"),
  ).toBe(true);
});

it("removes triggered session directories across connections and journal payloads, retrying failed deletion", async () => {
  const database = new RetentionDatabase();
  seedRuns(database);
  for (const connection of ["one", "two"])
    files.seed(
      `${ROOT}/agents/${connection}/plan-sessions/${OLD}/transcript`,
      "file",
    );
  const journal = `${ROOT}/local-sessions/${INSTANCE}/journal`;
  files.seed(
    `${journal}/0000000000000001.json`,
    "file",
    JSON.stringify({ payload: "payload-reference" }),
  );
  const removePayload = vi
    .fn()
    .mockRejectedValueOnce(new Error("File busy"))
    .mockResolvedValue(undefined);
  const collector = new AgentDeferredGarbage({
    directory: ROOT,
    removePayload,
    retryDelayMs: 0,
  });
  await purgeObsoletePlanRuns(database);
  collector.schedule(database);
  await collector.idle();
  expect(database.garbage.has(`local-sessions/${INSTANCE}/`)).toBe(true);
  expect(files.entries.has(journal)).toBe(true);
  collector.schedule(database);
  await collector.idle();
  expect(removePayload).toHaveBeenNthCalledWith(2, "payload-reference");
  expect(database.garbage.size).toBe(0);
  expect(
    [...files.entries.keys()].some(
      (location) =>
        location.includes(`/plan-sessions/${OLD}`) ||
        location.includes(`/local-sessions/${INSTANCE}`),
    ),
  ).toBe(false);
  await collector.close();
});

it("sweeps orphan folders on every connection while protecting active run folders", async () => {
  const database = new RetentionDatabase();
  database.plans.add(PLAN);
  database.runs.set(LATEST, {
    id: LATEST,
    planId: PLAN,
    startedAt: "2026-11-14",
    status: "running",
  });
  for (const connection of ["one", "two"])
    for (const id of [OLD, LATEST])
      files.seed(
        `${ROOT}/agents/${connection}/plan-sessions/${id}/transcript`,
        "file",
      );
  await new AgentEnvironmentMaintenance(
    ROOT,
    new AgentEnvironmentRepository(database),
  ).run();
  expect(
    [...files.entries.keys()].filter((location) =>
      location.endsWith("/transcript"),
    ),
  ).toEqual([
    `${ROOT}/agents/one/plan-sessions/${LATEST}/transcript`,
    `${ROOT}/agents/two/plan-sessions/${LATEST}/transcript`,
  ]);
});

it("the payload store deletes journal-named payload files together with the purged run's directories", async () => {
  const database = new RetentionDatabase();
  seedRuns(database);
  const payloadPath = `agent-payloads/${"a".repeat(64)}/${INSTANCE}.payload`;
  const reference = JSON.stringify({
    version: 1,
    path: payloadPath,
    size: 7,
    sha256: "b".repeat(64),
  });
  files.seed(`${ROOT}/${payloadPath}`, "file", "payload");
  files.seed(
    `${ROOT}/local-sessions/${INSTANCE}/journal/0000000000000001.json`,
    "file",
    JSON.stringify({ payload: reference }),
  );
  files.seed(`${ROOT}/agents/one/plan-sessions/${OLD}/transcript`, "file");
  const store = new AgentPayloadFileStore(ROOT);
  await purgeObsoletePlanRuns(database);
  await store.collectGarbage(database);
  await store.settleGarbage();
  expect(files.entries.has(`${ROOT}/${payloadPath}`)).toBe(false);
  expect(files.entries.has(`${ROOT}/local-sessions/${INSTANCE}`)).toBe(false);
  expect(files.entries.has(`${ROOT}/agents/one/plan-sessions/${OLD}`)).toBe(
    false,
  );
  expect(database.garbage.size).toBe(0);
  await store.close();
});
