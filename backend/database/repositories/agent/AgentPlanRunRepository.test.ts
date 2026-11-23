import { beforeEach, expect, it, vi } from "vitest";

import { AgentPlanRunRepository } from "./AgentPlanRunRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { PlanContinuationWrite } from "./AgentPlanContinuationRepository";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  read: vi.fn(),
  readPlanRun: vi.fn((input: unknown) => input),
  readPlanBranchState: vi.fn((input: unknown) => input),
  requireReferences: vi.fn(),
  reservePlanResources: vi.fn(),
  retireRestartSource: vi.fn(),
  findPlanResourceBlocker: vi.fn(),
  snapshotTexts: vi.fn(),
  snapshots: vi.fn(),
  adopt: vi.fn(),
  progressUpdate: vi.fn(),
  interrupt: vi.fn(),
  resetRemoteRetry: vi.fn(),
  releaseCheckedWorkspaceLocks: vi.fn(),
  queueEarlierRunPurge: vi.fn(),
  bases: vi.fn(),
  planRunResourcesOf: vi.fn(),
  logCaughtError: vi.fn(),
}));

vi.mock("@/backend/storage/AgentPayloadFileStore", () => ({
  requireAgentFiles: () => ({ write: mocks.write, read: mocks.read }),
}));
vi.mock("@/backend/agents/AgentWorkspaceReferences", () => ({
  workspaceReferenceIds: () => new Set(["w1"]),
}));
vi.mock("@/backend/agents/AgentPlanRunInput", () => ({
  readPlanRun: mocks.readPlanRun,
}));
vi.mock(
  "@/backend/service/agents/branching/AgentPlanBranchPersistence",
  () => ({ readPlanBranchState: mocks.readPlanBranchState }),
);
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
}));
vi.mock("./AgentWorkspaceReferencesRepository", () => ({
  AgentWorkspaceReferencesRepository: class {
    public requireReferences = mocks.requireReferences;
  },
}));
vi.mock("./AgentPlanResourceReservation", () => ({
  reservePlanResources: mocks.reservePlanResources,
  retireRestartSource: mocks.retireRestartSource,
  findPlanResourceBlocker: mocks.findPlanResourceBlocker,
}));
vi.mock("./AgentPlanContinuationRepository", () => ({
  AgentPlanContinuationRepository: class {
    public snapshotTexts = mocks.snapshotTexts;
    public snapshots = mocks.snapshots;
    public adopt = mocks.adopt;
  },
}));
vi.mock("./AgentPlanProgressRepository", () => ({
  AgentPlanProgressRepository: class {
    public update = mocks.progressUpdate;
    public interrupt = mocks.interrupt;
    public resetRemoteRetry = mocks.resetRemoteRetry;
  },
}));
vi.mock("./AgentPlanWorkspaceLockRelease", () => ({
  releaseCheckedWorkspaceLocks: mocks.releaseCheckedWorkspaceLocks,
}));
vi.mock("./AgentPlanRunPurge", () => ({
  queueEarlierRunPurge: mocks.queueEarlierRunPurge,
}));
vi.mock("./AgentPlanRunVisibilityRepository", () => ({
  AgentPlanRunVisibilityRepository: class {
    public bases = mocks.bases;
  },
  planRunResourcesOf: mocks.planRunResourcesOf,
  readRunStatus: (input: string) => input,
}));

const emptyRecord: unknown = {};
const sessionRecord = emptyRecord as AgentPlanSessionRecord;
const continuation = { adopted: true } as unknown as Omit<
  PlanContinuationWrite,
  "run"
>;
const JSON_RUN = JSON.stringify({ id: "r1" });
const snapshot = { plan: { id: "p1", projectId: "pr", workspaceId: "ws" } };
const run = (extra: Record<string, unknown> = {}): AgentPlanRun =>
  ({
    id: "r1",
    planId: "p1",
    userId: "u1",
    planRevision: 3,
    startedAt: "2026-01-01",
    status: "running",
    ...extra,
  }) as unknown as AgentPlanRun;

function fixture(rows: unknown[][] = []): {
  readonly database: {
    readonly query: ReturnType<typeof vi.fn<Database["query"]>>;
  };
  readonly transaction: {
    readonly query: ReturnType<typeof vi.fn<DatabaseTransaction["query"]>>;
    readonly execute: ReturnType<typeof vi.fn<DatabaseTransaction["execute"]>>;
  };
  readonly repository: AgentPlanRunRepository;
} {
  const transaction = {
    query: vi.fn<DatabaseTransaction["query"]>(async () => rows as never),
    execute: vi.fn<DatabaseTransaction["execute"]>(async () => undefined),
  };
  const database = {
    query: vi.fn<Database["query"]>(async () => rows as never),
    execute: vi.fn(),
    agentFiles: {},
    transaction: vi.fn(async (work: (t: DatabaseTransaction) => unknown) =>
      work(transaction as unknown as DatabaseTransaction),
    ),
  };
  return {
    database,
    transaction,
    repository: new AgentPlanRunRepository(
      database as unknown as ConstructorParameters<
        typeof AgentPlanRunRepository
      >[0],
    ),
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.readPlanRun.mockImplementation((input: unknown) => input);
  mocks.readPlanBranchState.mockImplementation((input: unknown) => input);
  mocks.write.mockResolvedValue(JSON.stringify({ file: "f" }));
});

