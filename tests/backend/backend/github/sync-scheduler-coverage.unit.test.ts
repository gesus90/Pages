import { afterEach, expect, it, vi } from "vitest";

import { GitHubSyncScheduler } from "@/backend/github/GitHubSyncScheduler";

import { partial } from "../../app/lib/service-wiring-fakes";

import type { GitHubSyncService } from "@/backend/service/GitHubSyncService";

afterEach(() => vi.useRealTimers());

it("runs on a fixed interval and stops without scheduling further rounds", async () => {
  vi.useFakeTimers();
  const runScheduledSyncs = vi.fn(async () => ({ completed: 1, failed: 0 }));
  const scheduler = new GitHubSyncScheduler(
    partial<GitHubSyncService>({ runScheduledSyncs }),
    1000,
  );
  scheduler.start();
  scheduler.start();
  await vi.advanceTimersByTimeAsync(1000);
  expect(runScheduledSyncs).toHaveBeenCalledOnce();
  await scheduler.stop();
  await vi.advanceTimersByTimeAsync(2000);
  expect(runScheduledSyncs).toHaveBeenCalledOnce();
});

it("skips overlapping rounds and waits for the active one on stop", async () => {
  let resolve: (result: {
    completed: number;
    failed: number;
  }) => void = () => {};
  const runScheduledSyncs = vi.fn(
    () =>
      new Promise<{ completed: number; failed: number }>((done) => {
        resolve = done;
      }),
  );
  const scheduler = new GitHubSyncScheduler(
    partial<GitHubSyncService>({ runScheduledSyncs }),
  );
  const active = scheduler.runDueSyncs();
  await expect(scheduler.runDueSyncs()).resolves.toEqual({
    completed: 0,
    failed: 0,
  });
  const stopped = scheduler.stop();
  resolve({ completed: 2, failed: 1 });
  await expect(active).resolves.toEqual({ completed: 2, failed: 1 });
  await stopped;
  expect(runScheduledSyncs).toHaveBeenCalledOnce();
});

it("contains provider failures without throwing from the recurring job", async () => {
  const scheduler = new GitHubSyncScheduler(
    partial<GitHubSyncService>({
      runScheduledSyncs: async () => {
        throw new Error("offline");
      },
    }),
  );
  await expect(scheduler.runDueSyncs()).resolves.toEqual({
    completed: 0,
    failed: 0,
  });
});
