import { afterEach, expect, it, vi } from "vitest";

import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import { WikiMaintenanceScheduler } from "./WikiMaintenanceScheduler";

vi.mock("@/backend/logging/LoggedOperation", () => ({
  loggedJob: async (
    component: string,
    operation: string,
    work: () => Promise<unknown>,
  ) => work(),
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("runs at start and at every interval until stopped", async () => {
  vi.useFakeTimers();
  const runMaintenance = vi.fn(async () => {});
  const scheduler = new WikiMaintenanceScheduler({ runMaintenance }, 1000);

  scheduler.start();
  scheduler.start();
  expect(runMaintenance).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(2000);
  expect(runMaintenance).toHaveBeenCalledTimes(3);

  scheduler.stop();
  scheduler.stop();
  await vi.advanceTimersByTimeAsync(2000);
  expect(runMaintenance).toHaveBeenCalledTimes(3);
});

it("uses an hourly default interval", async () => {
  vi.useFakeTimers();
  const runMaintenance = vi.fn(async () => {});
  const scheduler = new WikiMaintenanceScheduler({ runMaintenance });

  scheduler.start();
  await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  scheduler.stop();

  expect(runMaintenance).toHaveBeenCalledTimes(2);
});

it("reports a finished cleanup", async () => {
  const scheduler = new WikiMaintenanceScheduler({
    runMaintenance: async () => {},
  });

  await expect(scheduler.runOnce()).resolves.toBe(true);
});

it("logs a failure and does not throw", async () => {
  const error = new Error("boom");
  const scheduler = new WikiMaintenanceScheduler({
    runMaintenance: async () => {
      throw error;
    },
  });

  await expect(scheduler.runOnce()).resolves.toBe(false);
  expect(logCaughtError).toHaveBeenCalledWith(
    "WikiMaintenanceScheduler",
    error,
  );
  expect(logDiagnostic).toHaveBeenCalledOnce();
});
