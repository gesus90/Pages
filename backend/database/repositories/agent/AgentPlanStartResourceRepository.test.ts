import { beforeEach, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";

import { AgentPlanStartResourceRepository } from "./AgentPlanStartResourceRepository";

import type { Database } from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanResourceRelease } from "@/definition/AgentPlanResourceRelease";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  log: vi.fn(),
  notify: vi.fn(),
  returnLocks: vi.fn(),
}));

vi.mock("@/backend/storage/AgentPayloadFileStore", () => ({
  readStoredAgentPayload: mocks.read,
}));
vi.mock("@/backend/logging/Logger", () => ({ logEvent: mocks.log }));
vi.mock("@/backend/agents/AgentPlanRunInput", () => ({
  readPlanRun: (input: unknown) => input,
}));
vi.mock("@/backend/service/agents/AgentPlanSnapshot", () => ({
  readPlanSnapshot: (input: unknown) => input,
}));
vi.mock("@/backend/service/agents/AgentPlanContinuation", () => ({
  planWritingWorkspaces: (snapshot: { resources: string[] }) =>
    snapshot.resources,
}));
vi.mock("@/backend/service/agents/AgentPlanWriterResources", () => ({
  expandedPlanWriteResources: async (keys: readonly string[]) => keys,
  planWriterResourcesCollide: (a: string, b: string) => a === b,
  isConcretePlanWriterResource: (key: string) => key.startsWith("c:"),
}));
vi.mock("@/backend/service/agents/AgentPlanRunObservers", () => ({
  sharedAgentPlanRunObservers: () => ({ notify: mocks.notify }),
}));
vi.mock("./AgentPlanContinuationRepository", () => ({
  CURRENT_PLAN_SNAPSHOT: "snapshot_expression",
}));
vi.mock("./AgentPlanHandoverLocks", () => ({
  returnHandedOverPlanLocks: mocks.returnLocks,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function run(fields: Record<string, unknown> = {}): AgentPlanRun {
  return {
    id: "r1",
    planId: "p1",
    status: "cancelled",
    steps: [],
    ...fields,
  } as unknown as AgentPlanRun;
}

function release(
  fields: Record<string, unknown> = {},
): AgentPlanResourceRelease {
  return {
    id: "rel1",
    createdAt: "T",
    confirmed: true,
    ...fields,
  } as unknown as AgentPlanResourceRelease;
}

interface FakeTransaction {
  readonly query: Mock;
  readonly execute: Mock;
  readonly onCommit: Mock;
}

interface Setup {
  readonly transaction: FakeTransaction;
  readonly query: Mock;
  readonly commits: Array<() => Promise<void>>;
  readonly repository: AgentPlanStartResourceRepository;
}

function setup(rows: unknown[][]): Setup {
  const commits: Array<() => Promise<void>> = [];
  const transaction = {
    query: vi.fn(async () => rows),
    execute: vi.fn(async () => undefined),
    onCommit: vi.fn((hook: () => Promise<void>) => commits.push(hook)),
  };
  const query = vi.fn(async () => rows);
  const database = {
    query,
    transaction: async (work: (t: typeof transaction) => unknown) =>
      work(transaction),
    agentFiles: {},
  } as unknown as Pick<Database, "query" | "transaction" | "agentFiles">;
  return {
    transaction,
    query,
    commits,
    repository: new AgentPlanStartResourceRepository(database),
  };
}

function ownerRow(
  fields: Record<string, unknown>,
  snapshot: unknown,
  lock: string | null,
): unknown[] {
  return [JSON.stringify(run(fields)), snapshot, lock];
}

it("finds owners by source, same plan and colliding resources", async () => {
  const { repository } = setup([
    ownerRow({ id: "src" }, null, "c:x"),
    ownerRow({ id: "same", status: "running" }, null, "c:y"),
    ownerRow({ id: "same-ended", planId: "p1" }, null, "c:y"),
    ownerRow({ id: "other", planId: "p2" }, null, "c:a"),
    ownerRow({ id: "other", planId: "p2" }, null, "c:a"),
    ownerRow({ id: "free", planId: "p2" }, null, null),
  ]);

  const owners = await repository.conflicts("p1", ["c:a"], "src");

  expect(owners.map((owner) => owner.run.id)).toEqual(["src", "same", "other"]);
  expect(owners[2]?.resources).toEqual(["c:a"]);
});

it("passes null for a missing source run", async () => {
  const { repository, query } = setup([]);

  expect(await repository.conflicts("p1", ["c:a"])).toEqual([]);
  expect(query.mock.calls[0]).toMatchObject({
    1: { plan_id: "p1", source_run_id: null },
  });
});

it("keeps a bare lock list for a run without a snapshot text", async () => {
  const { repository } = setup([ownerRow({ planId: "p2" }, null, "legacy")]);

  expect(await repository.conflicts("p1", ["c:a"])).toEqual([]);
});

it("reads the snapshot for an owner with legacy locks", async () => {
  mocks.read.mockResolvedValue(JSON.stringify({ resources: ["c:a"] }));
  const { repository } = setup([
    ownerRow({ planId: "p2" }, "snap", "legacy"),
    ownerRow({ id: "r3", planId: "p2" }, "snap", null),
  ]);

  const owners = await repository.conflicts("p1", ["c:a"]);

  expect(owners.map((owner) => owner.resources)).toEqual([["c:a"], ["c:a"]]);
});

it("counts only the lock rows when the snapshot payload is gone", async () => {
  mocks.read.mockRejectedValue(new AgentError("plan_payload_missing"));
  const { repository } = setup([
    ownerRow({ id: "src", planId: "p2" }, "snap", "legacy"),
  ]);

  const owners = await repository.conflicts("p1", ["c:a"], "src");

  expect(owners[0]?.resources).toEqual(["legacy"]);
  expect(mocks.log).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "agent.plan.start.owner_snapshot_missing",
    }),
  );
});