async function prepared(repository: AgentPlanRunRepository): Promise<void> {
  await repository.prepareSnapshot("r1", snapshot as AgentPlanSnapshot);
}

it("prepares a snapshot once per run and snapshot", async () => {
  const { repository } = fixture();

  await prepared(repository);
  await prepared(repository);

  expect(mocks.write).toHaveBeenCalledTimes(1);
  await repository.prepareSnapshot("r2", snapshot as AgentPlanSnapshot);
  expect(mocks.write).toHaveBeenCalledTimes(2);
});

it("refuses a prepared reference that is not an object", async () => {
  const { repository } = fixture();
  mocks.write.mockResolvedValue("null");

  await expect(prepared(repository)).rejects.toThrow(
    "Invalid prepared snapshot.",
  );
});

it("creates a run in one transaction with its journal", async () => {
  const { repository, transaction } = fixture([[3]]);
  const journal = vi.fn();
  mocks.reservePlanResources.mockResolvedValue(true);
  // The active-run query shares the answer of the revision query, so answer them in turn.
  transaction.query
    .mockResolvedValueOnce([[3]] as never)
    .mockResolvedValueOnce([] as never);

  await repository.create(
    run(),
    snapshot as AgentPlanSnapshot,
    ["w1"],
    journal,
  );

  expect(transaction.execute.mock.calls[0]?.[1]).toMatchObject({
    id: "r1",
    project_id: "pr",
    snapshot_json: "{}",
  });
  expect(mocks.queueEarlierRunPurge).toHaveBeenCalledWith(transaction, "r1");
  expect(journal).toHaveBeenCalled();
});

it("creates a run without a journal and keeps earlier runs on recovery", async () => {
  const { repository, transaction } = fixture();
  transaction.query
    .mockResolvedValueOnce([[3]] as never)
    .mockResolvedValueOnce([] as never);

  await repository.create(
    run({ origin: { kind: "restart" } }),
    snapshot as AgentPlanSnapshot,
    [],
  );

  expect(mocks.queueEarlierRunPurge).not.toHaveBeenCalled();
});

it("requires a synchronized snapshot before inserting", async () => {
  const { repository, transaction } = fixture();

  await expect(
    repository.insert(
      transaction as unknown as DatabaseTransaction,
      run(),
      snapshot as AgentPlanSnapshot,
      [],
    ),
  ).rejects.toThrow("synchronized");
});

it("refuses a stale plan revision or a missing plan", async () => {
  const { repository, transaction } = fixture();
  await prepared(repository);
  const insert = (): Promise<void> =>
    repository.insert(transaction, run(), snapshot as AgentPlanSnapshot, []);
  transaction.query.mockResolvedValueOnce([[9]] as never);
  await expect(insert()).rejects.toMatchObject({ code: "plan_conflict" });
  transaction.query.mockResolvedValueOnce([] as never);
  await expect(insert()).rejects.toMatchObject({ code: "plan_conflict" });
});

it("refuses a start while another run is active", async () => {
  const { repository, transaction } = fixture();
  await prepared(repository);
  transaction.query
    .mockResolvedValueOnce([[3]] as never)
    .mockResolvedValueOnce([["other"]] as never);

  await expect(
    repository.insert(
      transaction as unknown as DatabaseTransaction,
      run(),
      snapshot as AgentPlanSnapshot,
      [],
    ),
  ).rejects.toMatchObject({ runId: "other" });
});

it("reads the active and the latest run of a plan", async () => {
  const { repository, database } = fixture([[JSON_RUN]]);

  expect(await repository.activeForPlan("p1")).toEqual({ id: "r1" });
  expect(await repository.latest("p1")).toEqual({ id: "r1" });
  database.query.mockResolvedValue([]);
  expect(await repository.activeForPlan("p1")).toBeNull();
  expect(await repository.latest("p1")).toBeNull();
});

it("acknowledges an own run", async () => {
  const { repository, transaction } = fixture();
  const journal = vi.fn();
  const own = { id: "r1", planId: "p1", userId: "u1" };
  transaction.query.mockResolvedValue([[JSON.stringify(own)]] as never);

  expect(await repository.acknowledge(run(), journal)).toEqual(own);
  expect(await repository.acknowledge(run())).toEqual(own);
  expect(journal).toHaveBeenCalledTimes(1);
});

