import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findPlan: vi.fn(),
}));
vi.mock("../agent/AgentPlanAgentTodoRepository", () => ({
  AgentPlanAgentTodoRepository: class {
    public readonly findPlan = mocks.findPlan;
  },
}));

import { RunnerRepository } from "./RunnerRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { RunnerState } from "@/definition/RunnerProtocol";

type Call = (...parameters: unknown[]) => Promise<undefined>;

const SESSION = "11111111-1111-4111-8111-111111111111";
const STATE: RunnerState = {
  version: 1,
  sessionId: SESSION,
  sequence: 1,
  lastEventId: null,
  jobs: [],
};
const JOB = {
  jobId: "22222222-2222-4222-8222-222222222222",
  sessionId: SESSION,
  status: "queued",
};

function repositoryOf(rows: unknown[][] = []): {
  repository: RunnerRepository;
  database: Database;
  execute: ReturnType<typeof vi.fn>;
  transactionExecute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn<Call>(async () => undefined);
  const transactionExecute = vi.fn<Call>(async () => undefined);
  const database = {
    query: vi.fn(async () => rows),
    execute,
    transaction: async (work: (access: DatabaseTransaction) => Promise<void>) =>
      work({ execute: transactionExecute } as unknown as DatabaseTransaction),
  } as unknown as Database;
  return {
    repository: new RunnerRepository(database),
    database,
    execute,
    transactionExecute,
  };
}

beforeEach(() => vi.clearAllMocks());

it("finds no unknown runner", async () => {
  expect(await repositoryOf().repository.find("c1")).toBeNull();
});

it("reads a registered runner with its parsed state", async () => {
  const { repository } = repositoryOf([
    ["c1", "r1", "hash", 3, JSON.stringify(STATE)],
  ]);

  expect(await repository.find("c1")).toEqual({
    connectionId: "c1",
    runnerId: "r1",
    tokenHash: "hash",
    connectionRevision: 3,
    state: STATE,
  });
});

it("reads archived jobs by id and by attempt", async () => {
  const stored = [[JSON.stringify(JOB)]];

  expect(
    await repositoryOf(stored).repository.archivedJob("c1", JOB.jobId),
  ).toEqual(JOB);
  expect(
    await repositoryOf().repository.archivedJob("c1", JOB.jobId),
  ).toBeUndefined();
  expect(
    await repositoryOf(stored).repository.archivedAttempt("c1", "r1", "a1"),
  ).toEqual(JOB);
  expect(
    await repositoryOf().repository.archivedAttempt("c1", "r1", "a1"),
  ).toBeUndefined();
});

it("projects native todos with their statuses", async () => {
  mocks.findPlan.mockResolvedValueOnce([
    { text: "a", status: "active" },
    { text: "b", status: "done" },
    { text: "c", status: "open" },
  ]);
  const { repository } = repositoryOf();

  expect(await repository.nativePlan("a1")).toEqual([
    { content: "a", status: "in_progress" },
    { content: "b", status: "completed" },
    { content: "c", status: "pending" },
  ]);
  mocks.findPlan.mockResolvedValueOnce(null);
  expect(await repository.nativePlan("a1")).toBeUndefined();
});

it("creates a pairing", async () => {
  const { repository, execute } = repositoryOf();

  await repository.create({
    connectionId: "c1",
    runnerId: "r1",
    tokenHash: "h",
    connectionRevision: 2,
    state: STATE,
  });

  expect(execute.mock.calls[0]?.[1]).toEqual({
    connection_id: "c1",
    runner_id: "r1",
    token_hash: "h",
    connection_revision: 2,
    state_json: JSON.stringify(STATE),
  });
});

it("checkpoints the archive and the state, running the journal first", async () => {
  const { repository, transactionExecute } = repositoryOf();
  const journal = vi.fn<Call>(async () => undefined);

  await repository.checkpoint("c1", STATE, journal);
  await repository.checkpoint("c1", STATE);

  expect(journal).toHaveBeenCalledTimes(1);
  expect(transactionExecute).toHaveBeenCalledTimes(4);
  expect(transactionExecute.mock.calls[0]?.[1]).toEqual({
    connection_id: "c1",
    state_json: JSON.stringify(STATE),
  });
});

it("wakes the cleanup of a reconnected runner and removes a runner", async () => {
  const { repository, execute } = repositoryOf();

  await repository.reconnected("c1");
  await repository.remove("c1");

  expect(execute.mock.calls[0]?.[1]).toEqual({ connection_id: "c1" });
  expect(execute.mock.calls[1]?.[1]).toEqual({ connection_id: "c1" });
});
