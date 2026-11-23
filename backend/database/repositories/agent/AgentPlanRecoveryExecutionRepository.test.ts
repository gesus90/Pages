import { beforeEach, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { AgentPlanRecoveryReplayed } from "@/backend/error/AgentPlanRecoveryReplayed";

import {
  AgentPlanRecoveryExecutionRepository,
  type RecoveryExecutionWrite,
} from "./AgentPlanRecoveryExecutionRepository";

import type { AgentPlanRun } from "@/definition/AgentPlan";

const mocks = vi.hoisted(() => ({
  retire: vi.fn(),
  releaseLocks: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/backend/storage/AgentPayloadFileStore", () => ({
  readStoredAgentPayload: async (...args: [unknown, string]) => args[1],
}));
vi.mock("@/backend/agents/AgentPlanRunInput", () => ({
  readPlanRun: (input: unknown) => input,
}));
vi.mock("@/backend/agents/AgentPlanRecoveryInput", () => ({
  readPlanRecoveryExecution: (input: unknown) => input,
  readPlanRecoveryResult: (input: unknown) => input,
}));
vi.mock("@/backend/service/agents/AgentPlanRunObservers", () => ({
  sharedAgentPlanRunObservers: () => ({ notify: mocks.notify }),
}));
vi.mock("./AgentPlanResourceReservation", () => ({
  retireRestartSource: mocks.retire,
}));
vi.mock("./AgentPlanWorkspaceLockRelease", () => ({
  releaseCheckedWorkspaceLocks: mocks.releaseLocks,
}));
vi.mock("./AgentPlanContinuationRepository", () => ({
  CURRENT_PLAN_SNAPSHOT: "snapshot_expression",
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function run(fields: Record<string, unknown> = {}): AgentPlanRun {
  return {
    id: "r1",
    planId: "p1",
    userId: "u1",
    planName: "Plan",
    status: "failed",
    steps: [],
    ...fields,
  } as unknown as AgentPlanRun;
}

interface Rows {
  view?: unknown[][];
  revision?: unknown[][];
  replay?: unknown[][];
  linked?: unknown[][];
  plain?: unknown[][];
}

interface Setup {
  readonly transaction: {
    readonly query: Mock;
    readonly execute: Mock;
    readonly onCommit: Mock;
  };
  readonly query: Mock;
  readonly commits: Array<() => Promise<void>>;
  readonly executeCalls: Array<[string, Record<string, unknown>]>;
  readonly repository: AgentPlanRecoveryExecutionRepository;
}

interface SavedRun {
  readonly status: string;
  readonly steps: readonly { readonly cancellation?: string }[];
}

function setup(rows: Rows = {}): Setup {
  const commits: Array<() => Promise<void>> = [];
  const executeCalls: Array<[string, Record<string, unknown>]> = [];
  const respond = (sql: string): unknown[][] => {
    if (sql.includes("idempotency_key")) return rows.replay ?? [];
    if (sql.includes("target_run_id IS NOT NULL")) return rows.linked ?? [];
    if (sql.includes("view_json"))
      return rows.view ?? [[JSON.stringify(run())]];
    if (sql.includes("recovery_revision")) return rows.revision ?? [[1]];
    return rows.plain ?? [];
  };
  const transaction = {
    query: vi.fn(async (sql: string) => respond(sql)),
    execute: vi.fn(async (sql: string, params: Record<string, unknown>) => {
      executeCalls.push([sql, params]);
    }),
    onCommit: vi.fn((hook: () => Promise<void>) => commits.push(hook)),
  };
  const query = vi.fn(async (sql: string) => respond(sql));
  const database = {
    query,
    agentFiles: {},
    transaction: async (work: (t: typeof transaction) => unknown) =>
      work(transaction),
  };
  return {
    transaction,
    query,
    commits,
    executeCalls,
    repository: new AgentPlanRecoveryExecutionRepository(database as never),
  };
}

function write(fields: Record<string, unknown> = {}): RecoveryExecutionWrite {
  return {
    command: { idempotencyKey: "k", action: "restart" },
    requestDigest: "digest",
    execution: {
      id: "e1",
      runId: "r1",
      userId: "u1",
      action: "restart",
      targetRunId: null,
      createdAt: "T",
      revision: 0,
    },
    result: { commandId: "c", revision: 0, outcome: "recorded" },
    ...fields,
  } as unknown as RecoveryExecutionWrite;
}

function targeted(): RecoveryExecutionWrite {
  const base = write();
  return { ...base, execution: { ...base.execution, targetRunId: "r2" } };
}

it("reads the source run with its basis", async () => {
  const { repository } = setup({
    view: [[JSON.stringify(run()), 4, '{"a":1}']],
  });

  expect(await repository.source("r1")).toEqual({
    run: run(),
    revision: 4,
    snapshot: { a: 1 },
  });
});

it("refuses an unknown source and a broken revision", async () => {
  await expect(
    setup({ view: [] }).repository.source("r1"),
  ).rejects.toMatchObject({ code: "access_denied" });
  await expect(
    setup({ view: [["{}", -1, "{}"]] }).repository.source("r1"),
  ).rejects.toMatchObject({ code: "checkpoint_invalid" });
});

it("lists decisions and finds the first continuation", async () => {
  const { repository } = setup({
    plain: [[JSON.stringify({ id: "e1" })]],
    linked: [[JSON.stringify({ revision: 2 })]],
  });

  expect(await repository.list("r1")).toEqual([{ id: "e1" }]);
  expect(await repository.continued("r1")).toEqual({ revision: 2 });
  expect(await setup().repository.continued("r1")).toBeNull();
});

it("replays on the database or inside a transaction", async () => {
  const stored = [["digest", JSON.stringify({ revision: 2 })]];
  const outer = setup({ replay: stored });
  const inner = setup();
  const command = write().command;

  expect(await outer.repository.replay("r1", command, "digest")).toEqual({
    revision: 2,
  });
  expect(outer.query).toHaveBeenCalled();
  expect(
    await outer.repository.replay(
      "r1",
      command,
      "digest",
      inner.transaction as never,
    ),
  ).toBeNull();
  await expect(
    outer.repository.replay("r1", command, "changed"),
  ).rejects.toMatchObject({ code: "idempotency_conflict" });
});

it("journals a decision and advances the revision", async () => {
  const { repository, transaction, executeCalls } = setup({
    revision: [[5]],
  });

  const result = await repository.record(transaction, write());

  expect(result.revision).toBe(6);
  expect(executeCalls[0]?.[1]).toMatchObject({
    expected_revision: 5,
    result_revision: 6,
    target_run_id: null,
  });
  expect(executeCalls[1]?.[1]).toMatchObject({ revision: 6 });
});

it("refuses to record for an unknown run or a broken revision", async () => {
  const unknown = setup({ revision: [] });
  const broken = setup({ revision: [["x"]] });

  await expect(
    unknown.repository.record(unknown.transaction as never, write()),
  ).rejects.toMatchObject({ code: "access_denied" });
  await expect(
    broken.repository.record(broken.transaction as never, write()),
  ).rejects.toMatchObject({ code: "checkpoint_invalid" });
});

it("answers a repeated key with the first result", async () => {
  const { repository, transaction } = setup({
    replay: [["digest", JSON.stringify({ revision: 2 })]],
  });

  await expect(
    repository.record(transaction as never, write()),
  ).rejects.toBeInstanceOf(AgentPlanRecoveryReplayed);
});

it("answers a second continuation with the first one", async () => {
  const linked = setup({ linked: [[JSON.stringify({ revision: 2 })]] });
  const fresh = setup({ revision: [[0]] });

  await expect(
    linked.repository.record(linked.transaction as never, targeted()),
  ).rejects.toBeInstanceOf(AgentPlanRecoveryReplayed);
  await fresh.repository.record(fresh.transaction, targeted());
  expect(fresh.executeCalls[0]?.[1]).toMatchObject({ target_run_id: "r2" });
});

it("releases a run only while its facts are unchanged", async () => {
  const { repository, transaction } = setup({
    view: [[JSON.stringify(run())]],
  });

  await repository.releaseChecked(run());

  expect(mocks.releaseLocks).toHaveBeenCalledWith(
    transaction,
    run(),
    "recovery_confirmed",
  );
});

it("refuses a release of a missing, open or changed run", async () => {
  const missing = setup({ view: [] });
  const open = setup({
    view: [[JSON.stringify(run({ runnerJobs: [{ closeout: "pending" }] }))]],
  });
  const changed = setup({ view: [[JSON.stringify(run({ status: "x" }))]] });

  for (const { repository } of [missing, open, changed])
    await expect(repository.releaseChecked(run())).rejects.toMatchObject({
      code: "action_unavailable",
    });
});

it("accepts confirmed jobs when checking a run", async () => {
  const confirmed = run({ runnerJobs: [{ closeout: "confirmed" }] });
  const { repository } = setup({ view: [[JSON.stringify(confirmed)]] });

  await repository.releaseChecked(confirmed);

  expect(mocks.releaseLocks).toHaveBeenCalledTimes(1);
});

it("recognizes restart proof only with a completed cleanup", async () => {
  const proven = setup({ plain: [["r1"]] });
  const unproven = setup({ plain: [] });

  expect(await proven.repository.hasRestartProof(run())).toBe(true);
  expect(await unproven.repository.hasRestartProof(run())).toBe(false);
});

it("retires a restarted predecessor as cancelled", async () => {
  const steps = [
    { id: "a", status: "running", blockedByStepId: "x" },
    { id: "b", status: "waiting" },
    { id: "c", status: "succeeded" },
  ];
  const source = run({ steps });
  const { repository, executeCalls } = setup({
    view: [[JSON.stringify(source)]],
  });

  await repository.retireForRestart(source);

  const update = executeCalls.find(([sql]) =>
    sql.includes("UPDATE agent_plan_runs"),
  );
  const saved = JSON.parse(String(update?.[1].view_json)) as SavedRun;
  expect(saved.status).toBe("cancelled");
  expect(saved.steps.map((step) => step.cancellation)).toEqual([
    "confirmed",
    "not_started",
    undefined,
  ]);
  expect(executeCalls).toHaveLength(6);
});

it("keeps a succeeded predecessor as it is", async () => {
  const source = run({ status: "succeeded" });
  const { repository, executeCalls } = setup({
    view: [[JSON.stringify(source)]],
  });

  await repository.retireForRestart(source);

  const update = executeCalls.find(([sql]) =>
    sql.includes("UPDATE agent_plan_runs"),
  );
  expect(update?.[1].status).toBe("succeeded");
});

it("records a reset and returns the retired run", async () => {
  const { repository } = setup({
    view: [[JSON.stringify(run({ status: "cancelled" }))]],
  });

  const result = await repository.recordReset(write(), run());

  expect(result.status).toBe("cancelled");
  expect(mocks.retire.mock.calls[0]?.[1]).toMatchObject({
    startedAt: "T",
    origin: { kind: "restart", runId: "r1" },
  });
});

it("fails a reset whose run has vanished", async () => {
  const { repository } = setup({ view: [] });

  await expect(repository.recordReset(write(), run())).rejects.toThrow();
});

it("returns an ended run unchanged when settling a stop", async () => {
  const { repository, transaction } = setup();
  const ended = run({ status: "succeeded" });

  expect(await repository.settleStopped(ended)).toBe(ended);
  expect(
    await repository.settleStopped(run({ status: "cancelled" })),
  ).toMatchObject({ status: "cancelled" });
  expect(transaction.execute).not.toHaveBeenCalled();
});

it("cancels a stopped run, journals it and notifies observers", async () => {
  const source = run({
    status: "running",
    steps: [
      { id: "a", status: "running" },
      { id: "b", status: "paused" },
      { id: "c", status: "failed" },
    ],
    endedAt: "E",
  });
  const { repository, commits, executeCalls } = setup({
    view: [[JSON.stringify(source)]],
    revision: [[7]],
  });
  const journal = vi.fn(async () => undefined);

  const cancelled = await repository.settleStopped(source, journal);
  await commits[0]?.();

  expect(cancelled.endedAt).toBe("E");
  expect(cancelled.steps.map((step) => step.status)).toEqual([
    "cancelled",
    "cancelled",
    "failed",
  ]);
  expect(executeCalls[0]?.[1]).toMatchObject({
    revision: 8,
    previous_revision: 7,
  });
  expect(journal).toHaveBeenCalledTimes(1);
  expect(mocks.notify).toHaveBeenCalledTimes(1);
});

it("settles a stop without journal, commit hook or end time", async () => {
  const source = run({ status: "running" });
  const { repository, transaction } = setup({
    view: [[JSON.stringify(source)]],
    revision: [],
  });
  Reflect.deleteProperty(transaction, "onCommit");

  const cancelled = await repository.settleStopped(source);

  expect(typeof cancelled.endedAt).toBe("string");
});

it("journals a decision alone without a released run", async () => {
  const { repository, transaction } = setup();

  await repository.recordAlone(write());

  expect(mocks.releaseLocks).not.toHaveBeenCalled();
  expect(transaction.execute).toHaveBeenCalledTimes(2);
});

it("releases a stopped active run as cancelled", async () => {
  const released = run({
    status: "running",
    stopRequested: true,
    steps: [
      { id: "a", status: "running" },
      { id: "b", status: "succeeded" },
    ],
  });
  const { repository, commits, executeCalls } = setup({
    view: [[JSON.stringify(released)]],
  });

  await repository.recordAlone(write(), released);
  await commits[0]?.();

  const update = executeCalls[2]?.[1];
  expect(JSON.parse(update?.view_json as string).steps[0]).toMatchObject({
    status: "cancelled",
    cancellation: "confirmed",
  });
  expect(mocks.releaseLocks).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ status: "cancelled" }),
    "user_requested",
  );
  expect(mocks.notify).toHaveBeenCalledTimes(1);
});

it("releases a stopped run without a commit hook", async () => {
  const released = run({ status: "paused", stopRequested: true });
  const { repository, transaction } = setup({
    view: [[JSON.stringify(released)]],
  });
  Reflect.deleteProperty(transaction, "onCommit");

  await repository.recordAlone(write(), released);

  expect(mocks.notify).not.toHaveBeenCalled();
});

it("releases an unchanged run that was not stopped while active", async () => {
  const idle = run({ status: "running" });
  const ended = run({ status: "failed", stopRequested: true });
  const first = setup({ view: [[JSON.stringify(idle)]] });
  const second = setup({ view: [[JSON.stringify(ended)]] });

  await first.repository.recordAlone(write(), idle);
  await second.repository.recordAlone(write(), ended);

  expect(first.commits).toHaveLength(0);
  expect(second.transaction.execute).toHaveBeenCalledTimes(2);
  expect(mocks.releaseLocks).toHaveBeenCalledTimes(2);
});
