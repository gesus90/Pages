import { beforeEach, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { readPlanSessionRecord } from "@/backend/agents/AgentPlanSessionInput";
import { readPlanStepResult } from "@/backend/agents/AgentPlanStepResultInput";
import { planRemoteAccessSchema } from "@/definition/AgentPlanRemoteAccess";
import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import {
  planRemoteProgressSchema,
  planStepExecutionSchema,
} from "@/definition/AgentPlanExecution";
import { AgentPlanProgressRepository } from "./AgentPlanProgressRepository";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type {
  AgentPlanRemoteProgress,
  AgentPlanRemoteTarget,
  AgentPlanStepExecution,
} from "@/definition/AgentPlanExecution";
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

const SCRIPT = {
  attemptId: UUID,
  instanceId: UUID,
  interpreterProfileId: "sh",
  directory: "/w",
  userId: "u1",
  uid: 1,
  gid: 1,
  processId: null,
  startedAt: "t",
  endedAt: null,
  exitCode: 0,
  signal: null,
  failure: null,
  closeout: "confirmed",
  stdout: null,
  stderr: "",
};

function execution(): AgentPlanStepExecution {
  return planStepExecutionSchema.parse({
    schemaVersion: 1,
    planId: "p1",
    runId: "r1",
    stepId: "s1",
    attemptId: UUID,
    planRevision: 1,
    target: { kind: "local" },
    workspace: { id: "w", path: "/w", revision: 1 },
    modelAccess: {
      connectionId: null,
      connectionName: "",
      provider: "p",
      model: "m",
      reasoningEffort: null,
    },
  });
}

function remote(status: "completed" | "running"): AgentPlanRemoteProgress {
  return planRemoteProgressSchema.parse({
    jobId: UUID,
    sessionId: UUID,
    status,
    startedAt: null,
    endedAt: null,
    closeout: "confirmed",
  });
}

function session(
  overrides: Readonly<Record<string, unknown>> = {},
): AgentPlanStepResult["session"] {
  return readPlanSessionRecord({
    runner: "api",
    mode: "one_shot",
    instanceId: "i1",
    sessionId: null,
    processId: null,
    startedAt: null,
    turnEndedAt: null,
    endedAt: null,
    exit: null,
    closeout: "not_needed",
    leftoverProcesses: null,
    resultCode: -1,
    requested: {
      runner: "api",
      connectionId: "c",
      connectionName: "c",
      model: "m",
      reasoningEffort: null,
      options: null,
      unattended: "x",
      mcp: false,
      directory: null,
    },
    effective: null,
    definition: { path: "d", revision: 1 },
    contract: null,
    acceptance: null,
    events: [],
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

beforeEach(() => {
  vi.clearAllMocks();
});

it("retains the resource access and the remote projection of a stored step", async () => {
  const access = planRemoteAccessSchema.parse({
    files: [],
    pages: "closed",
    events: [],
  });
  const stored = step("s1", {
    remote: remote("running"),
    output: "kept",
    resourceAccess: access,
  });
  const { repository, execute } = setup({ run: run({ steps: [stored] }) });

  await repository.update(
    run({
      status: "pausing",
      steps: [step("s1", { status: "failed", error: "x" }), step("s2")],
    }),
  );

  const saved = String(updates(execute)[0]?.[1]?.view_json);
  expect(saved).toContain('"output":"kept"');
  expect(saved).toContain('"pages":"closed"');
  expect(saved).toContain('"id":"s2"');
});

it("compares the work of a successful node by its whole content", async () => {
  const rich = (extra: Record<string, unknown> = {}): AgentPlanRun =>
    run({
      steps: [
        step("s1", {
          status: "succeeded",
          execution: execution(),
          remote: remote("completed"),
          script: SCRIPT,
          session: session({
            acceptance: null,
            dispatchedPromptDigest: DIGEST,
            attemptId: "a",
          }),
          report: {
            status: "passed",
            summary: "ok",
            checkCount: 1,
            failedCount: 0,
            partialCount: 0,
          },
          ...extra,
        }),
      ],
    });
  const { repository, transaction } = setup({ run: rich() });

  await repository.persist(transaction, { ...rich(), planName: "Renamed" });
  await expect(
    repository.persist(transaction, rich({ output: "different" })),
  ).rejects.toMatchObject({ code: "checkpoint_invalid" });
});

it("compares a successful session without attempt or prompt digest", async () => {
  const plain = run({
    steps: [step("s1", { status: "succeeded", session: session() })],
  });
  const { repository, transaction } = setup({ run: plain });

  await repository.persist(transaction, { ...plain, planName: "Renamed" });

  expect(appendCheckpoint).not.toHaveBeenCalled();
});

it("resets a remote step for a retry", async () => {
  const remoteStep = step("s1", {
    status: "failed",
    execution: { ...execution(), target: remoteTarget() },
    remote: remote("completed"),
  });
  const { repository, execute } = setup({
    run: run({ steps: [remoteStep, step("s2")] }),
  });
  const record = session();
  if (!record) throw new Error("missing session fixture");

  const next = await repository.resetRemoteRetry("r1", "s1", record);

  expect(next.steps[0]).toMatchObject({ status: "running", output: null });
  expect(updates(execute)).toHaveLength(1);
});

it("refuses to reset a step that is missing, local or successful", async () => {
  const record = session();
  if (!record) throw new Error("missing session fixture");
  const local = step("s1", { status: "failed", execution: execution() });
  const done = step("s1", {
    status: "succeeded",
    execution: { ...execution(), target: remoteTarget() },
  });

  for (const steps of [[step("s2")], [local], [done]]) {
    const { repository } = setup({ run: run({ steps }) });
    await expect(
      repository.resetRemoteRetry("r1", "s1", record),
    ).rejects.toMatchObject({ code: "plan_context_changed" });
  }
});

function remoteTarget(): AgentPlanRemoteTarget {
  return {
    kind: "remote" as const,
    connectionId: "c",
    connectionRevision: 1,
    connectionName: "c",
    workspaceId: "w",
    workspaceRevision: 1,
    workspaceName: "w",
    path: "/w",
  };
}

const TICKET_GATE = snapshot({
  nodes: [{ id: "s1", type: "agent", completionGate: { version: 1 } }],
});
const ACCEPTANCE_GATE = snapshot(
  { nodes: [{ id: "s1", type: "agent" }] },
  {
    remoteSteps: [
      {
        step: { id: "s1" },
        command: { program: { kind: "cli" } },
        acceptanceContract: {},
      },
      { step: { id: "other" }, command: { program: { kind: "cli" } } },
    ],
  },
);

interface GateCase {
  readonly base: unknown;
  readonly stored?: Readonly<Record<string, unknown>>;
  readonly next?: Readonly<Record<string, unknown>>;
  readonly checkpoint?: AgentPlanCheckpointInput;
}

async function settle(input: GateCase): Promise<string> {
  const previous = step("s1", {
    status: "running",
    execution: execution(),
    remote: remote("completed"),
    ...input.stored,
  });
  const next = step("s1", {
    status: "failed",
    error: "plan_work_gate_failed",
    execution: execution(),
    session: session({ resultCode: -1 }),
    ...input.next,
  });
  const { repository, execute } = setup({
    run: run({ steps: [previous] }),
    snapshot: input.base,
  });
  await repository.update(
    run({ planName: "Renamed", steps: [next] }),
    input.checkpoint,
  );
  const view: unknown = JSON.parse(String(updates(execute)[0]?.[1]?.view_json));
  return readPlanRun(view).steps[0]?.status ?? "none";
}

it("lets a failed ticket gate settle a completed remote step", async () => {
  expect(await settle({ base: TICKET_GATE })).toBe("failed");
});

it("lets a failed acceptance gate settle a completed remote step", async () => {
  const next = { error: "plan_acceptance_failed" };

  expect(await settle({ base: ACCEPTANCE_GATE, next })).toBe("failed");
});

it("lets an accepted completion settle the remote step", async () => {
  const accepted = session({
    resultCode: 0,
    acceptance: {
      verdict: "accepted",
      todos: [],
      criteria: [],
      decisions: [],
      issues: [],
      summary: "",
    },
  });
  const next = {
    status: "succeeded",
    error: null,
    output: "done",
    session: accepted,
  };

  expect(
    await settle({
      base: TICKET_GATE,
      next,
      checkpoint: checkpoint({}, null, TICKET_GATE),
    }),
  ).toBe("succeeded");
});

it("keeps the stored remote result when the gate does not settle", async () => {
  const cases: GateCase[] = [
    { base: TICKET_GATE, stored: { status: "failed" } },
    { base: TICKET_GATE, stored: { remote: remote("running") } },
    { base: snapshot() },
    { base: { plan: { id: "p1" } } },
    { base: TICKET_GATE, next: { error: "other" } },
    { base: ACCEPTANCE_GATE, next: { error: null } },
    { base: ACCEPTANCE_GATE, next: { error: "unknown_failure" } },
    { base: TICKET_GATE, next: { session: null } },
    { base: TICKET_GATE, next: { status: "running", error: null } },
    {
      base: TICKET_GATE,
      next: { status: "succeeded", error: null, session: null },
    },
    { base: TICKET_GATE, stored: { execution: undefined } },
    { base: TICKET_GATE, next: { execution: undefined } },
    {
      base: TICKET_GATE,
      next: { execution: { ...execution(), planRevision: 2 } },
    },
  ];

  for (const input of cases)
    await expect(settle(input)).resolves.toBe(
      input.stored?.status === "failed" ? "failed" : "running",
    );
});
