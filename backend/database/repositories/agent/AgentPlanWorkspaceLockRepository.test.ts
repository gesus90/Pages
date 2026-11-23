import { beforeEach, expect, it, vi } from "vitest";

import { AgentPlanWorkspaceLockRepository } from "./AgentPlanWorkspaceLockRepository";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AcpResourceRecord } from "@/definition/AcpResource";
import type { AgentPlanRun } from "@/definition/AgentPlan";

const mocks = vi.hoisted(() => ({
  releaseChecked: vi.fn(async () => {}),
  releaseAcpLease: vi.fn(async (): Promise<string> => "released"),
  leases: vi.fn(async (): Promise<readonly unknown[]> => []),
}));

vi.mock("./AgentPlanWorkspaceLockRelease", () => ({
  releaseCheckedWorkspaceLocks: mocks.releaseChecked,
}));
vi.mock("./AcpLeaseRelease", () => ({
  releaseAcpLease: mocks.releaseAcpLease,
}));
vi.mock("./AcpResourceRepository", () => ({
  AcpResourceRepository: class {
    public list = mocks.leases;
  },
}));
vi.mock("@/backend/agents/local/LocalSessionContracts", () => ({
  localOwnerProofSchema: { parse: (value: unknown) => value },
}));

const run: AgentPlanRun = {
  id: "run",
  planId: "plan",
  planName: "Plan",
  planRevision: 1,
  userId: "user",
  startedAt: "2026-01-01T00:00:00.000Z",
  status: "failed",
  stopRequested: false,
  steps: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

function transactionOf(rows: readonly (readonly DatabaseValue[])[] = []): {
  readonly transaction: DatabaseTransaction;
  readonly execute: ReturnType<typeof vi.fn<DatabaseTransaction["execute"]>>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(async () =>
    rows.map((row) => [...row]),
  );
  return { transaction: { query, execute }, execute };
}

function repositoryOf(rows: readonly (readonly DatabaseValue[])[] = []): {
  readonly repository: AgentPlanWorkspaceLockRepository;
  readonly transaction: DatabaseTransaction;
} {
  const { transaction } = transactionOf();
  const query = vi.fn<Database["query"]>(async () =>
    rows.map((row) => [...row]),
  );
  const repository = new AgentPlanWorkspaceLockRepository({
    query,
    transaction: async (work) => work(transaction),
  });
  return { repository, transaction };
}

it("lists the retained locks with normalized timestamps", async () => {
  const { repository } = repositoryOf([
    ["ws-1", "2026-01-01 10:00:00", JSON.stringify(run)],
    ["ws-2", "2026-01-01T11:00:00.000Z", JSON.stringify(run)],
  ]);

  const locks = await repository.list();

  expect(locks.map((lock) => lock.acquiredAt)).toEqual([
    "2026-01-01T10:00:00Z",
    "2026-01-01T11:00:00.000Z",
  ]);
  expect(locks[0]?.resource).toBe("ws-1");
  expect(locks[0]?.run.id).toBe("run");
});

it("releases a checked owner and writes the journal", async () => {
  const { repository, transaction } = repositoryOf();
  const verify = vi.fn(async () => {});
  const journal = vi.fn(async () => {});

  await repository.release(run, verify, "reason", journal);

  expect(verify).toHaveBeenCalledWith(transaction);
  expect(mocks.releaseChecked).toHaveBeenCalledWith(transaction, run, "reason");
  expect(journal).toHaveBeenCalledWith(transaction);
});

it("releases without a journal", async () => {
  const { repository } = repositoryOf();

  await repository.release(run, async () => {}, "reason");

  expect(mocks.releaseChecked).toHaveBeenCalledTimes(1);
});

it("reads the native owners with and without proof", async () => {
  const { repository } = repositoryOf();
  const { transaction } = transactionOf([
    ["one", null],
    ["two", JSON.stringify({ unit: "u" })],
  ]);

  await expect(repository.owners(transaction, "run")).resolves.toEqual([
    { instanceId: "one", proof: null },
    { instanceId: "two", proof: { unit: "u" } },
  ]);
});

it("keeps only the leases of the run", async () => {
  const { repository, transaction } = repositoryOf();
  mocks.leases.mockResolvedValueOnce([
    { instanceId: "a", runId: "run" },
    { instanceId: "b", runId: "other" },
    { instanceId: "c", runId: null },
  ]);

  const leases = await repository.leases(transaction, "run");

  expect(leases.map((lease) => lease.instanceId)).toEqual(["a"]);
});

function leaseOf(runId: string | null): AcpResourceRecord {
  return {
    instanceId: "lease",
    userId: "user",
    provider: "codex_cli",
    runId,
    stepId: null,
    state: "cleanup_failed",
    since: "2026-01-01T00:00:00.000Z",
  };
}

it("releases an uncertain lease of a run", async () => {
  const { repository, transaction } = repositoryOf();

  await repository.releaseLease(transaction, leaseOf("run"));

  expect(mocks.releaseAcpLease).toHaveBeenCalledWith(transaction, {
    instanceId: "lease",
    isUncertain: true,
    runId: "run",
    reason: "writer_processes_ended",
  });
});

it("refuses to release a lease without a run", async () => {
  const { repository, transaction } = repositoryOf();

  await expect(
    repository.releaseLease(transaction, leaseOf(null)),
  ).rejects.toMatchObject({ code: "cleanup_unconfirmed" });
});

it("refuses a lease that changed meanwhile", async () => {
  const { repository, transaction } = repositoryOf();
  mocks.releaseAcpLease.mockResolvedValueOnce("changed");

  await expect(
    repository.releaseLease(transaction, leaseOf("run")),
  ).rejects.toMatchObject({ code: "cleanup_unconfirmed" });
});

it("records a dead native owner as released", async () => {
  const { repository } = repositoryOf();
  const { transaction, execute } = transactionOf();

  await repository.releaseOwner(transaction, "instance");

  expect(execute.mock.calls[0]?.[1]).toEqual({ instance_id: "instance" });
});
