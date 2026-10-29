import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import {
  AgentToolPreflightError,
  AgentToolReadinessError,
} from "@/backend/service/agents/tools/AgentToolReadinessError";

import { owner } from "./page81-resource-fixture";

import type { AcpResourceRecord } from "@/definition/AcpResource";

const scan = vi.hoisted(() => ({
  endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
  readScopeSince: vi.fn(async () => ({ earliestStart: 4_920_872 })),
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => scan);

/** A lease the closeout of a Pica job left behind, as the live test found it (PAGE-68). */
const LEASE: AcpResourceRecord = {
  instanceId: "4563754b-9a27-4945-8e1b-1cbdc65a1707",
  userId: "owner",
  provider: "codex_cli",
  runId: null,
  stepId: null,
  state: "cleanup_failed",
  since: "2026-10-16T09:42:34.000Z",
};

/** The scheduler with its own process cleanup and a durable store in memory. */
function schedulerWith(records: readonly AcpResourceRecord[]): {
  readonly scheduler: AcpResourceScheduler;
  readonly stored: Map<string, AcpResourceRecord>;
} {
  const stored = new Map(
    records.map((record) => [record.instanceId, record] as const),
  );
  const scheduler = new AcpResourceScheduler({
    store: {
      list: async () => [...stored.values()],
      save: async (record) => {
        stored.set(record.instanceId, record);
      },
      remove: async (instanceId) => {
        stored.delete(instanceId);
      },
    },
    options: { maxConcurrentAcpSessions: 1 },
    memory: async () => 4096,
  });
  return { scheduler, stored };
}

beforeEach(() => {
  scan.endTaggedProcesses
    .mockReset()
    .mockResolvedValue({ found: 0, remaining: 0 });
  scan.readScopeSince.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

it("releases a recovered lease once the scan since its recorded start finds no process", async () => {
  const { scheduler, stored } = schedulerWith([LEASE]);
  await scheduler.recover();
  expect(scan.readScopeSince).toHaveBeenCalledExactlyOnceWith(LEASE.since);
  expect(scan.endTaggedProcesses).toHaveBeenCalledExactlyOnceWith(
    LEASE.instanceId,
    { earliestStart: 4_920_872 },
  );
  expect(stored.size).toBe(0);
  expect(scheduler.snapshot().active).toEqual([]);
  await scheduler.shutdown();
});

it("keeps a lease whose start cannot be related to the uptime", async () => {
  scan.readScopeSince.mockRejectedValueOnce(
    new Error("Unreadable system uptime"),
  );
  const { scheduler, stored } = schedulerWith([LEASE]);
  await scheduler.recover();
  expect(scan.endTaggedProcesses).not.toHaveBeenCalled();
  expect(stored.get(LEASE.instanceId)?.state).toBe("cleanup_failed");
  await scheduler.shutdown();
});

it("scans an adopted lease without a start, so no unreadable process is ruled out", async () => {
  const { scheduler, stored } = schedulerWith([]);
  await scheduler.recover([owner("legacy")]);
  expect(scan.readScopeSince).not.toHaveBeenCalled();
  expect(scan.endTaggedProcesses).toHaveBeenCalledExactlyOnceWith(
    "legacy",
    null,
  );
  expect(stored.size).toBe(0);
  await scheduler.shutdown();
});

it("releases a preflight refusal without scanning unrelated processes", async () => {
  const { scheduler, stored } = schedulerWith([]);
  await scheduler.recover();
  const failure = new AgentToolPreflightError(
    new AgentToolReadinessError("node", "unsupported", "not_installed"),
  );
  await expect(
    scheduler.open(owner("preflight"), new AbortController().signal, () =>
      Promise.reject(failure),
    ),
  ).rejects.toBe(failure);
  expect(scan.endTaggedProcesses).not.toHaveBeenCalled();
  expect(stored.size).toBe(0);
  await scheduler.shutdown();
});
