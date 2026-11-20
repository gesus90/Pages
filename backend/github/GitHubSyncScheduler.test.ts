import { afterEach, expect, it, vi } from "vitest";

import { GitHubSyncScheduler } from "./GitHubSyncScheduler";

const logs = vi.hoisted(() => ({
  event: vi.fn(),
  caught: vi.fn(),
  diagnostic: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => ({
  logEvent: logs.event,
  logCaughtError: logs.caught,
  logDiagnostic: logs.diagnostic,
}));
vi.mock("@/backend/logging/LoggedOperation", () => ({
  loggedJob: (
    component: string,
    event: string,
    work: () => Promise<unknown>,
  ) => {
    void component;
    void event;
    return work();
  },
}));

afterEach(() => vi.useRealTimers());

it("starts once, runs on ticks and stops the interval", async () => {
  vi.useFakeTimers();
  const runScheduledSyncs = vi
    .fn()
    .mockResolvedValue({ completed: 2, failed: 1 });
  const scheduler = new GitHubSyncScheduler({ runScheduledSyncs }, 100);
  scheduler.start();
  scheduler.start();
  await vi.advanceTimersByTimeAsync(100);
  expect(runScheduledSyncs).toHaveBeenCalledTimes(1);
  await scheduler.stop();
  await vi.advanceTimersByTimeAsync(100);
  expect(runScheduledSyncs).toHaveBeenCalledTimes(1);
  await scheduler.stop();
});

it("skips overlapping rounds and waits for the current round", async () => {
  let finish: (value: { completed: number; failed: number }) => void = () => {};
  const runScheduledSyncs = vi.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const scheduler = new GitHubSyncScheduler({ runScheduledSyncs });
  const round = scheduler.runDueSyncs();
  expect(await scheduler.runDueSyncs()).toEqual({ completed: 0, failed: 0 });
  const stopped = scheduler.stop();
  finish({ completed: 1, failed: 0 });
  expect(await round).toEqual({ completed: 1, failed: 0 });
  await stopped;
  expect(logs.event).toHaveBeenCalledWith(
    expect.objectContaining({ event: "job.github_sync.skipped" }),
  );
});

it("logs failures and bounds shutdown while work remains pending", async () => {
  vi.useFakeTimers();
  const runScheduledSyncs = vi.fn().mockRejectedValueOnce(new Error("failure"));
  const scheduler = new GitHubSyncScheduler({ runScheduledSyncs });
  expect(await scheduler.runDueSyncs()).toEqual({ completed: 0, failed: 0 });
  expect(logs.caught).toHaveBeenCalled();
  let finish: (value: { completed: number; failed: number }) => void = () => {};
  runScheduledSyncs.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const round = scheduler.runDueSyncs();
  const stopped = scheduler.stop();
  await vi.advanceTimersByTimeAsync(10_000);
  await stopped;
  expect(logs.event).toHaveBeenCalledWith(
    expect.objectContaining({ event: "job.github_sync.stop_timeout" }),
  );
  finish({ completed: 0, failed: 0 });
  await round;
});
