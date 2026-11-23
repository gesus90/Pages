import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { deferPlanRunPurge } from "./AgentPlanPurgeRetry";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";

const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn() }));

vi.mock("@/backend/logging/Logger", () => ({ logEvent }));

const NOW = 10_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  logEvent.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

function run(
  entry: unknown[] | undefined,
  blocked: unknown[][] = [],
  withCommitHook = true,
): {
  readonly database: Pick<Database, "transaction">;
  readonly query: ReturnType<typeof vi.fn<DatabaseTransaction["query"]>>;
  readonly execute: ReturnType<typeof vi.fn<DatabaseTransaction["execute"]>>;
  readonly commits: (() => Promise<void>)[];
} {
  const commits: (() => Promise<void>)[] = [];
  const query = vi
    .fn<DatabaseTransaction["query"]>()
    .mockResolvedValueOnce((entry ? [entry] : []) as never)
    .mockResolvedValueOnce(blocked as never);
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => undefined);
  const transaction = {
    query,
    execute,
    ...(withCommitHook
      ? { onCommit: (hook: () => Promise<void>) => commits.push(hook) }
      : {}),
  } as unknown as DatabaseTransaction;
  const database = {
    transaction: async (work: (t: DatabaseTransaction) => Promise<void>) =>
      work(transaction),
  } as unknown as Pick<Database, "transaction">;
  return { database, query, execute, commits };
}

it("does nothing when no purge intent is stored", async () => {
  const { database, execute } = run(undefined);

  await deferPlanRunPurge(database, "r1");

  expect(execute).not.toHaveBeenCalled();
});

it("logs the blocked earlier runs on the first deferral", async () => {
  const { database, execute, commits } = run(
    [0, 0],
    [["old", "workspace_locks"]],
  );

  await deferPlanRunPurge(database, "r1");
  await commits[0]?.();

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    retry_count: 1,
    retry_after: NOW + 60_000,
    last_log_at: NOW,
  });
  expect(logEvent.mock.calls[0]?.[0]).toMatchObject({
    message: "Earlier runs retain resources: old: workspace_locks",
    metadata: {
      blockedRunId: "old",
      reason: "workspace_locks",
      count: 1,
    },
  });
});

it("reports a remaining batch when nothing blocks", async () => {
  const { database, commits } = run([2, NOW - 3_600_000]);

  await deferPlanRunPurge(database, "r1");
  await commits[0]?.();

  expect(logEvent.mock.calls[0]?.[0]).toMatchObject({
    message: "More settled runs remain in the purge batch",
    metadata: {
      blockedRunId: null,
      reason: "batch_remaining",
    },
  });
});

it("caps the delay and keeps the log fence within the hour", async () => {
  const { database, execute, query } = run([20, NOW - 1000]);

  await deferPlanRunPurge(database, "r1");

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    retry_count: 16,
    retry_after: NOW + 3_600_000,
    last_log_at: NOW - 1000,
  });
  expect(query).toHaveBeenCalledTimes(1);
});

it("skips the log hook when the transaction has none", async () => {
  const { database, commits } = run([0, 0], [], false);

  await expect(deferPlanRunPurge(database, "r1")).resolves.toBeUndefined();
  expect(commits).toHaveLength(0);
});