it("refuses to acknowledge a missing or foreign run", async () => {
  const { repository, transaction } = fixture();
  transaction.query.mockResolvedValueOnce([] as never);
  await expect(repository.acknowledge(run())).rejects.toMatchObject({
    code: "plan_run_unavailable",
  });
  transaction.query.mockResolvedValueOnce([
    [JSON.stringify({ userId: "x", planId: "p1" })],
  ] as never);
  await expect(repository.acknowledge(run())).rejects.toMatchObject({
    code: "plan_access_denied",
  });
  transaction.query.mockResolvedValueOnce([
    [JSON.stringify({ userId: "u1", planId: "x" })],
  ] as never);
  await expect(repository.acknowledge(run())).rejects.toMatchObject({
    code: "plan_access_denied",
  });
});

it("reserves resources and names a blocker in a transaction", async () => {
  const { repository, transaction } = fixture();
  mocks.reservePlanResources.mockResolvedValue(true);
  mocks.findPlanResourceBlocker.mockResolvedValue(null);

  expect(await repository.reserve("r1", ["k"])).toBe(true);
  expect(await repository.resourceBlocker(run(), ["k"])).toBeNull();
  expect(mocks.reservePlanResources).toHaveBeenCalledWith(transaction, "r1", [
    "k",
  ]);
});

it("tells whether a run holds a reservation", async () => {
  const { repository, database } = fixture([["w"]]);
  expect(await repository.hasReservation("r1")).toBe(true);
  database.query.mockResolvedValue([]);
  expect(await repository.hasReservation("r1")).toBe(false);
});

it("finds a foreign workspace reservation", async () => {
  const { repository, database } = fixture();
  database.query
    .mockResolvedValueOnce([["r1"]] as never)
    .mockResolvedValueOnce([] as never)
    .mockResolvedValueOnce([["r2"]] as never);

  expect(
    await repository.findWorkspaceReservation(["a", "a", "b", "c"], "r1"),
  ).toBe("c");
  database.query.mockResolvedValue([]);
  expect(await repository.findWorkspaceReservation(["a"])).toBeNull();
});

it("names the holder of a working copy", async () => {
  const { repository, database } = fixture();
  database.query
    .mockResolvedValueOnce([] as never)
    .mockResolvedValueOnce([["r2"]] as never);

  expect(await repository.workspaceReservationHolder(["a", "b"])).toBe("r2");
  database.query.mockResolvedValue([]);
  expect(await repository.workspaceReservationHolder(["a"])).toBeNull();
});

it("finds a run with its manual input", async () => {
  const { repository, database } = fixture([[JSON_RUN, "2026-02-02"]]);

  expect(await repository.find("r1")).toEqual({
    id: "r1",
    manualInputAt: "2026-02-02",
  });
  database.query.mockResolvedValue([[JSON_RUN, null]]);
  expect(await repository.find("r1")).toEqual({ id: "r1" });
  database.query.mockResolvedValue([]);
  expect(await repository.find("r1")).toBeNull();
});

it("reports a damaged run record as unreadable", async () => {
  const { repository } = fixture([["{", null]]);

  await expect(repository.find("r1")).rejects.toMatchObject({
    code: "plan_run_unreadable",
  });
  expect(mocks.logCaughtError).toHaveBeenCalled();
});

it("names owner and plan of a run", async () => {
  const { repository, database } = fixture([["u1", "p1"]]);

  expect(await repository.ownership("r1")).toEqual({
    userId: "u1",
    planId: "p1",
  });
  database.query.mockResolvedValue([]);
  expect(await repository.ownership("r1")).toBeNull();
});

it("reads the resources of a run", async () => {
  const { repository } = fixture();
  mocks.snapshotTexts.mockResolvedValueOnce([]);
  await expect(repository.resources("r1")).rejects.toMatchObject({
    code: "plan_access_denied",
  });
  mocks.snapshotTexts.mockResolvedValue(["{}"]);
  mocks.planRunResourcesOf.mockReturnValueOnce({ projectId: "pr" });
  expect(await repository.resources("r1")).toEqual({ projectId: "pr" });
  mocks.planRunResourcesOf.mockImplementationOnce(() => {
    throw new Error("bad");
  });
  await expect(repository.resources("r1")).rejects.toMatchObject({
    code: "plan_run_unreadable",
  });
});

it("reads the current snapshot", async () => {
  const { repository } = fixture();
  mocks.snapshots.mockResolvedValueOnce([{ a: 1 }]).mockResolvedValueOnce([]);

  expect(await repository.snapshot("r1")).toEqual({ a: 1 });
  expect(await repository.snapshot("r1")).toBeNull();
});

