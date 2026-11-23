import { beforeEach, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { readPlanStepResult } from "@/backend/agents/AgentPlanStepResultInput";
import { planResourceReleaseSchema } from "@/definition/AgentPlanResourceRelease";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { loopIterationCheckpoints } from "@/backend/service/agents/recovery/AgentPlanLoopCheckpoint";
import { storedPlanBranchState } from "@/backend/service/agents/branching/AgentPlanBranchPersistence";
import { sharedAgentPlanRunObservers } from "@/backend/service/agents/AgentPlanRunObservers";
import { AgentPlanProgressRepository } from "./AgentPlanProgressRepository";
import { clearProcessedTicketEntries } from "./AgentPlanProcessedTickets";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanCheckpointInput } from "@/definition/AgentPlanRecovery";

const appendCheckpoint = vi.hoisted(() => vi.fn());
const appendIteration = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => vi.fn());

vi.mock("@/backend/storage/AgentPayloadFileStore", () => ({
  requireAgentFiles: () => ({ write: async () => "file-reference" }),
  readStoredAgentPayload: async (...parameters: readonly unknown[]) =>
    parameters[1],
}));
vi.mock(
  "@/backend/service/agents/branching/AgentPlanBranchPersistence",
  () => ({ storedPlanBranchState: vi.fn(() => null) }),
);
vi.mock("@/backend/service/agents/recovery/AgentPlanLoopCheckpoint", () => ({
  loopIterationCheckpoints: vi.fn(() => []),
  requireImmutableIterations: vi.fn(),
}));
vi.mock("@/backend/service/agents/AgentPlanRunObservers", () => ({
  sharedAgentPlanRunObservers: () => ({ notify }),
}));
vi.mock("./AgentPlanProcessedTickets", () => ({
  clearProcessedTicketEntries: vi.fn(async () => undefined),
}));
vi.mock("./AgentPlanCheckpointRepository", () => ({
  AgentPlanCheckpointRepository: class {
    public readonly append = appendCheckpoint;
  },
}));
vi.mock("./AgentPlanLoopIterationRepository", () => ({
  AgentPlanLoopIterationRepository: class {
    public readonly append = appendIteration;
  },
}));

const UUID = "11111111-1111-4111-8111-111111111111";
const DIGEST = "a".repeat(64);

function step(
  id: string,
  overrides: Readonly<Record<string, unknown>> = {},
): AgentPlanStepResult {
  return readPlanStepResult({
    id,
    name: id,
    status: "waiting",
    cancellation: "none",
    isBlocked: false,
    output: null,
    error: null,
    ...overrides,
  });
}

function run(overrides: Readonly<Record<string, unknown>> = {}): AgentPlanRun {
  return readPlanRun({
    id: "r1",
    planId: "p1",
    planName: "Plan",
    planRevision: 1,
    userId: "u1",
    startedAt: "t0",
    status: "running",
    stopRequested: false,
    steps: [step("s1")],
    ...overrides,
  });
}

function snapshot(plan: Record<string, unknown> = {}, extra = {}): unknown {
  return { plan: { id: "p1", nodes: [], edges: [], ...plan }, ...extra };
}

interface Stored {
  readonly run?: AgentPlanRun;
  readonly revision?: DatabaseValue;
  readonly snapshot?: unknown;
  readonly isMissing?: boolean;
}

interface Harness {
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly effects: (() => Promise<void>)[];
  readonly transaction: DatabaseTransaction;
  readonly repository: AgentPlanProgressRepository;
}

