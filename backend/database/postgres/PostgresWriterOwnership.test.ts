import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  wait: vi.fn(() => Promise.resolve()),
  metrics: vi.fn(),
  logCaught: vi.fn(),
  work: vi.fn(),
}));
vi.mock("node:timers/promises", () => ({ setTimeout: mocks.wait }));
vi.mock("@/backend/logging/DatabaseLogMetrics", () => ({
  recordDatabaseWaitMetrics: mocks.metrics,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaught,
}));

import { withDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { withPostgresWriterOwnership } from "@/backend/database/postgres/PostgresWriterOwnership";

import type { PostgresConnection } from "@/backend/database/postgres/PostgresConnection";

function connectionWith(run: ReturnType<typeof vi.fn>): PostgresConnection {
  return { run, discard: vi.fn() } as unknown as PostgresConnection;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("holds the lock around the work and releases it", async () => {
  const run = vi
    .fn()
    .mockResolvedValueOnce([[1]])
    .mockResolvedValue([]);
  const result = await withPostgresWriterOwnership(connectionWith(run), () =>
    Promise.resolve("done"),
  );
  expect(result).toBe("done");
  expect(run).toHaveBeenCalledTimes(2);
  expect(mocks.metrics).toHaveBeenCalled();
});

it("retries until the lock is free", async () => {
  const run = vi
    .fn()
    .mockResolvedValueOnce([[0]])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([[1]])
    .mockResolvedValue([]);
  await withPostgresWriterOwnership(connectionWith(run), () =>
    Promise.resolve(1),
  );
  expect(mocks.wait).toHaveBeenCalledWith(20);
});

it("releases the lock when the work fails", async () => {
  const run = vi
    .fn()
    .mockResolvedValueOnce([[1]])
    .mockResolvedValue([]);
  await expect(
    withPostgresWriterOwnership(connectionWith(run), () =>
      Promise.reject(new Error("work")),
    ),
  ).rejects.toThrow("work");
  expect(run).toHaveBeenLastCalledWith(
    expect.stringContaining("unlock"),
    {},
    "execute",
  );
});

it("keeps the work error when the release fails too", async () => {
  const run = vi
    .fn()
    .mockResolvedValueOnce([[1]])
    .mockRejectedValue(new Error("release"));
  const connection = connectionWith(run);
  await expect(
    withPostgresWriterOwnership(connection, () =>
      Promise.reject(new Error("work")),
    ),
  ).rejects.toThrow("work");
  expect(mocks.logCaught).toHaveBeenCalled();
  expect(connection.discard).toHaveBeenCalled();
});

it("fails when the release fails after the work", async () => {
  const run = vi
    .fn()
    .mockResolvedValueOnce([[1]])
    .mockRejectedValue(new Error("release"));
  await expect(
    withPostgresWriterOwnership(connectionWith(run), () => Promise.resolve(1)),
  ).rejects.toThrow("release");
});

it("gives up after the request budget and honours an abort", async () => {
  const run = vi.fn().mockImplementation(() => {
    vi.advanceTimersByTime(30_000);
    return Promise.resolve([[0]]);
  });
  await expect(
    withDatabaseWork({ workClass: "request", signal: undefined }, () =>
      withPostgresWriterOwnership(connectionWith(run), () =>
        Promise.resolve(1),
      ),
    ),
  ).rejects.toMatchObject({ failure: "queue_timeout" });
  const controller = new AbortController();
  controller.abort();
  await expect(
    withDatabaseWork({ workClass: "request", signal: controller.signal }, () =>
      withPostgresWriterOwnership(connectionWith(run), () =>
        Promise.resolve(1),
      ),
    ),
  ).rejects.toMatchObject({ failure: "aborted" });
});

it("waits longer outside a request", async () => {
  const run = vi.fn().mockImplementation(() => {
    vi.advanceTimersByTime(30_000);
    return Promise.resolve([[1]]);
  });
  await expect(
    withPostgresWriterOwnership(connectionWith(run), () => Promise.resolve(1)),
  ).resolves.toBe(1);
});