it("reads the engine state of a run", async () => {
  const { repository, database } = fixture([["file"]]);
  mocks.read.mockResolvedValue(JSON.stringify({ state: 1 }));

  expect(await repository.engineState("r1")).toEqual({ state: 1 });
  database.query.mockResolvedValue([[null]]);
  expect(await repository.engineState("r1")).toBeUndefined();
  database.query.mockResolvedValue([]);
  expect(await repository.engineState("r1")).toBeUndefined();
});

it("names the agent of a step", async () => {
  const { repository } = fixture();
  const entries = (steps: unknown): unknown[] => [{ steps }];
  mocks.snapshots
    .mockResolvedValueOnce(
      entries([
        { step: { id: "other", agentId: "x" } },
        { step: { id: "s1", agentId: "a1" } },
      ]),
    )
    .mockResolvedValueOnce(entries([{ step: { id: "s1" } }]))
    .mockResolvedValueOnce(entries("none"));

  expect(await repository.stepAgent("r1", "s1")).toBe("a1");
  expect(await repository.stepAgent("r1", "s1")).toBeNull();
  expect(await repository.stepAgent("r1", "s1")).toBeNull();
});

it("lists unfinished, resumable and reserving runs", async () => {
  const { repository } = fixture([[JSON_RUN]]);

  expect(await repository.unfinished()).toEqual([{ id: "r1" }]);
  expect(await repository.pendingAutomaticResumes()).toEqual([{ id: "r1" }]);
  expect(await repository.reserving()).toEqual([{ id: "r1" }]);
  expect(await repository.active("u1")).toEqual([{ id: "r1" }]);
});

it("delegates interruption, retry reset and updates", async () => {
  const { repository } = fixture();
  const journal = vi.fn();
  mocks.resetRemoteRetry.mockResolvedValue({ id: "r1" });

  await repository.interrupt(run());
  expect(await repository.resetRemoteRetry("r1", "s", sessionRecord)).toEqual({
    id: "r1",
  });
  await repository.update(run(), undefined, undefined, journal);
  await repository.update(run(), undefined, continuation, journal);
  await repository.visibilityBases("u1", "p1");

  expect(mocks.interrupt).toHaveBeenCalled();
  expect(mocks.progressUpdate).toHaveBeenCalledTimes(1);
  expect(mocks.adopt).toHaveBeenCalledTimes(1);
  expect(mocks.bases).toHaveBeenCalledWith("u1", "p1");
});

it("releases the workspaces of an ended run", async () => {
  const { repository, transaction } = fixture();
  transaction.query.mockResolvedValueOnce([] as never);
  await repository.release("r1");
  expect(mocks.releaseCheckedWorkspaceLocks).not.toHaveBeenCalled();

  transaction.query.mockResolvedValueOnce([[JSON_RUN]] as never);
  await repository.release("r1");
  expect(mocks.releaseCheckedWorkspaceLocks).toHaveBeenCalledWith(
    transaction,
    { id: "r1" },
    "cleanup_confirmed",
  );
});

it("lists the history and skips damaged records", async () => {
  const { repository } = fixture([[JSON_RUN], ["{"]]);

  expect(await repository.list("u1", "p1")).toEqual([{ id: "r1" }]);
  expect(mocks.logCaughtError).toHaveBeenCalledTimes(1);
});

it("lists run entries in both orders", async () => {
  const { repository, database } = fixture([
    ["r1", "t", "running", "2026-03-03"],
    ["r2", "t", "failed", null],
  ]);

  const newest = await repository.entries("u1", "p1", "newest");
  await repository.entries(null, "p1", "oldest");

  expect(newest).toEqual([
    {
      id: "r1",
      startedAt: "t",
      status: "running",
      manualInputAt: "2026-03-03",
    },
    { id: "r2", startedAt: "t", status: "failed" },
  ]);
  expect(String(database.query.mock.calls[0]?.[0])).toContain("DESC");
  expect(String(database.query.mock.calls[1]?.[0])).toContain("ASC");
});

it("lists the runs of a whole team", async () => {
  const { repository } = fixture([
    ["r1", "t", "running", "2026-03-03", "u1"],
    ["r2", "t", "failed", null, "u2"],
  ]);

  expect(await repository.teamEntries("p1", "newest")).toEqual([
    {
      id: "r1",
      startedAt: "t",
      status: "running",
      userId: "u1",
      manualInputAt: "2026-03-03",
    },
    { id: "r2", startedAt: "t", status: "failed", userId: "u2" },
  ]);
  await repository.teamEntries("p1", "oldest");
});

it("lists the latest run of every plan of a person", async () => {
  const { repository } = fixture([["p1", "r1", "running", "t", 4]]);

  expect(await repository.latestOwn("u1")).toEqual([
    { planId: "p1", id: "r1", status: "running", startedAt: "t", revision: 4 },
  ]);
});
