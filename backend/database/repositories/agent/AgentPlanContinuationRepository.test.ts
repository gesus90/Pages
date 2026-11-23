import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { readPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import { AgentPlanContinuationRepository } from "./AgentPlanContinuationRepository";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { PlanContinuationWrite } from "./AgentPlanContinuationRepository";
import type { AgentPlanRun } from "@/definition/AgentPlan";

vi.mock("@/backend/storage/AgentPayloadFileStore", () => ({
  requireAgentFiles: () => ({
    write: async (...parameters: readonly string[]) => parameters[1],
  }),
  readStoredAgentPayload: async (...parameters: readonly unknown[]) =>
    parameters[1],
}));

const UNBOUNDED: AgentPlanRun = {
  id: "r1",
  planId: "p1",
  planName: "Plan",
  planRevision: 1,
  userId: "u1",
  startedAt: "t0",
  status: "paused",
  stopRequested: false,
  steps: [],
};
const PAUSED: AgentPlanRun = {
  ...UNBOUNDED,
  pauseBoundary: {
    pausedAt: "t1",
    completedStepIds: [],
    pendingStepIds: [],
    frontierStepIds: [],
  },
};
const ADOPTED: AgentPlanRun = {
  ...PAUSED,
  status: "running",
  continuation: { version: 1, planRevision: 2, adoptedAt: "t2" },
};
const SNAPSHOT = readPlanSnapshot({
  plan: { id: "p1", revision: 2, nodes: [{ workspaceId: "w9" }], edges: [] },
  steps: [],
});

interface Setup {
  readonly stored?: DatabaseValue[] | undefined;
  readonly revision?: DatabaseValue[] | undefined;
  readonly locks?: Readonly<Record<string, DatabaseValue[]>>;
}

interface Harness {
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly query: Mock<DatabaseTransaction["query"]>;
  readonly repo: AgentPlanContinuationRepository;
}

function repository(setup: Setup): Harness {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => undefined);
  const query = vi.fn<DatabaseTransaction["query"]>(async (statement, bind) => {
    if (statement.includes("view_json"))
      return setup.stored ? [setup.stored] : [];
    if (statement.includes("revision"))
      return setup.revision ? [setup.revision] : [];
    const lock = setup.locks?.[String(bind?.id)];
    return lock ? [lock] : [];
  });
  const transaction: DatabaseTransaction = { query, execute };
  const database: Pick<Database, "transaction" | "query" | "agentFiles"> = {
    transaction: async (work) => work(transaction),
    query,
  };
  return {
    execute,
    query,
    repo: new AgentPlanContinuationRepository(database),
  };
}

const CURRENT: Setup = {
  stored: [JSON.stringify(PAUSED)],
  revision: [2],
};

function write(
  overrides: Partial<PlanContinuationWrite> = {},
): PlanContinuationWrite {
  return {
    previous: PAUSED,
    run: ADOPTED,
    snapshot: SNAPSHOT,
    workspaceIds: ["w1", "w1", "w2"],
    ...overrides,
  };
}

it("adopts a continuation, reserves new workspaces and journals the run", async () => {
  const { execute, repo } = repository({
    ...CURRENT,
    locks: { w2: ["r1"] },
  });
  const journal = vi.fn(async () => undefined);

  await repo.adopt(write(), journal);

  expect(execute).toHaveBeenCalledTimes(3);
  expect(execute.mock.calls[0]?.[1]).toEqual({ id: "w1", run_id: "r1" });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    version: 1,
    plan_revision: 2,
  });
  expect(execute.mock.calls[2]?.[1]).toMatchObject({ status: "running" });
  expect(journal).toHaveBeenCalledWith(expect.anything(), ADOPTED);
});

it("adopts without a journal", async () => {
  const { execute, repo } = repository(CURRENT);

  await repo.adopt(write({}));

  expect(execute).toHaveBeenCalled();
});

it("refuses a prepared snapshot that is no object", async () => {
  const { repo } = repository(CURRENT);
  const nothing = Object.assign({}, SNAPSHOT, { toJSON: () => null });
  const bad = { ...write(), snapshot: nothing };

  await expect(repo.adopt(bad)).rejects.toThrow("Invalid prepared snapshot.");
});

it("refuses a run that is no longer stored", async () => {
  await expect(repository({}).repo.adopt(write())).rejects.toMatchObject({
    code: "plan_run_unavailable",
  });
});

it("refuses a run that is not the paused view", async () => {
  const running = { ...PAUSED, status: "running" };
  const stopping = { ...PAUSED, stopRequested: true };
  const other = { ...PAUSED, planName: "Other" };

  for (const stored of [running, stopping, other])
    await expect(
      repository({ ...CURRENT, stored: [JSON.stringify(stored)] }).repo.adopt(
        write(),
      ),
    ).rejects.toMatchObject({ code: "plan_conflict" });
});

it("refuses a plan that changed or vanished", async () => {
  for (const revision of [undefined, [3]])
    await expect(
      repository({ ...CURRENT, revision }).repo.adopt(write()),
    ).rejects.toMatchObject({ code: "plan_conflict" });
});

it("refuses a workspace locked by another run", async () => {
  await expect(
    repository({ ...CURRENT, locks: { w1: ["other"] } }).repo.adopt(write()),
  ).rejects.toMatchObject({ code: "plan_workspace_conflict" });
});

it("refuses an adoption without continuation or boundary", async () => {
  const plain: AgentPlanRun = { ...PAUSED, status: "running" };

  await expect(
    repository(CURRENT).repo.adopt(write({ run: plain })),
  ).rejects.toMatchObject({ code: "plan_run_unavailable" });
  await expect(
    repository({ ...CURRENT, stored: [JSON.stringify(UNBOUNDED)] }).repo.adopt(
      write({ previous: UNBOUNDED }),
    ),
  ).rejects.toMatchObject({ code: "plan_run_unavailable" });
});

it("returns the stored bases newest first, parsed or as text", async () => {
  const { repo, query } = repository({});
  query.mockResolvedValue([['{"a":1}'], ["{}"]]);

  expect(await repo.snapshotTexts("r1")).toEqual(['{"a":1}', "{}"]);
  expect(await repo.snapshots("r1")).toEqual([{ a: 1 }, {}]);
});
