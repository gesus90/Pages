import { expect, it, vi } from "vitest";

import type { Database } from "@/backend/database/Database";
import { StorageMaintenanceRepository } from "./StorageMaintenanceRepository";

const append = vi.hoisted(() => vi.fn(async () => undefined));
const record = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock(
  "@/backend/database/repositories/events/PagesEventOutboxRepository",
  () => ({
    PagesEventOutboxRepository: class {
      public readonly append = append;
    },
  }),
);
vi.mock(
  "@/backend/database/repositories/automation/AutomationEventRepository",
  () => ({
    AutomationEventRepository: class {
      public readonly record = record;
    },
  }),
);

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const NOW = 10 * DAY;
const USAGE = { totalBytes: 1, limitBytes: 2, largestDirectoryBytes: [1] };

/** Answers the due check with the time of the last run, or no row. */
function repositoryOf(
  lastRun: number | null,
  busy = false,
): {
  repository: StorageMaintenanceRepository;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async () => undefined);
  const query = vi.fn(async (statement: string) => {
    if (statement.includes("pages_storage_maintenance"))
      return lastRun === null ? [] : [[lastRun]];
    return busy ? [["instance"]] : [];
  });
  const transaction = vi.fn(
    async (work: (transaction: unknown) => Promise<unknown>) =>
      work({ query, execute }),
  );
  return {
    repository: new StorageMaintenanceRepository({
      query,
      transaction,
    } as unknown as Pick<Database, "transaction" | "query">),
    execute,
  };
}

it("runs work while the store is idle", async () => {
  const work = vi.fn(async () => undefined);

  await repositoryOf(null).repository.whileIdle(work);
  await repositoryOf(null, true).repository.whileIdle(work);

  expect(work).toHaveBeenCalledTimes(1);
});

it("runs the daily work when it was never run", async () => {
  const { repository, execute } = repositoryOf(null);
  const work = vi.fn(async () => undefined);

  await repository.daily(NOW, work);

  expect(work).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0]?.[1]).toEqual({
    task: "shared-environment",
    now: NOW,
  });
});

it("skips the daily work within a day", async () => {
  const { repository, execute } = repositoryOf(NOW - DAY + 1);
  const work = vi.fn(async () => undefined);

  await repository.daily(NOW, work);

  expect(work).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});

it("skips the daily work while a lease is held", async () => {
  const { repository } = repositoryOf(null, true);
  const work = vi.fn(async () => undefined);

  await repository.daily(NOW, work);

  expect(work).not.toHaveBeenCalled();
});

it("claims the hourly measurement only when due", async () => {
  const due = repositoryOf(NOW - HOUR);
  const recent = repositoryOf(NOW - HOUR + 1);

  await expect(due.repository.claimMeasurement(NOW)).resolves.toBe(true);
  expect(due.execute.mock.calls[0]?.[1]).toEqual({
    task: "measurement",
    now: NOW,
  });
  await expect(recent.repository.claimMeasurement(NOW)).resolves.toBe(false);
  expect(recent.execute).not.toHaveBeenCalled();
});

it("commits the warning with its event and inbox record", async () => {
  const { repository, execute } = repositoryOf(null);

  const event = await repository.warning(NOW, USAGE);

  expect(event).toEqual({
    type: "storage.limit_exceeded",
    id: "storage",
    storage: USAGE,
  });
  expect(execute.mock.calls[0]?.[1]).toEqual({ task: "warning", now: NOW });
  expect(append).toHaveBeenCalledWith(event);
  expect(record).toHaveBeenCalledWith({
    eventType: "storage.limit_exceeded",
    actorId: null,
    occurredAt: new Date(NOW).toISOString(),
    payload: JSON.stringify(USAGE),
  });
});

it("warns at most once per day", async () => {
  const { repository, execute } = repositoryOf(NOW - 1);

  await expect(repository.warning(NOW, USAGE)).resolves.toBeNull();
  expect(execute).not.toHaveBeenCalled();
});
