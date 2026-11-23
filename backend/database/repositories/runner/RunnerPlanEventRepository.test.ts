import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  persist: vi.fn<Call>(async () => undefined),
  requireReferences: vi.fn<Call>(async () => undefined),
  fence: vi.fn(),
  sessionEvents: vi.fn<Call>(async () => undefined),
}));
vi.mock("@/backend/storage/AgentPayloadFileStore", () => ({
  readStoredAgentPayload: async (...parts: unknown[]) => String(parts[1]),
}));
vi.mock("../agent/AgentWorkspaceReferencesRepository", () => ({
  AgentWorkspaceReferencesRepository: class {
    public readonly requireReferences = mocks.requireReferences;
  },
}));
vi.mock("@/backend/agents/AgentPlanRunInput", () => ({
  readPlanRun: (input: unknown) => input,
}));
vi.mock("@/backend/agents/AgentPlanDispatchFence", () => ({
  requirePlanDispatchFence: mocks.fence,
}));
vi.mock("./RunnerHistoryRecoveryRepository", () => ({
  RunnerHistoryRecoveryRepository: class {},
}));
vi.mock("../agent/AgentPlanProgressRepository", () => ({
  AgentPlanProgressRepository: class {
    public readonly persist = mocks.persist;
  },
}));
vi.mock("../agent/AgentPlanContinuationRepository", () => ({
  CURRENT_PLAN_SNAPSHOT: "snapshot_expression",
}));
vi.mock("./RunnerSessionEvents", () => ({
  persistRunnerSessionEvents: mocks.sessionEvents,
}));

import { RunnerPlanEventRepository } from "./RunnerPlanEventRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type {
  RunnerPlanBinding,
  RunnerState,
} from "@/definition/RunnerProtocol";

type Call = (...parameters: unknown[]) => Promise<undefined>;
type Read = (...parameters: unknown[]) => Promise<unknown[][]>;

const BINDING = { runId: "r1" } as unknown as RunnerPlanBinding;

