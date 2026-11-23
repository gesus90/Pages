import { beforeEach, expect, it, vi } from "vitest";

import { releaseCheckedWorkspaceLocks } from "./AgentPlanWorkspaceLockRelease";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";

const mocks = vi.hoisted(() => ({
  logEvent: vi.fn(),
  returnHandedOverPlanLocks: vi.fn(async () => {}),
}));

vi.mock("@/backend/logging/Logger", () => ({ logEvent: mocks.logEvent }));
vi.mock("./AgentPlanHandoverLocks", () => ({
  returnHandedOverPlanLocks: mocks.returnHandedOverPlanLocks,
}));

const run: AgentPlanRun = {
  id: "run",
  planId: "plan",
  planName: "Plan",
  planRevision: 1,
  userId: "user",
  startedAt: "2026-01-01T00:00:00.000Z",
  status: "failed",
  stopRequested: false,
  steps: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

function transactionOf(
  answers: readonly (readonly (readonly DatabaseValue[])[])[],
  hasCommitHook = true,
): {
  readonly transaction: DatabaseTransaction;
  readonly commits: (() => Promise<void>)[];
} {
  const commits: (() => Promise<void>)[] = [];
  const query = vi.fn<DatabaseTransaction["query"]>(async () => []);
  for (const rows of answers)
    query.mockImplementationOnce(async () => rows.map((row) => [...row]));
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  return {
    transaction: hasCommitHook
      ? { query, execute, onCommit: (effect) => void commits.push(effect) }
      : { query, execute },
    commits,
  };
}

const storedRun = JSON.stringify(run);

it("releases the locks and logs each release after the commit", async () => {
  const { transaction, commits } = transactionOf([
    [[storedRun]],
    [],
    [["ws-1"], ["ws-2"]],
  ]);

  await releaseCheckedWorkspaceLocks(transaction, run, "restart");
  await commits[0]?.();

  expect(mocks.returnHandedOverPlanLocks).toHaveBeenCalledWith(
    transaction,
    "run",
  );
  expect(mocks.logEvent).toHaveBeenCalledTimes(2);
  expect(mocks.logEvent.mock.calls[1]?.[0]).toMatchObject({
    metadata: { runId: "run", lock: "ws-2", reason: "restart" },
  });
});

it("releases without a commit hook", async () => {
  const { transaction } = transactionOf([[[storedRun]], [], []], false);

  await expect(
    releaseCheckedWorkspaceLocks(transaction, run, "restart"),
  ).resolves.toBeUndefined();
});

it("refuses a run that is stored no more", async () => {
  const { transaction } = transactionOf([[]]);

  await expect(
    releaseCheckedWorkspaceLocks(transaction, run, "x"),
  ).rejects.toMatchObject({ code: "action_unavailable" });
});

it("refuses a run that is still active", async () => {
  const { transaction } = transactionOf([[[storedRun]]]);

  await expect(
    releaseCheckedWorkspaceLocks(
      transaction,
      { ...run, status: "running" },
      "x",
    ),
  ).rejects.toMatchObject({ code: "action_unavailable" });
});

it("refuses a run whose stored state changed", async () => {
  const { transaction } = transactionOf([
    [[JSON.stringify({ ...run, planName: "Other" })]],
  ]);

  await expect(
    releaseCheckedWorkspaceLocks(transaction, run, "x"),
  ).rejects.toMatchObject({ code: "action_unavailable" });
});

it("refuses a release while durable obligations remain", async () => {
  const { transaction } = transactionOf([[[storedRun]], [[1]]]);

  await expect(
    releaseCheckedWorkspaceLocks(transaction, run, "x"),
  ).rejects.toMatchObject({ code: "cleanup_unconfirmed" });
});

it("refuses a release while a runner job has no confirmed closeout", async () => {
  const job = {
    connectionId: "2f1c3d3e-6b9a-4f5e-8c1d-0a1b2c3d4e5f",
    jobId: "3f1c3d3e-6b9a-4f5e-8c1d-0a1b2c3d4e5f",
    attemptId: "4f1c3d3e-6b9a-4f5e-8c1d-0a1b2c3d4e5f",
    stepId: "s",
    ownerStepId: "s",
    status: "running" as const,
    closeout: "pending" as const,
  };
  const withJob = { ...run, runnerJobs: [job] };
  const { transaction } = transactionOf([[[JSON.stringify(withJob)]], []]);

  await expect(
    releaseCheckedWorkspaceLocks(transaction, withJob, "x"),
  ).rejects.toMatchObject({ code: "cleanup_unconfirmed" });
});
