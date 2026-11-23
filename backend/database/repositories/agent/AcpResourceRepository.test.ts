import { expect, it, vi, type Mock } from "vitest";

import { AcpResourceRepository } from "./AcpResourceRepository";
import { releaseAcpLease } from "./AcpLeaseRelease";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AcpResourceRecord } from "@/definition/AcpResource";

vi.mock("./AcpLeaseRelease", () => ({
  releaseAcpLease: vi.fn(async () => "released"),
}));

const NAMESPACE = {
  pid: 10,
  uid: 1000,
  start: 5,
  boot: "6f1b1a52-7c3c-4a5b-9d54-1a2b3c4d5e6f",
};

const RECORD: AcpResourceRecord = {
  instanceId: "i1",
  userId: "u1",
  provider: "codex_cli",
  runId: "r1",
  stepId: "s1",
  state: "running",
  since: "2026-01-01T00:00:00.000Z",
};

function rowOf(overrides: Record<number, DatabaseValue> = {}): DatabaseValue[] {
  const row: DatabaseValue[] = [
    "i1",
    "u1",
    "codex_cli",
    null,
    null,
    "running",
    "since",
    null,
    null,
    null,
    null,
    null,
  ];
  for (const [index, value] of Object.entries(overrides))
    row[Number(index)] = value;
  return row;
}

function databaseOf(rows: DatabaseValue[][] = []): {
  readonly database: Pick<Database, "query" | "execute">;
  readonly execute: Mock<Database["execute"]>;
  readonly query: Mock<Database["query"]>;
} {
  const execute = vi.fn<Database["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () => rows);
  return { database: { execute, query }, execute, query };
}

it("lists leases with all optional columns", async () => {
  const { database } = databaseOf([
    rowOf({
      3: "r1",
      4: "s1",
      7: JSON.stringify(NAMESPACE),
      8: "process",
      9: "process_alive",
      10: "at",
      11: "unit",
    }),
  ]);
  await expect(new AcpResourceRepository(database).list()).resolves.toEqual([
    {
      instanceId: "i1",
      userId: "u1",
      provider: "codex_cli",
      runId: "r1",
      stepId: "s1",
      state: "running",
      since: "since",
      namespace: NAMESPACE,
      lifecycle: "process",
      check: { reason: "process_alive", at: "at" },
      workerUnit: "unit",
    },
  ]);
});

it("lists leases without optional columns", async () => {
  const { database } = databaseOf([rowOf()]);
  const [lease] = await new AcpResourceRepository(database).list();
  expect(lease).toMatchObject({
    runId: null,
    namespace: null,
    lifecycle: null,
    check: null,
    workerUnit: null,
  });
});

it("accepts every supported provider and state", async () => {
  const providers = ["claude_code", "opencode", "antigravity", "openrouter"];
  const states = ["starting", "idle", "closing", "cleanup_failed"];
  const { database } = databaseOf([
    ...providers.map((provider) => rowOf({ 2: provider })),
    ...states.map((state) => rowOf({ 5: state })),
    rowOf({ 2: "zai" }),
  ]);
  const leases = await new AcpResourceRepository(database).list();
  expect(leases.map((lease) => lease.provider)).toEqual([
    ...providers,
    ...states.map(() => "codex_cli"),
    "opencode",
  ]);
  expect(leases.slice(4, 8).map((lease) => lease.state)).toEqual(states);
});

it("shows an unknown check reason as a failed check", async () => {
  const { database } = databaseOf([rowOf({ 9: "mystery", 10: "at" })]);
  const [lease] = await new AcpResourceRepository(database).list();
  expect(lease?.check).toEqual({ reason: "check_failed", at: "at" });
});

it("ignores a check reason without a time", async () => {
  const { database } = databaseOf([rowOf({ 9: "process_alive" })]);
  const [lease] = await new AcpResourceRepository(database).list();
  expect(lease?.check).toBeNull();
});

it("rejects an unknown provider", async () => {
  const { database } = databaseOf([rowOf({ 2: "other" })]);
  await expect(new AcpResourceRepository(database).list()).rejects.toThrow(
    "Invalid ACP lease provider",
  );
});

it("rejects an unknown state", async () => {
  const { database } = databaseOf([rowOf({ 5: "other" })]);
  await expect(new AcpResourceRepository(database).list()).rejects.toThrow(
    "Invalid ACP lease state",
  );
});

it("rejects an unknown lifecycle", async () => {
  const { database } = databaseOf([rowOf({ 8: "other" })]);
  await expect(new AcpResourceRepository(database).list()).rejects.toThrow(
    "Invalid ACP lease lifecycle",
  );
});

it("saves a record without optional values as nulls", async () => {
  const { database, execute } = databaseOf();
  await new AcpResourceRepository(database).save(RECORD);
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    namespace_identity: null,
    lifecycle: null,
    worker_unit: null,
  });
});

