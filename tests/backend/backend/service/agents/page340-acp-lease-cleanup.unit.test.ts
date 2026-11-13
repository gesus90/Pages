import { beforeEach, expect, it, vi } from "vitest";

import { listRunningWorkerUnits } from "@/backend/agents/cli/CliWorkerUnit";
import { readJournaledWorkerUnitEnds } from "@/backend/agents/cli/CliWorkerUnitJournal";
import { readScopeSince } from "@/backend/agents/cli/CliProcessScan";
import { AcpLeaseCleanup } from "@/backend/service/agents/resources/AcpLeaseCleanup";

import {
  deferred,
  nativeSession,
  owner,
  resourceWorld,
} from "./page81-resource-fixture";

import type {
  AcpLeaseCleanupEvidence,
  AcpLeaseCleanupHost,
} from "@/backend/service/agents/resources/AcpLeaseCleanup";
import type { AcpResourceRecord } from "@/definition/AcpResource";

// The host boundaries the cleanup reads: service manager, journal and uptime.
vi.mock("@/backend/agents/cli/CliWorkerUnit", () => ({
  listRunningWorkerUnits: vi.fn(),
  stopWorkerUnits: vi.fn(async () => 0),
  hasRunningWorkerUnit: vi.fn(async () => false),
}));
vi.mock("@/backend/agents/cli/CliWorkerUnitJournal", () => ({
  readJournaledWorkerUnitEnds: vi.fn(),
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  readScopeSince: vi.fn(),
  endTaggedProcesses: vi.fn(async () => {
    throw new Error("Process ownership is unverified for legacy session");
  }),
}));

const SINCE = "2026-11-12T13:00:00.000Z";

/** A chat lease as the live system left it: spawning, no identity, unconfirmed. */
function leftover(instanceId: string): AcpResourceRecord {
  return {
    ...owner(instanceId),
    runId: null,
    stepId: null,
    state: "cleanup_failed",
    since: SINCE,
    lifecycle: "spawning",
  };
}

async function recoveredWorld(
  leases: readonly AcpResourceRecord[],
): Promise<ReturnType<typeof resourceWorld>> {
  const world = resourceWorld({ maxConcurrentAcpSessions: 0 });
  for (const lease of leases) world.records.set(lease.instanceId, lease);
  // An earlier startup could not confirm their cleanup, so recovery keeps them.
  await world.scheduler.recover(
    [],
    new Set(leases.map((lease) => lease.instanceId)),
  );
  return world;
}

beforeEach(() => {
  vi.mocked(listRunningWorkerUnits).mockReset().mockResolvedValue(new Set());
  vi.mocked(readJournaledWorkerUnitEnds)
    .mockReset()
    .mockResolvedValue(new Map([["ended", true]]));
  // Same boot: the leases started after it, so the boot proves nothing.
  vi.mocked(readScopeSince).mockReset().mockResolvedValue({ earliestStart: 0 });
});

it("previews without changes and classifies each reservation with its reason", async () => {
  const world = await recoveredWorld([
    leftover("ended"),
    leftover("unproven"),
    leftover("unit-running"),
  ]);
  vi.mocked(listRunningWorkerUnits).mockResolvedValue(
    new Set(["pages-acp-unit-running-0123abcd.service"]),
  );

  const report = await world.scheduler.leaseCleanup.preview();

  expect(report.mode).toBe("preview");
  expect(report.counts).toEqual({
    releasable: 1,
    released: 0,
    kept_active: 1,
    kept_unproven: 1,
    check_failed: 0,
  });
  expect(
    report.entries.map((entry) => [entry.instanceId, entry.reason]),
  ).toEqual([
    ["ended", "unit_ended"],
    ["unit-running", "unit_active"],
    ["unproven", "start_unconfirmed"],
  ]);
  expect(world.records.size).toBe(3);
  expect(world.store.remove).not.toHaveBeenCalled();
});