function repositoryOf(rows: unknown[][] = []): {
  repository: RunnerPlanEventRepository;
  transaction: DatabaseTransaction;
  transactionExecute: ReturnType<typeof vi.fn>;
} {
  const transactionExecute = vi.fn<Call>(async () => undefined);
  const transaction = {
    query: vi.fn<Read>(async () => rows),
    execute: transactionExecute,
  } as unknown as DatabaseTransaction;
  const database = {
    query: vi.fn<Read>(async () => rows),
    transaction: async (work: (access: DatabaseTransaction) => Promise<void>) =>
      work(transaction),
  } as unknown as Database;
  return {
    repository: new RunnerPlanEventRepository(database),
    transaction,
    transactionExecute,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("receipt", () => {
  it("reads an acknowledged event", async () => {
    const { repository } = repositoryOf([["c1", "s1", 4, "digest"]]);

    expect(await repository.receipt("e1")).toEqual({
      connectionId: "c1",
      sessionId: "s1",
      sequence: 4,
      digest: "digest",
    });
  });

  it("knows no receipt of an unknown event", async () => {
    expect(await repositoryOf().repository.receipt("e1")).toBeNull();
  });
});

describe("requireDispatchFence", () => {
  it("checks references and the fence", async () => {
    const run = { id: "r1" };
    const { repository, transaction } = repositoryOf([
      [JSON.stringify(run), '{"w":1}'],
    ]);

    await repository.requireDispatchFence(transaction, BINDING);

    expect(mocks.requireReferences).toHaveBeenCalledWith({ w: 1 });
    expect(mocks.fence).toHaveBeenCalledWith(run, BINDING);
  });

  it("fails for a run that does not exist", async () => {
    const { repository, transaction } = repositoryOf([]);

    await expect(
      repository.requireDispatchFence(transaction, BINDING),
    ).rejects.toThrow();
  });
});

describe("fenceStoppedRuns", () => {
  const state = (jobs: unknown[]): RunnerState =>
    ({ version: 1, jobs }) as unknown as RunnerState;

  it("keeps jobs without a binding or with a cancellation", async () => {
    const { repository } = repositoryOf();
    const jobs = [
      { jobId: "a" },
      { jobId: "b", plan: BINDING, cancellation: {} },
    ];

    const fenced = await repository.fenceStoppedRuns(state(jobs));

    expect(fenced.jobs).toEqual(jobs);
  });

  it("cancels the job of a stopped run only", async () => {
    const stopped = repositoryOf([[JSON.stringify({ stopRequested: true })]]);
    const running = repositoryOf([[JSON.stringify({ stopRequested: false })]]);
    const missing = repositoryOf([]);
    const job = { jobId: "a", plan: BINDING };

    const [first] = (await stopped.repository.fenceStoppedRuns(state([job])))
      .jobs;
    const [second] = (await running.repository.fenceStoppedRuns(state([job])))
      .jobs;
    const [third] = (await missing.repository.fenceStoppedRuns(state([job])))
      .jobs;

    expect(first?.cancellation?.requestedAt).toEqual(expect.any(String));
    expect(second).toBe(job);
    expect(third).toBe(job);
  });
});

describe("append", () => {
  it("records the digest of the event", async () => {
    const { repository, transactionExecute } = repositoryOf();

    await repository.append(
      { execute: transactionExecute } as unknown as DatabaseTransaction,
      "c1",
      {
        digest: "d",
        event: {
          sessionId: "s1",
          sequence: 2,
          eventId: "e1",
        } as unknown as never,
      },
    );

    expect(transactionExecute.mock.calls[0]?.[1]).toEqual({
      connection_id: "c1",
      session_id: "s1",
      sequence: 2,
      event_id: "e1",
      event_digest: "d",
    });
  });
});

describe("apply and changeRun", () => {
  const current = { id: "r1", steps: [] } as unknown as AgentPlanRun;
  const rows = [[JSON.stringify(current), '{"snap":true}']];

  it("rejects an unknown run", async () => {
    const { repository, transaction } = repositoryOf([]);

    await expect(
      repository.apply(transaction, "r1", (run) => ({ run })),
    ).rejects.toThrow("Unknown runner plan run");
  });

  it("writes nothing when the reducer returns the loaded run", async () => {
    const { repository, transaction } = repositoryOf(rows);
    const reduce = vi.fn((run: AgentPlanRun) => ({ run }));
    let loaded: AgentPlanRun | undefined;

    await repository.apply(transaction, "r1", (run, snapshot) => {
      loaded = run;
      expect(snapshot).toEqual({ snap: true });
      return reduce(run);
    });

    expect(loaded).toEqual(current);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("persists a changed run with its checkpoint and history", async () => {
    const { repository, transaction } = repositoryOf(rows);
    const next = { ...current, id: "changed" } as unknown as AgentPlanRun;
    const checkpoint = { kind: "x" };

    await repository.apply(
      transaction,
      "r1",
      () => ({ run: next, checkpoint: checkpoint as never }),
      { stepId: "s1", events: [{} as unknown as never] },
    );

    expect(mocks.persist).toHaveBeenCalledWith(transaction, next, checkpoint);
    expect(mocks.sessionEvents).toHaveBeenCalledWith(transaction, next, {
      stepId: "s1",
      events: [],
    });
  });

  it("persists without history when none is given", async () => {
    const { repository, transaction } = repositoryOf(rows);

    await repository.apply(transaction, "r1", () => ({
      run: { id: "other" } as unknown as AgentPlanRun,
    }));

    expect(mocks.sessionEvents).not.toHaveBeenCalled();
  });

  it("changes a run inside one transaction", async () => {
    const { repository } = repositoryOf(rows);

    await repository.changeRun("r1", (run) => ({ ...run, id: "changed" }));

    expect(mocks.persist).toHaveBeenCalledTimes(1);
  });
});
