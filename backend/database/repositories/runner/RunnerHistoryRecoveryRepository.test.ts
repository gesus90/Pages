import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  write: vi.fn(async () => "file-1"),
  prepareEvents: vi.fn(async () => ({ bodies: [] })),
  appendEvents: vi.fn<Call>(async () => undefined),
  report: vi.fn(),
}));
vi.mock("@/backend/storage/AgentPayloadFileStore", () => ({
  requireAgentFiles: () => ({ write: mocks.write }),
  readStoredAgentPayload: async (...parts: unknown[]) => String(parts[1]),
}));
vi.mock("@/backend/agents/AgentPlanRunInput", () => ({
  readPlanRun: (input: unknown) => input,
}));
vi.mock("@/definition/AgentPlanLoopResults", () => ({
  allPlanRunResults: (run: { results?: unknown[] }) => run.results ?? [],
}));
vi.mock("@/definition/RunnerProtocol", () => ({
  runnerJobSchema: { parse: (input: unknown) => input },
  runnerMessageSchema: { parse: (input: unknown) => input },
}));
vi.mock("@/backend/service/runner/RunnerSchemaDiagnosis", () => ({
  runnerSchemaIssues: () => ["issue"],
  reportRunnerSchemaIssues: mocks.report,
}));
vi.mock("./RunnerSessionEvents", () => ({
  prepareRunnerSessionEvents: mocks.prepareEvents,
  appendRunnerSessionEvents: mocks.appendEvents,
  runnerSessionState: () => "ended",
}));

import { RunnerHistoryRecoveryRepository } from "./RunnerHistoryRecoveryRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { RunnerMessage } from "@/definition/RunnerProtocol";

type Call = (...parameters: unknown[]) => Promise<undefined>;

type PlanEvent = Extract<RunnerMessage, { type: "event" }>;

interface Scenario {
  readonly rows?: unknown[][];
  readonly state?: unknown;
  readonly archived?: unknown;
  readonly run?: unknown;
}

const PLAN = {
  planId: "p1",
  runId: "r1",
  stepId: "s1",
  attemptId: "a1",
  planRevision: 1,
  managed: false,
};
const CLI_PROGRAM = {
  kind: "cli",
  route: { tool: "codex" },
  model: "gpt",
};

function jobOf(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jobId: "j1",
    status: "completed",
    plan: PLAN,
    execution: { program: CLI_PROGRAM },
    ...extra,
  };
}

function packetOf(
  plan: unknown = PLAN,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type: "event",
    eventId: "e1",
    job: { jobId: "j1", plan, ...extra },
    history: [{ sequence: 1 }],
  });
}

function runOf(
  extra: Record<string, unknown> = {},
  results: unknown[] = [
    { id: "s1", execution: { attemptId: "a1" }, remote: undefined },
  ],
): unknown {
  return { planId: "p1", id: "r1", userId: "u1", results, ...extra };
}

function setup(scenario: Scenario): {
  repository: RunnerHistoryRecoveryRepository;
  execute: ReturnType<typeof vi.fn>;
  transactionExecute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn<Call>(async () => undefined);
  const transactionExecute = vi.fn<Call>(async () => undefined);
  const transaction = {
    execute: transactionExecute,
    query: vi.fn(async (sql: string) => {
      if (sql.includes("pages_runners"))
        return scenario.state === undefined
          ? []
          : [[JSON.stringify(scenario.state)]];
      if (sql.includes("runner_job_archive"))
        return scenario.archived === undefined
          ? []
          : [[JSON.stringify(scenario.archived)]];
      return scenario.run === undefined ? [] : [[JSON.stringify(scenario.run)]];
    }),
  } as unknown as DatabaseTransaction;
  const database = {
    query: vi.fn(async () => scenario.rows ?? []),
    execute,
    transaction: async (work: (access: DatabaseTransaction) => Promise<void>) =>
      work(transaction),
  } as unknown as Database;
  return {
    repository: new RunnerHistoryRecoveryRepository(database),
    execute,
    transactionExecute,
  };
}

function restoring(
  packet: string,
  scenario: Omit<Scenario, "rows"> = {},
): ReturnType<typeof setup> {
  return setup({ ...scenario, rows: [["e1", "j1", packet]] });
}

function attemptParams(
  harness: ReturnType<typeof setup>,
): Record<string, unknown> {
  return harness.transactionExecute.mock.calls[0]?.[1] as Record<
    string,
    unknown
  >;
}

beforeEach(() => vi.clearAllMocks());