it("releases only confirmed, still proven reservations and is idempotent", async () => {
  const world = await recoveredWorld([leftover("ended"), leftover("unproven")]);
  vi.mocked(readJournaledWorkerUnitEnds).mockResolvedValue(
    new Map([
      ["ended", true],
      ["unproven", false],
    ]),
  );

  const first = await world.scheduler.leaseCleanup.cleanup(
    new Set(["ended", "unproven"]),
  );

  expect(first.counts.released).toBe(1);
  expect(first.counts.kept_unproven).toBe(1);
  expect([...world.records.keys()]).toEqual(["unproven"]);
  expect(world.scheduler.snapshot().active).toHaveLength(1);
  const second = await world.scheduler.leaseCleanup.cleanup(
    new Set(["ended", "unproven"]),
  );
  expect(second.counts.released).toBe(0);
  expect(second.entries.map((entry) => entry.instanceId)).toEqual(["unproven"]);
  expect([...world.records.keys()]).toEqual(["unproven"]);
});

it("keeps a releasable reservation that was not confirmed in the preview", async () => {
  const world = await recoveredWorld([leftover("ended")]);

  const report = await world.scheduler.leaseCleanup.cleanup(new Set());

  expect(report.counts.released).toBe(0);
  expect(report.entries[0]?.category).toBe("releasable");
  expect(world.records.has("ended")).toBe(true);
});

it("keeps a reservation whose unit started between preview and confirmation", async () => {
  const world = await recoveredWorld([leftover("ended")]);
  vi.mocked(listRunningWorkerUnits)
    .mockResolvedValueOnce(new Set())
    .mockResolvedValue(new Set(["pages-acp-ended-0123abcd.service"]));

  const report = await world.scheduler.leaseCleanup.cleanup(new Set(["ended"]));

  expect(report.entries[0]).toMatchObject({
    category: "kept_active",
    reason: "unit_active",
  });
  expect(world.scheduler.snapshot().active[0]?.check?.reason).toBe(
    "unit_active",
  );
  expect(world.records.has("ended")).toBe(true);
});

it("keeps every reservation when the service manager cannot be read", async () => {
  const world = await recoveredWorld([leftover("ended")]);
  vi.mocked(listRunningWorkerUnits).mockRejectedValue(new Error("no bus"));

  const report = await world.scheduler.leaseCleanup.cleanup(new Set(["ended"]));

  expect(report.counts.released).toBe(0);
  expect(report.entries[0]?.reason).toBe("start_unconfirmed");
  expect(readJournaledWorkerUnitEnds).not.toHaveBeenCalled();
  expect(world.records.has("ended")).toBe(true);
});

it("never checks or releases a running or starting session", async () => {
  const world = await recoveredWorld([]);
  const signal = new AbortController().signal;
  await world.scheduler.open(owner("live"), signal, async () =>
    nativeSession(),
  );
  const pending = deferred<ReturnType<typeof nativeSession>>();
  const starting = world.scheduler.open(
    owner("starting"),
    signal,
    () => pending.promise,
  );
  await vi.waitFor(() => expect(world.records.has("starting")).toBe(true));

  const report = await world.scheduler.leaseCleanup.cleanup(
    new Set(["live", "starting"]),
  );

  expect(
    report.entries.map((entry) => [entry.instanceId, entry.reason]),
  ).toEqual(
    expect.arrayContaining([
      ["live", "session_open"],
      ["starting", "start_in_progress"],
    ]),
  );
  expect(report.counts.kept_active).toBe(2);
  expect(world.records.size).toBe(2);
  expect(readJournaledWorkerUnitEnds).not.toHaveBeenCalledWith(
    expect.objectContaining({ instanceId: "live" }),
  );
  pending.resolve(nativeSession());
  await starting;
});

it("releases a failed start whose own closeout confirmed its frame ended", async () => {
  const world = await recoveredWorld([]);
  const signal = new AbortController().signal;

  await expect(
    world.scheduler.open(
      owner("failed"),
      signal,
      async (admitted, lifecycle) => {
        lifecycle.trackSpawn();
        await lifecycle.beforeSpawn();
        lifecycle.confirmStartEnded();
        throw new Error("adapter exited before session/new");
      },
    ),
  ).rejects.toThrow("adapter exited");

  expect(world.records.has("failed")).toBe(false);
  expect(world.cleanup).not.toHaveBeenCalled();
});