function setup(stored: Stored = {}): Harness {
  const previous = stored.run ?? run();
  const rows: DatabaseValue[][] = stored.isMissing
    ? []
    : [
        [
          JSON.stringify(previous),
          stored.revision ?? 4,
          JSON.stringify(stored.snapshot ?? snapshot()),
        ],
      ];
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => undefined);
  const query = vi.fn<DatabaseTransaction["query"]>(async () => rows);
  const effects: (() => Promise<void>)[] = [];
  const transaction: DatabaseTransaction = {
    query,
    execute,
    onCommit: (effect) => effects.push(effect),
  };
  const database: Pick<Database, "transaction" | "query" | "agentFiles"> = {
    transaction: async (work) => work(transaction),
    query,
  };
  return {
    execute,
    effects,
    transaction,
    repository: new AgentPlanProgressRepository(database),
  };
}

function updates(
  execute: Harness["execute"],
): Harness["execute"]["mock"]["calls"] {
  return execute.mock.calls.filter(([statement]) =>
    statement.includes("recovery_revision = $revision"),
  );
}

function checkpoint(
  overrides: Readonly<Record<string, unknown>> = {},
  output: string | null = "done",
  base: unknown = snapshot(),
): AgentPlanCheckpointInput {
  return {
    schemaVersion: 1,
    runId: "r1",
    planId: "p1",
    planRevision: 1,
    stepId: "s1",
    completedAt: "t1",
    snapshotDigest: planContentDigest(base),
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
      outputDigest: planContentDigest(output),
      technical: { resultCode: 0, closeout: null },
      acceptance: null,
    },
    session: null,
    ...overrides,
  };
}

const NODE_SNAPSHOT = snapshot({ nodes: [{ id: "s1", type: "agent" }] });

beforeEach(() => {
  vi.clearAllMocks();
});

it("persists a changed view, journals it and notifies after commit", async () => {
  const { repository, execute, effects } = setup();
  const journal = vi.fn(async () => undefined);
  const next = run({ status: "pausing" });

  await repository.update(next, undefined, journal);

  expect(updates(execute)[0]?.[1]).toMatchObject({
    status: "pausing",
    revision: 5,
    previous_revision: 4,
  });
  expect(journal).toHaveBeenCalledOnce();
  await effects[0]?.();
  expect(notify).toHaveBeenCalledOnce();
});

it("writes an unchanged view nothing", async () => {
  const { repository, execute } = setup();

  await repository.update(run());

  expect(execute).not.toHaveBeenCalled();
});

it("stores the engine file of a branching run first", async () => {
  vi.mocked(storedPlanBranchState).mockReturnValueOnce({ any: 1 });
  const { repository, execute } = setup();

  await repository.update(run({ status: "pausing" }));

  expect(execute.mock.calls[0]?.[1]).toEqual({
    id: "r1",
    engine_file: "file-reference",
  });
});

it("leaves a run with recorded resource releases untouched", async () => {
  const release = planResourceReleaseSchema.parse({
    id: UUID,
    userId: "u1",
    targetRunId: "r2",
    createdAt: "t",
    resources: [],
    processes: [],
    confirmed: true,
  });
  const { repository, execute, transaction } = setup({
    run: run({ resourceReleases: [release] }),
  });

  await repository.update(run({ status: "pausing" }));
  await repository.persist(transaction, run({ status: "pausing" }));

  expect(execute).not.toHaveBeenCalled();
});

it("keeps a stop request and a terminal status the run already has", async () => {
  const { repository, execute } = setup({
    run: run({ status: "failed", stopRequested: true }),
  });

  await repository.update(run({ status: "running" }));

  expect(updates(execute)).toHaveLength(0);
});

it("keeps a stop request while the status may change", async () => {
  const { repository, execute } = setup({
    run: run({ stopRequested: true, status: "stopping" }),
  });

  await repository.update(run({ status: "stopping" }));
  await repository.update(run({ status: "failed" }));

  expect(updates(execute)[0]?.[1]).toMatchObject({ status: "failed" });
});

it("refuses a view of another owner, plan or revision", async () => {
  const { repository, transaction } = setup();

  for (const other of [{ userId: "u2" }, { planId: "p2" }, { planRevision: 2 }])
    await expect(
      repository.persist(transaction, run(other)),
    ).rejects.toMatchObject({ code: "checkpoint_invalid" });
});

