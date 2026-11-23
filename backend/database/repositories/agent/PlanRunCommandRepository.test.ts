import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  write: vi.fn(async () => "file-1"),
  read: vi.fn(async () => '{"snapshot":true}'),
  readSnapshot: vi.fn((input: unknown) => ({ parsed: input })),
}));
vi.mock("@/backend/storage/AgentPayloadFileStore", () => ({
  requireAgentFiles: () => ({ write: mocks.write, read: mocks.read }),
}));
vi.mock("@/backend/service/agents/AgentPlanSnapshot", () => ({
  readPlanSnapshot: mocks.readSnapshot,
}));

import { PlanRunCommandRepository } from "./PlanRunCommandRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";

type Call = (...parameters: unknown[]) => Promise<undefined>;

function repositoryOf(rows: unknown[][] = []): {
  repository: PlanRunCommandRepository;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn<Call>(async () => undefined);
  const database = {
    query: vi.fn(async () => rows),
    execute,
    agentFiles: {},
  } as unknown as Database;
  return { repository: new PlanRunCommandRepository(database), execute };
}

beforeEach(() => vi.clearAllMocks());

it("allocates an accepted receipt", () => {
  const receipt = repositoryOf().repository.receipt("r1", "pause");

  expect(receipt).toMatchObject({
    runId: "r1",
    action: "pause",
    status: "accepted",
  });
  expect(receipt.id).toMatch(/^[0-9a-f-]{36}$/u);
});

it("stores a snapshot privately or returns no file", async () => {
  const { repository } = repositoryOf();

  expect(await repository.snapshot("p1", undefined)).toBeNull();
  expect(
    await repository.snapshot("p1", { id: 1 } as unknown as AgentPlanSnapshot),
  ).toBe("file-1");
  expect(mocks.write).toHaveBeenCalledWith("p1", '{"id":1}');
});

it("inserts the command with and without a snapshot file", async () => {
  const { repository } = repositoryOf();
  const execute = vi.fn<Call>(async () => undefined);
  const transaction = { execute } as unknown as DatabaseTransaction;
  const receipt = repository.receipt("r1", "stop");

  await repository.insert(transaction, receipt);
  await repository.insert(transaction, receipt, "f1");

  expect(execute.mock.calls[0]?.[1]).toMatchObject({ snapshot_file: null });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    snapshot_file: "f1",
    run_id: "r1",
    action: "stop",
  });
});

it("reads the pending batch", async () => {
  const { repository } = repositoryOf([
    ["c1", "r1", "start", "t1", null, "accepted"],
    ["c2", "r2", "resume", "t2", "f2", "applied"],
  ]);

  const pending = await repository.pending();

  expect(pending[0]).toEqual({
    receipt: {
      id: "c1",
      runId: "r1",
      action: "start",
      acceptedAt: "t1",
      status: "accepted",
    },
    snapshotFile: null,
  });
  expect(pending[1]?.receipt.status).toBe("applied");
  expect(pending[1]?.snapshotFile).toBe("f2");
});

it("reads a private snapshot only when referenced", async () => {
  const { repository } = repositoryOf();

  expect(await repository.readSnapshot(null)).toBeUndefined();
  expect(await repository.readSnapshot("f1")).toEqual({
    parsed: { snapshot: true },
  });
});

it("reports whether a command is accepted", async () => {
  expect(await repositoryOf([["c1"]]).repository.hasAccepted()).toBe(true);
  expect(await repositoryOf([]).repository.hasAccepted()).toBe(false);
});

it("marks a command applied in the given transaction", async () => {
  const { repository } = repositoryOf();
  const execute = vi.fn<Call>(async () => undefined);

  await repository.applied({ execute } as unknown as DatabaseTransaction, "c1");

  expect(execute.mock.calls[0]?.[1]).toMatchObject({ id: "c1" });
});

it("marks a command failed in the database or a transaction", async () => {
  const { repository, execute } = repositoryOf();
  const inner = vi.fn<Call>(async () => undefined);

  await repository.failed("c1", "boom");
  await repository.failed("c2", "bang", {
    execute: inner,
  } as unknown as DatabaseTransaction);

  expect(execute.mock.calls[0]?.[1]).toMatchObject({ id: "c1", error: "boom" });
  expect(inner.mock.calls[0]?.[1]).toMatchObject({ id: "c2", error: "bang" });
});

it("confirms delivery", async () => {
  const { repository, execute } = repositoryOf();

  await repository.delivered("c1");

  expect(execute.mock.calls[0]?.[1]).toEqual({ id: "c1" });
});

it("reads the latest acknowledgement", async () => {
  expect(await repositoryOf([]).repository.latest("r1")).toBeNull();
  expect(
    await repositoryOf([
      ["c1", "pause", "failed", "t1", "why"],
    ]).repository.latest("r1"),
  ).toEqual({
    id: "c1",
    runId: "r1",
    action: "pause",
    status: "failed",
    acceptedAt: "t1",
    error: "why",
  });
  expect(
    await repositoryOf([
      ["c1", "pause", "applied", "t1", null],
    ]).repository.latest("r1"),
  ).not.toHaveProperty("error");
  await expect(
    repositoryOf([["c1", "pause", "odd", "t1", null]]).repository.latest("r1"),
  ).rejects.toThrow("Invalid run command status");
});