describe("custody", () => {
  it("lists connections with pending recovery", async () => {
    const { repository } = setup({ rows: [["c1"], ["c2"]] });

    expect(await repository.pendingConnections()).toEqual(["c1", "c2"]);
  });

  it("prepares and retains a packet with history", async () => {
    const { repository, transactionExecute } = setup({});
    const event = {
      eventId: "e1",
      sequence: 4,
      job: { jobId: "j1", plan: PLAN },
      history: [{ sequence: 1 }],
    } as unknown as PlanEvent;

    await repository.prepare(event);
    await repository.retain(
      { execute: transactionExecute } as unknown as DatabaseTransaction,
      "c1",
      event,
    );

    expect(transactionExecute.mock.calls[0]?.[1]).toMatchObject({
      packet_file: "file-1",
      payload_plan_id: "p1",
      payload_run_id: "r1",
      sequence: 4,
    });
  });

  it("ignores packets without history", async () => {
    const { repository, transactionExecute } = setup({});
    const event = { job: { jobId: "j1" } } as unknown as PlanEvent;

    await repository.prepare(event);
    await repository.retain(
      { execute: transactionExecute } as unknown as DatabaseTransaction,
      "c1",
      event,
    );

    expect(mocks.write).not.toHaveBeenCalled();
    expect(transactionExecute).not.toHaveBeenCalled();
  });

  it("refuses custody without a binding or without synchronization", async () => {
    const { repository, transactionExecute } = setup({});
    const unbound = {
      job: { jobId: "j1" },
      history: [{}],
    } as unknown as PlanEvent;
    const unprepared = {
      eventId: "e2",
      sequence: 1,
      job: { jobId: "j1" },
      history: [{}],
    } as unknown as PlanEvent;

    await expect(repository.prepare(unbound)).rejects.toThrow(
      "History recovery binding missing",
    );
    await expect(
      repository.retain(
        { execute: transactionExecute } as unknown as DatabaseTransaction,
        "c1",
        unprepared,
      ),
    ).rejects.toThrow("synchronized");
  });

  it("retains a packet whose job lost its binding after preparation", async () => {
    const { repository, transactionExecute } = setup({});
    const event = {
      eventId: "e1",
      sequence: 1,
      job: { jobId: "j1", plan: PLAN as unknown },
      history: [{}],
    } as unknown as PlanEvent;
    await repository.prepare(event);
    (event.job as { plan?: unknown }).plan = undefined;

    await repository.retain(
      { execute: transactionExecute } as unknown as DatabaseTransaction,
      "c1",
      event,
    );

    expect(transactionExecute.mock.calls[0]?.[1]).toMatchObject({
      payload_plan_id: null,
      payload_run_id: null,
    });
  });

  it("answers the pending questions", async () => {
    expect(await setup({ rows: [["e1"]] }).repository.hasPending("c1")).toBe(
      true,
    );
    expect(await setup({}).repository.hasPending("c1")).toBe(false);
    expect(await setup({ rows: [["e1"]] }).repository.isPending("e1")).toBe(
      true,
    );
    expect(await setup({}).repository.isPending("e1")).toBe(false);
    expect(await setup({ rows: [[3]] }).repository.pendingCount("j1")).toBe(3);
    expect(await setup({}).repository.pendingCount("j1")).toBe(0);
  });
});

it("restores a packet of an unmanaged attempt", async () => {
  const harness = restoring(packetOf(), {
    state: { jobs: [jobOf()] },
    run: runOf(),
  });

  expect(await harness.repository.restore("c1")).toBe(1);

  expect(attemptParams(harness)).toMatchObject({
    attempt_id: "a1",
    provider: "codex_cli",
    requested_model: "gpt",
    instance_id: "j1",
    state: "ended",
    is_managed: false,
    history_end: 1,
    connection_id: null,
    agent_id: null,
  });
  expect(mocks.appendEvents).toHaveBeenCalledTimes(1);
  expect(harness.transactionExecute).toHaveBeenCalledTimes(2);
});

it("restores a managed attempt from the archive with recording values", async () => {
  const plan = {
    ...PLAN,
    managed: true,
    recordingAttemptId: "ra",
    recordingConnectionId: "rc",
    recordingAgentId: "ag",
    recordingModel: "rm",
    recordingInstanceId: "ri",
    historyBase: 4,
  };
  const archived = jobOf({
    status: "failed",
    plan,
    historyLength: 2,
    execution: {
      program: { ...CLI_PROGRAM, linkedProvider: "claude_code" },
    },
  });
  const harness = restoring(packetOf(plan, { launch: { id: "l1" } }), {
    state: { jobs: [] },
    archived,
    run: runOf({}, [
      {
        id: "s1",
        remote: { terminal: { usage: { inputTokens: 5 } } },
      },
    ]),
  });

  expect(await harness.repository.restore("c1")).toBe(1);

  expect(attemptParams(harness)).toMatchObject({
    attempt_id: "ra",
    connection_id: "rc",
    agent_id: "ag",
    requested_model: "rm",
    instance_id: "ri",
    provider: "claude_code",
    state: "failed",
    is_managed: true,
    history_end: 7,
  });
  expect(mocks.appendEvents).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ hasTerminalUsage: true, launchId: "l1" }),
  );
});

