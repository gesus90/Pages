import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GitHubSyncScheduler } from "@/backend/github/GitHubSyncScheduler";

describe("GitHubSyncScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs due synchronizations on its interval exactly once", async () => {
    const runScheduledSyncs = vi
      .fn()
      .mockResolvedValue({ completed: 2, failed: 0 });
    const scheduler = new GitHubSyncScheduler(
      { runScheduledSyncs } as never,
      60_000,
    );

    scheduler.start();
    scheduler.start();

    expect(runScheduledSyncs).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runScheduledSyncs).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runScheduledSyncs).toHaveBeenCalledTimes(2);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runScheduledSyncs).toHaveBeenCalledTimes(2);
  });

  it("ignores stop calls without a running timer", () => {
    const scheduler = new GitHubSyncScheduler({
      runScheduledSyncs: vi.fn(),
    } as never);

    expect(() => scheduler.stop()).not.toThrow();
  });

  it("returns run counters from manual rounds", async () => {
    const scheduler = new GitHubSyncScheduler({
      runScheduledSyncs: vi.fn().mockResolvedValue({ completed: 1, failed: 1 }),
    } as never);

    await expect(scheduler.runDueSyncs()).resolves.toEqual({
      completed: 1,
      failed: 1,
    });
  });

  it("absorbs scheduler failures without throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const scheduler = new GitHubSyncScheduler({
      runScheduledSyncs: vi.fn().mockRejectedValue(new Error("Database gone")),
    } as never);

    await expect(scheduler.runDueSyncs()).resolves.toEqual({
      completed: 0,
      failed: 0,
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("scheduled GitHub synchronization failed"),
      expect.any(Error),
    );

    log.mockRestore();
  });
});
