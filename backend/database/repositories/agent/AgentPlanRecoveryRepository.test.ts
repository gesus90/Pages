import { beforeEach, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { AgentPlanRecoveryRepository } from "./AgentPlanRecoveryRepository";

import type { AgentPlanRecoveryCommand } from "@/definition/AgentPlanRecovery";

const mocks = vi.hoisted(() => ({
  canRecord: vi.fn(),
  checkpoint: vi.fn(),
}));

vi.mock("@/backend/storage/AgentPayloadFileStore", () => ({
  readStoredAgentPayload: async (...args: [unknown, string]) => args[1],
}));
vi.mock("@/backend/agents/AgentPlanRunInput", () => ({
  readPlanRun: (input: unknown) => input,
}));
vi.mock("@/backend/agents/AgentPlanInput", () => ({
  readPlanText: (input: unknown) => input,
}));
vi.mock("@/backend/agents/AgentPlanRecoveryInput", () => ({
  readPlanRecoveryCommand: (input: unknown) => input,
  readPlanContentDigest: (input: unknown) => input,
  readPlanRecoveryResult: (input: unknown) => input,
  readPlanRepairAttempt: (input: unknown) => input,
}));
vi.mock("@/definition/AgentPlanRecovery", () => ({
  canRecordPlanRepair: mocks.canRecord,
}));
vi.mock("./AgentPlanContinuationRepository", () => ({
  CURRENT_PLAN_SNAPSHOT: "snapshot_expression",
}));
vi.mock("./AgentPlanCheckpointRepository", () => ({
  AgentPlanCheckpointRepository: class {
    public find = mocks.checkpoint;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canRecord.mockReturnValue(true);
  mocks.checkpoint.mockResolvedValue(null);
});

const SNAPSHOT = JSON.stringify({
  steps: [
    { step: { type: "agent", id: "s1" } },
    { step: { type: "script", id: "s2" } },
  ],
});

interface Fixture {
  readonly rows?: unknown[][];
  readonly revision?: unknown;
  readonly snapshot?: string;
  readonly replay?: unknown[][];
  readonly run?: Record<string, unknown>;
}

type ExecuteFunction = (sql: string, params: unknown) => Promise<void>;

interface FakeTransaction {
  readonly query: Mock<(sql: string) => Promise<unknown[][]>>;
  readonly execute: Mock<ExecuteFunction>;
}

interface Built extends FakeTransaction {
  readonly work: <Result>(
    body: (transaction: FakeTransaction) => Promise<Result>,
  ) => Promise<Result>;
  readonly transaction: FakeTransaction;
}

interface SavedRun {
  readonly status: string;
  readonly steps: readonly { readonly status: string }[];
}

interface SavedParams {
  readonly view_json: string;
  readonly attempt_json: string;
}

function savedParams(
  execute: FakeTransaction["execute"],
  call: number,
): SavedParams {
  return execute.mock.calls[call]?.[1] as SavedParams;
}

function databaseOf(
  parts: Record<string, unknown>,
): ConstructorParameters<typeof AgentPlanRecoveryRepository>[0] {
  return parts as never;
}

function fixture(options: Fixture = {}): Built {
  const run = {
    id: "r1",
    userId: "u1",
    status: "failed",
    steps: [
      { id: "s1", status: "failed" },
      { id: "s3", status: "waiting" },
      { id: "s4", status: "paused" },
      { id: "s5", status: "succeeded" },
    ],
    ...options.run,
  };
  const runRows = options.rows ?? [
    [JSON.stringify(run), options.revision ?? 3, options.snapshot ?? SNAPSHOT],
  ];
  const execute = vi.fn<ExecuteFunction>(async () => undefined);
  const query = vi.fn(async (sql: string): Promise<unknown[][]> => {
    if (sql.includes("FROM agent_plan_runs")) return runRows;
    if (sql.includes("idempotency_key")) return options.replay ?? [];
    if (sql.includes("attempt_json")) return [[JSON.stringify({ id: "a1" })]];
    return [[1]];
  });
  const transaction = { query, execute };
  const work: Built["work"] = async (body) => body(transaction);
  return { query, execute, work, transaction };
}

function command(fields: Record<string, unknown>): AgentPlanRecoveryCommand {
  const built: unknown = { idempotencyKey: "k", ...fields };
  return built as AgentPlanRecoveryCommand;
}

it("inspects a run on a read snapshot when one exists", async () => {
  const { work } = fixture();
  const readTransaction = vi.fn(work);
  const transaction = vi.fn(work);
  const repository = new AgentPlanRecoveryRepository(
    databaseOf({ readTransaction, transaction }),
  );

  const record = await repository.inspect("r1");

  expect(readTransaction).toHaveBeenCalledTimes(1);
  expect(transaction).not.toHaveBeenCalled();
  expect(record).toMatchObject({
    hasReservation: true,
    revision: 3,
    checkpoint: null,
    attempts: [{ id: "a1" }],
    agentStepIds: ["s1"],
  });
});

it("inspects on the writer without read snapshots", async () => {
  const { work } = fixture({ snapshot: JSON.stringify({}) });
  const transaction = vi.fn(work);
  const repository = new AgentPlanRecoveryRepository(
    databaseOf({ transaction }),
  );

  const record = await repository.inspect("r1");

  expect(transaction).toHaveBeenCalledTimes(1);
  expect(record.agentStepIds).toEqual([]);
});

it("refuses to inspect an unknown run or a broken revision", async () => {
  const unknown = fixture({ rows: [] });
  const negative = fixture({ revision: -1 });
  const fractional = fixture({ revision: "x" });

  for (const { work } of [unknown, negative, fractional])
    await expect(
      new AgentPlanRecoveryRepository(
        databaseOf({ transaction: work }),
      ).inspect("r1"),
    ).rejects.toBeDefined();
  await expect(
    new AgentPlanRecoveryRepository(
      databaseOf({ transaction: negative.work }),
    ).inspect("r1"),
  ).rejects.toMatchObject({ code: "checkpoint_invalid" });
});

function repositoryOf(options: Fixture = {}): Built & {
  readonly repository: AgentPlanRecoveryRepository;
} {
  const set = fixture(options);
  return {
    ...set,
    repository: new AgentPlanRecoveryRepository(
      databaseOf({ transaction: set.work }),
    ),
  };
}

it("refuses restart and release in this journal", async () => {
  const { repository } = repositoryOf();

  for (const action of ["restart", "release"])
    await expect(
      repository.control("u1", "r1", command({ action })),
    ).rejects.toMatchObject({ code: "action_unavailable" });
});

it("refuses another user's run", async () => {
  const { repository } = repositoryOf();

  await expect(
    repository.control("u2", "r1", command({ action: "cancel" })),
  ).rejects.toMatchObject({ code: "access_denied" });
});

it("replays an answered request and refuses a changed one", async () => {
  const result = { commandId: "c", revision: 2, outcome: "recorded" };
  const same = repositoryOf({
    replay: [["digest", JSON.stringify(result)]],
  });
  const changed = repositoryOf({
    replay: [["other", JSON.stringify(result)]],
  });

  expect(
    await same.repository.control(
      "u1",
      "r1",
      command({ action: "cancel" }),
      "digest",
    ),
  ).toEqual(result);
  await expect(
    changed.repository.control(
      "u1",
      "r1",
      command({ action: "cancel" }),
      "digest",
    ),
  ).rejects.toMatchObject({ code: "idempotency_conflict" });
});

it("refuses a run that cannot take a repair or a resume", async () => {
  const { repository } = repositoryOf();
  mocks.canRecord.mockReturnValueOnce(false);

  await expect(
    repository.control("u1", "r1", command({ action: "cancel" })),
  ).rejects.toMatchObject({ code: "action_unavailable" });
  await expect(
    repository.control("u1", "r1", command({ action: "resume" })),
  ).rejects.toMatchObject({ code: "workflow_unavailable" });
});

it("records a repair instruction for a failed agent step", async () => {
  const { repository, execute } = repositoryOf();

  const result = await repository.control(
    "u1",
    "r1",
    command({ action: "record_repair", stepId: "s1", instruction: "fix" }),
  );

  expect(result).toMatchObject({ revision: 4, outcome: "recorded" });
  const insert = savedParams(execute, 0);
  expect(insert).toMatchObject({ step_id: "s1", result_revision: 4 });
  expect(JSON.parse(insert.attempt_json)).toMatchObject({
    text: "fix",
  });
});

it("records a reconcile note", async () => {
  const { repository, execute } = repositoryOf();

  await repository.control(
    "u1",
    "r1",
    command({ action: "reconcile", stepId: "s1", note: "done by hand" }),
  );

  const insert = savedParams(execute, 0);
  expect(JSON.parse(insert.attempt_json)).toMatchObject({
    text: "done by hand",
  });
});

it("refuses a step that is no failed agent step", async () => {
  const { repository } = repositoryOf();

  for (const stepId of ["s2", "s3", "missing"])
    await expect(
      repository.control(
        "u1",
        "r1",
        command({ action: "record_repair", stepId, instruction: "x" }),
      ),
    ).rejects.toMatchObject({ code: "action_unavailable" });
});

it("cancels the run and its unstarted steps", async () => {
  const { repository, execute } = repositoryOf();

  const result = await repository.control(
    "u1",
    "r1",
    command({ action: "cancel" }),
  );

  expect(result.outcome).toBe("cancelled");
  const saved = JSON.parse(savedParams(execute, 1).view_json) as SavedRun;
  expect(saved.status).toBe("cancelled");
  expect(saved.steps.map((step) => step.status)).toEqual([
    "failed",
    "cancelled",
    "cancelled",
    "succeeded",
  ]);
});

it("keeps the run view when a repair is only recorded", async () => {
  const { repository, execute } = repositoryOf();

  await repository.control(
    "u1",
    "r1",
    command({ action: "record_repair", stepId: "s1", instruction: "x" }),
  );

  const saved = JSON.parse(savedParams(execute, 1).view_json) as SavedRun;
  expect(saved.status).toBe("failed");
});