it("saves a record with namespace, lifecycle and worker unit", async () => {
  const { database, execute } = databaseOf();
  await new AcpResourceRepository(database).save({
    ...RECORD,
    namespace: NAMESPACE,
    lifecycle: "spawning",
    workerUnit: "unit",
  });
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    namespace_identity: JSON.stringify(NAMESPACE),
    lifecycle: "spawning",
    worker_unit: "unit",
  });
});

function reservingDatabase(answers: DatabaseValue[][][]): {
  readonly repository: AcpResourceRepository;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
} {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const query = vi.fn<DatabaseTransaction["query"]>(
    async () => answers.shift() ?? [],
  );
  const transaction: DatabaseTransaction = { execute, query };
  const repository = new AcpResourceRepository({
    execute,
    query,
    transaction: async (work) => work(transaction),
  });
  return { repository, execute };
}

it("reserves a slot below the limit", async () => {
  const { repository, execute } = reservingDatabase([[[1]], []]);
  await expect(repository.tryReserve(RECORD, 2)).resolves.toBe(true);
  expect(execute).toHaveBeenCalledOnce();
});

it("refuses a reservation at the limit", async () => {
  const { repository, execute } = reservingDatabase([[[2]]]);
  await expect(repository.tryReserve(RECORD, 2)).resolves.toBe(false);
  expect(execute).not.toHaveBeenCalled();
});

it("refuses a reservation without a count row", async () => {
  const { repository } = reservingDatabase([]);
  await expect(repository.tryReserve(RECORD, 2)).resolves.toBe(false);
});

it("refuses a reservation for an existing instance", async () => {
  const { repository, execute } = reservingDatabase([[[0]], [["i1"]]]);
  await expect(repository.tryReserve(RECORD, 2)).resolves.toBe(false);
  expect(execute).not.toHaveBeenCalled();
});

it("requires transactions for reservations and releases", async () => {
  const { database } = databaseOf();
  const repository = new AcpResourceRepository(database);
  await expect(repository.tryReserve(RECORD, 1)).rejects.toThrow(
    "Shared ACP admission requires database transactions",
  );
  await expect(repository.remove("i1")).rejects.toThrow(
    "Lease release requires a transaction",
  );
});

it("releases a proven lease as owner release", async () => {
  const { repository } = reservingDatabase([]);
  await expect(repository.remove("i1")).resolves.toBeUndefined();
  expect(vi.mocked(releaseAcpLease).mock.calls[0]?.[1]).toEqual({
    instanceId: "i1",
    isUncertain: false,
    reason: "owner_released",
  });
});

it("releases an uncertain lease once its process end is confirmed", async () => {
  const { repository } = reservingDatabase([]);
  await expect(repository.releaseUncertain("i1")).resolves.toBe("released");
  expect(vi.mocked(releaseAcpLease).mock.lastCall?.[1]).toEqual({
    instanceId: "i1",
    isUncertain: true,
    reason: "process_end_confirmed",
  });
});

it("records the result of a periodic check", async () => {
  const { database, execute } = databaseOf();
  await new AcpResourceRepository(database).recordCheck("i1", {
    reason: "unit_active",
    at: "at",
  });
  expect(execute.mock.calls[0]?.[1]).toEqual({
    instance_id: "i1",
    check_reason: "unit_active",
    checked_at: "at",
  });
});

it("returns no run references without run identifiers", async () => {
  const { database, query } = databaseOf();
  await expect(
    new AcpResourceRepository(database).runReferences([]),
  ).resolves.toEqual([]);
  expect(query).not.toHaveBeenCalled();
});

it("reads the plan references of the given runs", async () => {
  const { database, query } = databaseOf([
    ["r1", "p1", "Plan", "start", "done"],
  ]);
  await expect(
    new AcpResourceRepository(database).runReferences(["r1", "r2"]),
  ).resolves.toEqual([
    {
      runId: "r1",
      planId: "p1",
      planName: "Plan",
      startedAt: "start",
      status: "done",
    },
  ]);
  expect(query.mock.calls[0]?.[1]).toEqual({ run_id_0: "r1", run_id_1: "r2" });
});
