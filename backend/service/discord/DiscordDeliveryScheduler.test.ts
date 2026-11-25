import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DiscordDeliveryScheduler } from "./DiscordDeliveryScheduler";

const mocks = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
  loggedJob: vi.fn(),
}));

vi.mock("@/backend/logging/LoggedOperation", () => ({
  loggedJob: mocks.loggedJob,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
  logDiagnostic: mocks.logDiagnostic,
}));

beforeEach(() => {
  vi.useFakeTimers();
  mocks.loggedJob.mockImplementation(
    (...args: [string, string, () => Promise<unknown>]) => args[2](),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("DiscordDeliveryScheduler.run", () => {
  it("runs the worker inside a logged job and reports success", async () => {
    const runDue = vi.fn().mockResolvedValue({});
    const scheduler = new DiscordDeliveryScheduler({ runDue });

    expect(await scheduler.run()).toBe(true);
    expect(mocks.loggedJob).toHaveBeenCalledWith(
      "DiscordDeliveryScheduler",
      "job.discord_delivery",
      expect.any(Function),
    );
    expect(runDue).toHaveBeenCalledTimes(1);
  });

  it("logs a failed round and never throws", async () => {
    const error = new Error("down");
    const scheduler = new DiscordDeliveryScheduler({
      runDue: vi.fn().mockRejectedValue(error),
    });

    expect(await scheduler.run()).toBe(false);
    expect(mocks.logCaughtError).toHaveBeenCalledWith(
      "DiscordDeliveryScheduler",
      error,
    );
    expect(mocks.logDiagnostic).toHaveBeenCalledWith(
      "DiscordDeliveryScheduler",
      "error",
      "Pages could not deliver Discord notifications.",
      error,
    );
  });
});

describe("DiscordDeliveryScheduler timers", () => {
  it("starts once, delivers at once and then on every interval", async () => {
    const runDue = vi.fn().mockResolvedValue({});
    const scheduler = new DiscordDeliveryScheduler({ runDue }, 1_000);

    scheduler.start();
    scheduler.start();

    await vi.advanceTimersByTimeAsync(0);
    expect(runDue).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(runDue).toHaveBeenCalledTimes(2);

    scheduler.stop();
  });

  it("stops the interval and tolerates a second stop", async () => {
    const runDue = vi.fn().mockResolvedValue({});
    const scheduler = new DiscordDeliveryScheduler({ runDue }, 1_000);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.stop();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(runDue).toHaveBeenCalledTimes(1);
  });

  it("uses the default interval and kicks without waiting", async () => {
    const runDue = vi.fn().mockResolvedValue({});
    const scheduler = new DiscordDeliveryScheduler({ runDue });

    scheduler.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(runDue).toHaveBeenCalledTimes(1);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(runDue).toHaveBeenCalledTimes(3);

    scheduler.stop();
  });
});