it("refuses to withdraw a stop request or reopen a decided run", async () => {
  const stopped = setup({ run: run({ stopRequested: true }) });

  await expect(
    stopped.repository.persist(stopped.transaction, run()),
  ).rejects.toMatchObject({ code: "action_unavailable" });

  for (const status of [
    "succeeded",
    "cancelled",
    "failed",
    "work_done_closeout_open",
  ]) {
    const decided = setup({ run: run({ status }) });
    await expect(
      decided.repository.persist(decided.transaction, run()),
    ).rejects.toMatchObject({ code: "action_unavailable" });
  }
});

it("refuses a read of a missing run or of a damaged revision", async () => {
  const missing = setup({ isMissing: true });
  await expect(
    missing.repository.persist(missing.transaction, run()),
  ).rejects.toMatchObject({ code: "access_denied" });

  for (const revision of [-1, "x"]) {
    const damaged = setup({ revision });
    await expect(
      damaged.repository.persist(damaged.transaction, run()),
    ).rejects.toMatchObject({ code: "checkpoint_invalid" });
  }
});

it("interrupts only a run that is still active", async () => {
  const active = setup();
  await active.repository.interrupt(run({ status: "failed" }));
  expect(updates(active.execute)).toHaveLength(1);

  const decided = setup({ run: run({ status: "failed" }) });
  await decided.repository.interrupt(run({ status: "failed" }));
  expect(decided.execute).not.toHaveBeenCalled();
});

it("appends loop iterations with the new revision", async () => {
  vi.mocked(loopIterationCheckpoints).mockReturnValueOnce([
    {
      schemaVersion: 1,
      runId: "r1",
      loopId: "l1",
      iteration: 1,
      completedAt: "t",
      count: { source: "value", parameterId: null, effective: 1, mode: "max" },
      condition: { state: "not_evaluated", reason: "disabled" },
      nodes: [],
    },
  ]);
  const { repository, transaction } = setup();

  await repository.persist(transaction, run({ status: "pausing" }));

  expect(appendIteration).toHaveBeenCalledWith(
    transaction,
    expect.objectContaining({ loopId: "l1" }),
    5,
  );
});

it("accepts a completion with its matching checkpoint", async () => {
  const done = step("s1", { status: "succeeded", output: "done" });
  const { repository, transaction, execute } = setup({
    snapshot: NODE_SNAPSHOT,
  });

  await repository.persist(
    transaction,
    run({ steps: [done] }),
    checkpoint({}, "done", NODE_SNAPSHOT),
  );

  expect(appendCheckpoint).toHaveBeenCalledWith(
    transaction,
    expect.objectContaining({ stepId: "s1" }),
    5,
  );
  expect(updates(execute)).toHaveLength(1);
});

it("refuses a checkpoint that does not describe the settled step", async () => {
  const done = step("s1", { status: "succeeded", output: "done" });
  const bad = [
    checkpoint({ runId: "r2" }, "done", NODE_SNAPSHOT),
    checkpoint({ planId: "p2" }, "done", NODE_SNAPSHOT),
    checkpoint({ planRevision: 2 }, "done", NODE_SNAPSHOT),
    checkpoint({ snapshotDigest: DIGEST }, "done", NODE_SNAPSHOT),
    checkpoint({ stepId: "s9" }, "done", NODE_SNAPSHOT),
    checkpoint({}, "other", NODE_SNAPSHOT),
  ];

  for (const input of bad) {
    const { repository, transaction } = setup({ snapshot: NODE_SNAPSHOT });
    await expect(
      repository.persist(transaction, run({ steps: [done] }), input),
    ).rejects.toMatchObject({ code: "checkpoint_invalid" });
  }
});

