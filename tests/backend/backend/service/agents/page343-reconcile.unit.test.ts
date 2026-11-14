import { afterEach, expect, it, vi } from "vitest";
import {
  hasRunningWorkerUnit,
  listRunningWorkerUnits,
} from "@/backend/agents/cli/CliWorkerUnit";
import { owner, resourceWorld } from "./page81-resource-fixture";
import type { AcpResourceRecord } from "@/definition/AcpResource";

vi.mock("@/backend/agents/cli/CliWorkerUnit", () => ({
  hasRunningWorkerUnit: vi.fn(async () => false),
  listRunningWorkerUnits: vi.fn(async () => new Set<string>()),
  settleWorkerUnits: vi.fn(async () => 0),
}));

function lease(
  instanceId: string,
  extra: Partial<AcpResourceRecord> = {},
): AcpResourceRecord {
  return {
    ...owner(instanceId),
    runId: null,
    state: "cleanup_failed",
    since: new Date(Date.now() - 16 * 60_000).toISOString(),
    lifecycle: "spawning",
    ...extra,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("releases inactive units and old unbound chats but keeps live units, young entries and runs", async () => {
  const world = resourceWorld();
  const leases = [
    lease("dead", { workerUnit: "dead.service" }),
    lease("live", { workerUnit: "live.service" }),
    lease("old"),
    lease("young", { since: new Date().toISOString() }),
    lease("run", { runId: "run", workerUnit: "run.service" }),
  ];
  leases.forEach((entry) => world.records.set(entry.instanceId, entry));
  vi.mocked(hasRunningWorkerUnit).mockImplementation(
    async (id) => id === "live",
  );
  await world.scheduler.recover(
    [],
    new Set(leases.map((entry) => entry.instanceId)),
  );
  await world.scheduler.reconcile();
  expect([...world.records.keys()].sort()).toEqual(["live", "run", "young"]);
  expect(world.cleanup).not.toHaveBeenCalled();
  await world.scheduler.shutdown();
});

it("reconciles without waiters at startup and again after five minutes", async () => {
  vi.useFakeTimers();
  const world = resourceWorld();
  const record = lease("periodic", { workerUnit: "periodic.service" });
  world.records.set(record.instanceId, record);
  vi.mocked(listRunningWorkerUnits).mockResolvedValue(
    new Set(["pages-acp-periodic-123.service"]),
  );
  vi.mocked(hasRunningWorkerUnit)
    .mockResolvedValueOnce(true)
    .mockResolvedValue(false);
  await world.scheduler.recover([], new Set([record.instanceId]));
  await vi.advanceTimersByTimeAsync(1);
  expect(world.records.has("periodic")).toBe(true);
  await vi.advanceTimersByTimeAsync(300_000);
  expect(world.records.has("periodic")).toBe(false);
  await world.scheduler.shutdown();
});