it.each([
  ["completed", "idle"],
  ["interrupted", "cancelled"],
  ["lost", "failed"],
  ["running", "running"],
])("maps the managed job status %s to %s", async (status, expected) => {
  const plan = { ...PLAN, managed: true };
  const harness = restoring(packetOf(plan), {
    state: { jobs: [jobOf({ status, plan, historyCursor: 1 })] },
    run: runOf({}, [{ id: "s1" }]),
  });

  await harness.repository.restore("c1");

  expect(attemptParams(harness)).toMatchObject({
    state: expected,
    history_end: 2,
  });
});

it("restores a packet that carries no history entries", async () => {
  const packet = JSON.stringify({
    type: "event",
    eventId: "e1",
    job: { jobId: "j1", plan: PLAN },
  });
  const harness = restoring(packet, {
    state: { jobs: [jobOf()] },
    run: runOf(),
  });

  expect(await harness.repository.restore("c1")).toBe(1);
  expect(mocks.appendEvents).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ events: [] }),
  );
});

it("finds the step through its owner and the connection of the job", async () => {
  const plan = { ...PLAN, stepId: "s9", ownerStepId: "s1", managed: true };
  const job = jobOf({
    plan,
    execution: {
      program: CLI_PROGRAM,
      managed: { connectionId: "mc" },
    },
  });
  const harness = restoring(packetOf(plan), {
    state: { jobs: [job] },
    run: runOf({}, [{ id: "s1" }]),
  });

  await harness.repository.restore("c1");

  expect(attemptParams(harness)).toMatchObject({
    step_id: "s9",
    connection_id: "mc",
  });
});

it("uses the program fallback model and no CLI program fields", async () => {
  const job = jobOf({
    execution: { program: { kind: "cli", route: { tool: "codex" } } },
  });
  const harness = restoring(packetOf(), {
    state: { jobs: [job] },
    run: runOf(),
  });

  await harness.repository.restore("c1");

  expect(attemptParams(harness)).toMatchObject({ requested_model: null });
});

it("blocks later packets of a failed job and records its diagnosis", async () => {
  const harness = setup({
    rows: [
      ["e1", "j1", "{"],
      ["e2", "j1", packetOf()],
    ],
  });

  expect(await harness.repository.restore("c1")).toBe(0);

  expect(harness.execute).toHaveBeenCalledTimes(1);
  expect(harness.execute.mock.calls[0]?.[1]).toEqual({
    event_id: "e1",
    diagnosis_json: '["issue"]',
  });
  expect(mocks.report).toHaveBeenCalledWith(["issue"], {
    jobId: "j1",
    runId: undefined,
    attemptId: undefined,
  });
});

it("reports the binding of a packet that fails after it was read", async () => {
  mocks.prepareEvents.mockRejectedValueOnce(new Error("disk"));
  const harness = restoring(packetOf());

  await harness.repository.restore("c1");

  expect(mocks.report).toHaveBeenCalledWith(["issue"], {
    jobId: "j1",
    runId: "r1",
    attemptId: "a1",
  });
});

it.each([
  ["a packet that is no event", JSON.stringify({ type: "other" })],
  ["a packet without a plan", packetOf(undefined)],
])("fails %s", async (...parts) => {
  const harness = restoring(String(parts[1]));

  expect(await harness.repository.restore("c1")).toBe(0);
  expect(harness.execute).toHaveBeenCalledTimes(1);
});

it.each([
  ["no state", {}],
  ["a state without jobs", { state: { jobs: "x" } }],
  ["a state that is no object", { state: 5 }],
  ["a state that is null", { state: null }],
  ["a missing job", { state: { jobs: [] } }],
  ["a job without a plan", { state: { jobs: [jobOf({ plan: undefined })] } }],
  ["a missing run", { state: { jobs: [jobOf()] } }],
  [
    "a job without a CLI program",
    {
      state: { jobs: [jobOf({ execution: { program: { kind: "api" } } })] },
      run: runOf(),
    },
  ],
  [
    "a CLI program without a tool",
    {
      state: {
        jobs: [jobOf({ execution: { program: { kind: "cli", route: {} } } })],
      },
      run: runOf(),
    },
  ],
  [
    "a job without execution",
    { state: { jobs: [jobOf({ execution: undefined })] }, run: runOf() },
  ],
  [
    "another plan",
    { state: { jobs: [jobOf()] }, run: runOf({ planId: "other" }) },
  ],
  [
    "another attempt",
    {
      state: { jobs: [jobOf()] },
      run: runOf({}, [{ id: "s1", execution: { attemptId: "zz" } }]),
    },
  ],
  [
    "a missing step of a managed job",
    {
      state: { jobs: [jobOf({ plan: { ...PLAN, managed: true } })] },
      run: runOf({}, []),
    },
  ],
])("fails for %s", async (...parts) => {
  const harness = restoring(packetOf(), parts[1]);

  expect(await harness.repository.restore("c1")).toBe(0);
  expect(harness.execute).toHaveBeenCalledTimes(1);
});