it("accepts a reduced output when the checkpoint says so", async () => {
  const done = step("s1", { status: "succeeded", output: "long" });
  const reduced = checkpoint({}, "short", NODE_SNAPSHOT);
  const input = {
    ...reduced,
    result: {
      ...reduced.result,
      isOutputReduced: true,
      outputDigest: planContentDigest("long"),
    },
  };
  const { repository, transaction } = setup({ snapshot: NODE_SNAPSHOT });

  await repository.persist(transaction, run({ steps: [done] }), input);

  expect(appendCheckpoint).toHaveBeenCalledOnce();
});

it("requires a checkpoint for a newly completed node", async () => {
  const done = step("s1", { status: "succeeded", output: "done" });
  const group = snapshot({
    nodes: [
      { id: "s1", type: "agent" },
      { id: "s2", type: "agent" },
    ],
  });
  const two = run({ steps: [done, step("s2", { status: "succeeded" })] });
  const { repository, transaction } = setup({
    run: run({ steps: [step("s1"), step("s2")] }),
    snapshot: group,
  });

  await expect(repository.persist(transaction, two)).rejects.toMatchObject({
    code: "checkpoint_invalid",
  });
  await expect(
    repository.persist(transaction, run({ steps: [done] })),
  ).rejects.toMatchObject({ code: "checkpoint_invalid" });
});

it("needs no checkpoint for a group, a decision plan or a plan without node list", async () => {
  const done = run({ steps: [step("s1", { status: "succeeded" })] });
  const snapshots = [
    snapshot({ nodes: [{ id: "s1", type: "group" }] }),
    snapshot({ nodes: [{ id: "s1", type: "decision" }] }),
    snapshot({ edges: [{ toPort: "condition-in" }] }),
    snapshot({ edges: [{ toPort: "event-in" }] }),
    { plan: { id: "p1" } },
  ];

  for (const base of snapshots) {
    const { repository, transaction, execute } = setup({ snapshot: base });
    await repository.persist(transaction, done);
    expect(updates(execute)).toHaveLength(1);
  }
});

it("refuses to change a successful node, except in a plan with events", async () => {
  const succeeded = run({ steps: [step("s1", { status: "succeeded" })] });
  const changed = run({
    steps: [step("s1", { status: "succeeded", output: "x" })],
  });
  const reopened = run({ steps: [step("s1")] });
  const plain = setup({ run: succeeded });

  await expect(
    plain.repository.persist(plain.transaction, changed),
  ).rejects.toMatchObject({ code: "checkpoint_invalid" });
  await expect(
    plain.repository.persist(plain.transaction, reopened),
  ).rejects.toMatchObject({ code: "checkpoint_invalid" });

  const events = setup({
    run: succeeded,
    snapshot: snapshot({ edges: [{ toPort: "event-in" }] }),
  });
  await events.repository.persist(events.transaction, reopened);
  expect(updates(events.execute)).toHaveLength(1);
});

it("clears processed tickets once when a run succeeds", async () => {
  const first = setup();
  await first.repository.persist(
    first.transaction,
    run({ status: "succeeded" }),
  );
  const again = setup({ run: run({ status: "succeeded" }) });
  await again.repository.persist(
    again.transaction,
    run({ status: "succeeded", planName: "Renamed" }),
  );

  expect(clearProcessedTicketEntries).toHaveBeenCalledTimes(1);
  expect(sharedAgentPlanRunObservers).toBeDefined();
});

it("notifies nobody when the executor has no commit hook", async () => {
  const query = vi.fn<DatabaseTransaction["query"]>(async () => [
    [JSON.stringify(run()), 0, JSON.stringify(snapshot())],
  ]);
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => undefined);
  const bare: DatabaseTransaction = { query, execute };
  const repository = new AgentPlanProgressRepository({
    transaction: async (work) => work(bare),
    query,
  });

  await repository.persist(bare, run({ status: "pausing" }));

  expect(execute).toHaveBeenCalledOnce();
});