it("keeps a failed start after its spawn when nothing confirmed its end", async () => {
  const world = await recoveredWorld([]);
  world.cleanup.mockRejectedValue(new Error("ownership unverified"));
  const signal = new AbortController().signal;

  await expect(
    world.scheduler.open(
      owner("failed"),
      signal,
      async (admitted, lifecycle) => {
        lifecycle.trackSpawn();
        await lifecycle.beforeSpawn();
        throw new Error("adapter exited before session/new");
      },
    ),
  ).rejects.toThrow("adapter exited");

  expect(world.records.get("failed")?.state).toBe("cleanup_failed");
});

/** A host of the chat service with the given own leases and store. */
function chatHost(
  own: readonly AcpResourceRecord[],
  stored: readonly AcpResourceRecord[],
  pausedRuns: ReadonlySet<string> = new Set(),
): AcpLeaseCleanupHost & {
  readonly releaseUncertain: ReturnType<typeof vi.fn>;
} {
  const releaseUncertain = vi.fn(async () => "released" as const);
  return {
    store: {
      list: vi.fn(async () => stored),
      save: vi.fn(),
      remove: vi.fn(),
      releaseUncertain,
    },
    scope: "chat",
    active: new Map(own.map((record) => [record.instanceId, record])),
    sessions: new Map(),
    pausedRuns,
    isOpening: () => false,
    isUnverifiedLocal: () => false,
    owns: (record) => record.runId === null,
    persist: (task) => task(),
    wake: vi.fn(),
    releaseUncertain,
  };
}

function evidence(
  classify: AcpLeaseCleanupEvidence["classify"],
): AcpLeaseCleanupEvidence {
  return {
    units: vi.fn(async () => new Set<string>()),
    journal: vi.fn(async () => new Map()),
    classify,
  };
}

it("leaves the leases of another service and of paused runs unchecked", async () => {
  const plan = { ...leftover("plan"), runId: "run-plan" };
  const paused = { ...leftover("paused"), runId: "run-paused" };
  const host = chatHost([paused], [plan, paused], new Set(["run-paused"]));
  const classify = vi.fn<AcpLeaseCleanupEvidence["classify"]>();
  const owns = vi.fn(
    (record: AcpResourceRecord) => record.instanceId !== "plan",
  );

  const report = await new AcpLeaseCleanup(
    { ...host, owns },
    evidence(classify),
  ).cleanup(new Set(["plan", "paused"]));

  expect(
    report.entries.map((entry) => [
      entry.instanceId,
      entry.category,
      entry.reason,
    ]),
  ).toEqual([
    ["paused", "kept_active", "run_paused"],
    ["plan", "kept_unproven", "other_service"],
  ]);
  expect(classify).not.toHaveBeenCalled();
  expect(host.releaseUncertain).not.toHaveBeenCalled();
});

it("reports an unreadable check as failed and keeps the lease", async () => {
  const lease = leftover("unreadable");
  const host = chatHost([lease], [lease]);

  const report = await new AcpLeaseCleanup(
    host,
    evidence(async () => {
      throw new Error("/proc unreadable");
    }),
  ).cleanup(new Set(["unreadable"]));

  expect(report.entries[0]).toMatchObject({
    category: "check_failed",
    reason: "check_failed",
  });
  expect(host.releaseUncertain).not.toHaveBeenCalled();
});

it("does not report a release the stored state contradicts", async () => {
  const lease = leftover("contested");
  const host = chatHost([lease], [lease]);

  const report = await new AcpLeaseCleanup(
    host,
    evidence(async () => "previous_boot"),
  ).cleanup(new Set(["contested"]));

  // The store still lists the lease after the guarded delete.
  expect(report.entries[0]).toMatchObject({
    category: "kept_active",
    reason: "lease_changed",
  });
  expect(report.counts.released).toBe(0);
});

it("keeps a lease the guarded delete found changed", async () => {
  const lease = leftover("changed");
  const host = chatHost([lease], [lease]);
  host.releaseUncertain.mockResolvedValue("changed");

  const report = await new AcpLeaseCleanup(
    host,
    evidence(async () => "namespace_ended"),
  ).cleanup(new Set(["changed"]));

  expect(report.entries[0]?.reason).toBe("lease_changed");
  expect(host.active.has("changed")).toBe(true);
});
