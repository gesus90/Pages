import { afterEach, expect, it, vi } from "vitest";

import { AgentDeferredGarbage } from "@/backend/storage/AgentDeferredGarbage";
import { purgeEarlierPlanRuns } from "@/backend/database/repositories/agent/AgentPlanRunPurge";

import type { GarbageDatabase } from "@/backend/storage/AgentDeferredGarbage";

vi.mock("@/backend/database/repositories/agent/AgentPlanRunPurge", () => ({
  PLAN_RUN_PURGE_PREFIX: "plan-runs/",
  purgeEarlierPlanRuns: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
  captureLogContext: () => ({}),
  withLogContext: (context: unknown, work: () => unknown) => work(),
}));

afterEach(() => vi.useRealTimers());

it("does not enqueue another collection from the purge's own transaction commits", async () => {
  const collector = new AgentDeferredGarbage({
    directory: "/synthetic",
    removePayload: vi.fn(),
  });
  const query = vi
    .fn()
    .mockResolvedValueOnce([["future/intent"]])
    .mockResolvedValue([]);
  const database: GarbageDatabase = {
    query,
    execute: vi.fn(async () => collector.schedule(database)),
    transaction: async (work) => work(database),
  };
  collector.schedule(database);
  await collector.idle();
  expect(query).toHaveBeenCalledTimes(2);
  expect(database.execute).toHaveBeenCalledTimes(1);
  await collector.close();
});

it("retains protected runs without writes and waits a minute before another attempt", async () => {
  vi.useFakeTimers();
  const collector = new AgentDeferredGarbage({
    directory: "/synthetic",
    removePayload: vi.fn(),
  });
  const query = vi
    .fn()
    .mockImplementation(
      async (statement: string, parameters: { after: string }) =>
        parameters.after === ""
          ? [["plan-runs/12345678-1234-1234-1234-123456789abc"]]
          : [],
    );
  const database: GarbageDatabase = {
    query,
    execute: vi.fn(),
    transaction: async (work) => work(database),
  };
  vi.mocked(purgeEarlierPlanRuns).mockResolvedValue(false);
  collector.schedule(database);
  await collector.idle();
  for (let attempt = 0; attempt < 100; attempt += 1)
    collector.schedule(database);
  await collector.idle();
  expect(purgeEarlierPlanRuns).toHaveBeenCalledTimes(1);
  expect(database.execute).not.toHaveBeenCalled();
  vi.advanceTimersByTime(60_000);
  collector.schedule(database);
  await collector.idle();
  expect(purgeEarlierPlanRuns).toHaveBeenCalledTimes(2);
  await collector.close();
});
