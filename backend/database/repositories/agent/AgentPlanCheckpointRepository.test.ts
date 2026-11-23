import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";
import type * as RecoveryInput from "@/backend/agents/AgentPlanRecoveryInput";

import { readPlanCheckpoint } from "@/backend/agents/AgentPlanRecoveryInput";

import {
  AgentPlanCheckpointRepository,
  MAXIMUM_PLAN_CHECKPOINT_BYTES,
} from "./AgentPlanCheckpointRepository";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type {
  AgentPlanCheckpoint,
  AgentPlanCheckpointInput,
} from "@/definition/AgentPlanRecovery";

vi.mock("@/backend/agents/AgentPlanRecoveryInput", async (importOriginal) => {
  const actual = await importOriginal<typeof RecoveryInput>();
  return { ...actual, readPlanCheckpoint: vi.fn(actual.readPlanCheckpoint) };
});

const DIGEST = "a".repeat(64);

function input(output: string | null = "done"): AgentPlanCheckpointInput {
  return {
    schemaVersion: 1,
    runId: "r1",
    planId: "p1",
    planRevision: 1,
    stepId: "s1",
    completedAt: "2026-01-01T00:00:00.000Z",
    snapshotDigest: DIGEST,
    workflow: { engine: "pages", runId: null },
    completedStepIds: ["s1"],
    pendingStepIds: [],
    dependencies: [],
    inputs: [],
    configurationDigest: DIGEST,
    workspaceDigest: DIGEST,
    context: {
      groupId: null,
      agentId: null,
      agentRevision: null,
      connectionId: null,
      provider: null,
      model: null,
      workspaceIds: [],
    },
    dispatchedPromptDigest: null,
    result: {
      output,
      isOutputReduced: false,
      outputDigest: DIGEST,
      technical: { resultCode: 0, closeout: null },
      acceptance: null,
    },
    session: null,
  };
}

function stored(
  value: AgentPlanCheckpointInput,
  version: number,
): AgentPlanCheckpoint {
  return { ...value, version, runRevision: 4 };
}

interface TransactionHarness {
  readonly query: Mock<DatabaseTransaction["query"]>;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly handle: DatabaseTransaction;
}

function transaction(...answers: DatabaseValue[][][]): TransactionHarness {
  const query = vi.fn<DatabaseTransaction["query"]>(async () => []);
  for (const rows of answers) query.mockResolvedValueOnce(rows);
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => undefined);
  const handle: DatabaseTransaction = { query, execute };
  return { query, execute, handle };
}

interface RepositoryHarness {
  readonly query: Mock<Database["query"]>;
  readonly repository: AgentPlanCheckpointRepository;
}

function repository(rows: DatabaseValue[][]): RepositoryHarness {
  const query = vi.fn<Database["query"]>(async () => rows);
  return { query, repository: new AgentPlanCheckpointRepository({ query }) };
}

it("appends the first completion as version one", async () => {
  const { execute, handle } = transaction([], []);

  await new AgentPlanCheckpointRepository({ query: vi.fn() }).append(
    handle,
    input(),
    9,
  );

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    version: 1,
    run_revision: 9,
    step_id: "s1",
  });
});

it("numbers a completion after the latest stored version", async () => {
  const { execute, handle } = transaction([], [[3]]);

  await new AgentPlanCheckpointRepository({ query: vi.fn() }).append(
    handle,
    input(),
    9,
  );

  expect(execute.mock.calls[0]?.[1]).toMatchObject({ version: 4 });
});

it("keeps a repeated equivalent completion without writing", async () => {
  const saved = JSON.stringify(stored(input(), 2));
  const { execute, handle } = transaction([[saved]]);

  await new AgentPlanCheckpointRepository({ query: vi.fn() }).append(
    handle,
    input(),
    9,
  );

  expect(execute).not.toHaveBeenCalled();
});

it("refuses a repeated completion with different content", async () => {
  const saved = JSON.stringify(stored(input("before"), 2));
  const { handle } = transaction([[saved]]);

  await expect(
    new AgentPlanCheckpointRepository({ query: vi.fn() }).append(
      handle,
      input("after"),
      9,
    ),
  ).rejects.toMatchObject({ code: "checkpoint_invalid" });
});

it("refuses a completion over the size bound before reading", async () => {
  const { query, handle } = transaction();

  await expect(
    new AgentPlanCheckpointRepository({ query: vi.fn() }).append(
      handle,
      input("x".repeat(MAXIMUM_PLAN_CHECKPOINT_BYTES)),
      9,
    ),
  ).rejects.toMatchObject({ code: "checkpoint_too_large" });
  expect(query).not.toHaveBeenCalled();
});

it("refuses a validated completion that grew over the size bound", async () => {
  const { execute, handle } = transaction([], []);
  const actual = await vi.importActual<typeof RecoveryInput>(
    "@/backend/agents/AgentPlanRecoveryInput",
  );
  const validated = actual.readPlanCheckpoint({
    ...input(),
    version: 1,
    runRevision: 9,
  });
  vi.mocked(readPlanCheckpoint).mockReturnValueOnce({
    ...validated,
    result: {
      ...validated.result,
      output: "x".repeat(MAXIMUM_PLAN_CHECKPOINT_BYTES),
    },
  });

  await expect(
    new AgentPlanCheckpointRepository({ query: vi.fn() }).append(
      handle,
      input(),
      9,
    ),
  ).rejects.toMatchObject({ code: "checkpoint_too_large" });
  expect(execute).not.toHaveBeenCalled();
});

it("finds the latest checkpoint or a given version", async () => {
  const row = [JSON.stringify(stored(input(), 5))];
  const { query, repository: repo } = repository([row]);

  expect((await repo.find("r1"))?.version).toBe(5);
  await repo.find("r1", 5);

  expect(query.mock.calls[0]).toEqual([
    expect.any(String),
    { run_id: "r1", version: null },
  ]);
  expect(query.mock.calls[1]?.[1]).toEqual({ run_id: "r1", version: 5 });
});

it("finds nothing for a run without checkpoints", async () => {
  expect(await repository([]).repository.find("r1")).toBeNull();
});

it("lists every checkpoint of a run", async () => {
  const rows = [
    [JSON.stringify(stored(input(), 1))],
    [JSON.stringify(stored(input(), 2))],
  ];

  const list = await repository(rows).repository.list("r1");

  expect(list.map((entry) => entry.version)).toEqual([1, 2]);
});