it("rethrows other snapshot failures", async () => {
  mocks.read.mockRejectedValue(new AgentError("plan_invalid"));
  const { repository } = setup([ownerRow({}, "snap", "legacy")]);

  await expect(repository.conflicts("p1", ["c:a"])).rejects.toMatchObject({
    code: "plan_invalid",
  });
  mocks.read.mockRejectedValue(new Error("disk"));
  await expect(repository.conflicts("p1", ["c:a"])).rejects.toThrow("disk");
});

it("lists the unreleased native owners of a run", async () => {
  const { repository } = setup([["i1"], ["i2"]]);

  expect(await repository.localOwners("r1")).toEqual(["i1", "i2"]);
});

it("retires an active run and fences its unfinished steps", async () => {
  const steps = [
    { id: "a", status: "running" },
    { id: "b", status: "waiting" },
    { id: "c", status: "succeeded" },
  ];
  const { repository, transaction, commits } = setup([
    [JSON.stringify(run({ status: "running", steps }))],
  ]);

  const retired = await repository.retire("r1", release(), {
    preserveRevision: false,
  });
  await commits[0]?.();

  expect(retired.status).toBe("cancelled");
  expect(retired.steps.map((step) => step.status)).toEqual([
    "cancelled",
    "cancelled",
    "succeeded",
  ]);
  expect(retired.steps[0]).toMatchObject({ cancellation: "requested" });
  expect(retired.steps[1]).toMatchObject({ cancellation: "not_started" });
  expect(transaction.execute.mock.calls[0]).toMatchObject({
    1: { advance: 1 },
  });
  expect(mocks.notify).toHaveBeenCalledTimes(1);
});

it("only appends the release to an ended run and keeps its revision", async () => {
  const { repository, transaction } = setup([
    [JSON.stringify(run({ resourceReleases: [release({ id: "old" })] }))],
  ]);
  Reflect.deleteProperty(transaction, "onCommit");

  const retired = await repository.retire("r1", release(), {
    preserveRevision: true,
  });

  expect(retired.status).toBe("cancelled");
  expect(retired.resourceReleases).toHaveLength(2);
  expect(transaction.execute.mock.calls[0]).toMatchObject({
    1: { advance: 0 },
  });
});

it("fails to retire a run that is gone", async () => {
  const { repository } = setup([]);

  await expect(
    repository.retire("r1", release(), { preserveRevision: false }),
  ).rejects.toThrow();
});

it("frees every resource once the release is confirmed", async () => {
  const { repository, transaction } = setup([
    [
      JSON.stringify(
        run({
          resourceReleases: [
            release({ confirmed: false }),
            release({ id: "x" }),
          ],
          runnerJobs: [{ closeout: "confirmed" }],
        }),
      ),
    ],
  ]);

  await repository.complete("r1", release(), { preserveRevision: false });

  expect(transaction.execute).toHaveBeenCalledTimes(4);
  expect(mocks.returnLocks).toHaveBeenCalledWith(transaction, "r1");
});

it("frees resources of a run without release list or jobs", async () => {
  const { repository, transaction } = setup([[JSON.stringify(run())]]);

  await repository.complete("r1", release(), { preserveRevision: true });

  expect(transaction.execute).toHaveBeenCalledTimes(4);
});

it("keeps the reservations while cleanup is unconfirmed", async () => {
  const unconfirmed = setup([[JSON.stringify(run())]]);
  const open = setup([
    [JSON.stringify(run({ runnerJobs: [{ closeout: "pending" }] }))],
  ]);

  await unconfirmed.repository.complete("r1", release({ confirmed: false }), {
    preserveRevision: false,
  });
  await open.repository.complete("r1", release(), { preserveRevision: false });

  expect(unconfirmed.transaction.execute).toHaveBeenCalledTimes(1);
  expect(open.transaction.execute).toHaveBeenCalledTimes(1);
});
