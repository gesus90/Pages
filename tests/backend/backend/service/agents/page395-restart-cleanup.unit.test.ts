import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { endRestartLease } from "@/backend/service/agents/resources/AcpRestartLease";
import { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import { AgentPlanRecoveryActions } from "@/backend/service/agents/recovery/AgentPlanRecoveryActions";
import { AgentPlanRecoveryExecutionRepository } from "@/backend/database/repositories/agent/AgentPlanRecoveryExecutionRepository";
import { retryRestartCleanup } from "@/backend/service/agents/recovery/AgentPlanRestartCleanup";
import { planRecoveryFailure } from "@/app/lib/agent-plan-recovery-response.server";
import { recoveryFixture } from "./page84-recovery-fixture";

import type { AcpResourceRecord } from "@/definition/AcpResource";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { DatabaseTransaction } from "@/backend/database/Database";
import type { RecoveryActionDependencies } from "@/backend/service/agents/recovery/AgentPlanRecoveryActions";

const host = vi.hoisted(() => ({
  unit: vi.fn(async () => 0),
  namespace: vi.fn(async () => true),
  local: vi.fn(async () => true),
  scan: vi.fn(async () => []),
  scope: vi.fn(async () => ({ earliestStart: 0 })),
}));
vi.mock("@/backend/agents/cli/CliWorkerUnit", () => ({
  settleRecordedWorkerUnit: host.unit,
}));
vi.mock("@/backend/agents/cli/CliOwnedNamespace", () => ({
  settleOwnedNamespace: host.namespace,
  forceOwnedNamespace: host.namespace,
}));
vi.mock("@/backend/agents/local/LocalOwnerControl", () => ({
  settleManagedLocalOwner: host.local,
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  readScopeSince: host.scope,
  findTaggedProcesses: host.scan,
  endTaggedProcesses: vi.fn(async () => ({ remaining: 0 })),
}));

const NOW = Date.parse("2026-11-14T12:00:00Z");
const LEASE: AcpResourceRecord = {
  instanceId: "owned-instance",
  userId: "owner",
  provider: "codex_cli",
  runId: "run",
  stepId: "a",
  state: "cleanup_failed",
  since: new Date(NOW - 16 * 60_000).toISOString(),
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  host.unit.mockResolvedValue(0);
});
afterEach(() => vi.useRealTimers());

it("stops and checks a recorded worker unit even when the lease also has a namespace", async () => {
  const record = {
    ...LEASE,
    workerUnit: "pages-acp-owned-instance-12345678.service",
    namespace: { pid: 42, uid: 1000, start: 1, boot: "boot" },
  };
  await endRestartLease(record);
  expect(host.unit).toHaveBeenCalledExactlyOnceWith(
    record.instanceId,
    record.workerUnit,
  );
  expect(host.namespace).toHaveBeenCalledTimes(1);
  host.unit.mockResolvedValue(1);
  await expect(endRestartLease(record)).rejects.toMatchObject({
    code: "cleanup_unconfirmed",
    cleanupFailure: { stepId: "a", reason: "worker_unit_active" },
  });
  expect(host.namespace).toHaveBeenCalledTimes(1);
});

it("quarantines legacy leases for more than fifteen minutes and rejects invalid dates", async () => {
  await expect(endRestartLease(LEASE)).resolves.toBeUndefined();
  for (const since of [
    new Date(NOW - 15 * 60_000).toISOString(),
    new Date(NOW).toISOString(),
    "invalid",
  ]) {
    await expect(endRestartLease({ ...LEASE, since })).rejects.toMatchObject({
      cleanupFailure: { reason: "lease_too_recent" },
    });
  }
  expect(host.unit).not.toHaveBeenCalled();
});

it("keeps reservations until every lease boundary is proven, then releases exactly the old run", async () => {
  const records = new Map([
    [LEASE.instanceId, LEASE],
    ["other", { ...LEASE, instanceId: "other", runId: "other-run" }],
  ]);
  const scheduler = new AcpResourceScheduler({
    store: {
      list: async () => [...records.values()],
      save: async (record) => {
        records.set(record.instanceId, record);
      },
      remove: async (id) => {
        records.delete(id);
      },
    },
    memory: async () => 4096,
  });
  const proven = await scheduler.prepareRestart("run");
  expect(records.size).toBe(2);
  await scheduler.releaseRestart("run", proven, async () => {
    records.delete(LEASE.instanceId);
  });
  expect([...records.keys()]).toEqual(["other"]);
});

async function restartWorld(
  status: AgentPlanRun["status"] = "failed",
): Promise<{
  actions: AgentPlanRecoveryActions;
  dependencies: RecoveryActionDependencies;
  run: AgentPlanRun;
  order: string[];
  start: ReturnType<typeof vi.fn>;
}> {
  const fixture = await recoveryFixture();
  const run: AgentPlanRun = {
    ...fixture.failed,
    status,
    stopRequested: true,
    steps: fixture.failed.steps.map((step) =>
      step.session
        ? { ...step, session: { ...step.session, closeout: "failed" } }
        : step,
    ),
  };
  const order: string[] = [];
  const transaction: DatabaseTransaction = {
    query: vi.fn(async () => []),
    execute: vi.fn(async () => undefined),
  };
  const executions = new AgentPlanRecoveryExecutionRepository({
    query: vi.fn(async () => []),
    transaction: async (work) => work(transaction),
  });
  vi.spyOn(executions, "source").mockResolvedValue({
    run,
    revision: 0,
    snapshot: fixture.snapshot,
  });
  vi.spyOn(executions, "list").mockResolvedValue([]);
  vi.spyOn(executions, "replay").mockResolvedValue(null);
  vi.spyOn(executions, "retireForRestart").mockImplementation(async () => {
    order.push("retire");
  });
  const start = vi.fn(async () => {
    order.push("start");
    return { ...fixture.initial, id: "new-run" };
  });
  const dependencies: RecoveryActionDependencies = {
    runs: { run: async () => run },
    access: {
      require: async () => ({
        ...fixture.snapshot.plan,
        canEdit: true,
        projectName: "Synthetic",
        github: null,
      }),
    },
    preparation: {
      prepare: async () => {
        order.push("prepare");
        return fixture.snapshot;
      },
    },
    engine: { isActive: () => false, startRecovered: start },
    planRuns: {
      latest: async () => run,
      hasReservation: async () => true,
      release: vi.fn(),
    },
    executions,
    checkpoints: { list: async () => [], append: vi.fn() },
    restartOwners: { localOwners: async () => ["owned-instance"] },
    resources: {
      prepareRestart: async () => {
        order.push("processes");
        return new Set(["owned-instance"]);
      },
      releaseRestart: async (runId, proven, retire) => {
        if (runId && proven.size > 0) order.push("leases");
        await retire();
      },
      reconcile: async () => 0,
      snapshot: vi.fn(),
    },
  };
  return {
    actions: new AgentPlanRecoveryActions(dependencies),
    dependencies,
    run,
    order,
    start,
  };
}

it.each(["failed", "cancelled", "stopping"] as const)(
  "cleans a %s predecessor before preparing and starting the new run",
  async (status) => {
    const world = await restartWorld(status);
    const result = await world.actions.restart({
      userId: world.run.userId,
      runId: world.run.id,
      requestDigest: "digest",
      command: {
        action: "restart",
        expectedRevision: 0,
        revision: world.run.planRevision,
        idempotencyKey: "restart-395",
        confirmRepeat: true,
      },
    });
    expect(result).toMatchObject({ outcome: "started", runId: "new-run" });
    expect(world.order).toEqual([
      "processes",
      "leases",
      "retire",
      "prepare",
      "start",
    ]);
    expect(host.scan).not.toHaveBeenCalled();
  },
);

it("tries a failing cleanup three times, starts nothing and returns step and bounded code", async () => {
  const world = await restartWorld();
  const failure = new Error("Private subprocess detail");
  const fail = vi
    .spyOn(world.dependencies.executions, "retireForRestart")
    .mockRejectedValue(failure);
  let error: unknown;
  try {
    await world.actions.restart({
      userId: world.run.userId,
      runId: world.run.id,
      requestDigest: "digest",
      command: {
        action: "restart",
        expectedRevision: 0,
        revision: world.run.planRevision,
        idempotencyKey: "restart-395",
        confirmRepeat: true,
      },
    });
  } catch (caught: unknown) {
    error = caught;
  }
  expect(fail).toHaveBeenCalledTimes(3);
  expect(world.start).not.toHaveBeenCalled();
  expect(world.order).not.toContain("prepare");
  const response = planRecoveryFailure(error);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: "cleanup_unconfirmed",
    cleanupFailure: {
      stepId: "release_and_retire",
      reason: "resource_cleanup_failed",
    },
  });
});

it("advances after a transient failure only when the phase succeeds within three attempts", async () => {
  const work = vi
    .fn()
    .mockRejectedValueOnce(new Error("temporary"))
    .mockRejectedValueOnce(new Error("temporary"))
    .mockResolvedValue("confirmed");
  await expect(retryRestartCleanup("leases", work)).resolves.toBe("confirmed");
  expect(work).toHaveBeenCalledTimes(3);
});

it("preserves unknown loop session evidence when other leases of the run were proven ended", async () => {
  const fixture = await recoveryFixture();
  const loop = {
    id: "loop",
    name: "Loop",
    status: "failed" as const,
    count: null,
    sessionPolicy: "reuse" as const,
    condition: null,
    iterations: [],
    completion: null,
    cleanup: "failed" as const,
    startedAt: fixture.failed.startedAt,
    endedAt: null,
    error: "cleanup",
    sessions: [
      {
        nodeId: "member",
        key: "loop/member",
        policy: "reuse" as const,
        state: "lost" as const,
        createdInIteration: 1,
        turns: 1,
        instanceId: null,
        acpSessionId: null,
        nativeSessionId: null,
        closeout: "failed" as const,
      },
    ],
  };
  const { withoutProvenRestartSessions } =
    await import("@/backend/service/agents/recovery/AgentPlanRestartEvidence");
  const { hasUnconfirmedLoopCloseout } =
    await import("@/definition/AgentPlanLoopResults");
  const checked = withoutProvenRestartSessions(
    { ...fixture.failed, loops: [loop] },
    new Set(["owned-instance"]),
  );
  expect(hasUnconfirmedLoopCloseout(checked)).toBe(true);
  expect(checked.loops?.[0]?.sessions).toHaveLength(1);
});

it("reuses durable cleanup of the exact old view when preparation had failed after cleanup", async () => {
  const world = await restartWorld();
  vi.spyOn(world.dependencies.executions, "hasRestartProof").mockResolvedValue(
    true,
  );
  if (!world.dependencies.resources || !world.dependencies.restartOwners)
    throw new Error("Missing restart fixture");
  vi.spyOn(world.dependencies.resources, "prepareRestart").mockResolvedValue(
    new Set(),
  );
  vi.spyOn(world.dependencies.restartOwners, "localOwners").mockResolvedValue(
    [],
  );
  await expect(
    world.actions.restart({
      userId: world.run.userId,
      runId: world.run.id,
      requestDigest: "digest",
      command: {
        action: "restart",
        expectedRevision: 0,
        revision: world.run.planRevision,
        idempotencyKey: "retry-after-prepare",
        confirmRepeat: true,
      },
    }),
  ).resolves.toMatchObject({ outcome: "started" });
});

it("retains the durable leases if the atomic retirement transaction fails", async () => {
  const records = new Map([[LEASE.instanceId, LEASE]]);
  const scheduler = new AcpResourceScheduler({
    store: {
      list: async () => [...records.values()],
      save: async (record) => {
        records.set(record.instanceId, record);
      },
      remove: vi.fn(),
    },
    memory: async () => 4096,
  });
  const proven = await scheduler.prepareRestart("run");
  await expect(
    scheduler.releaseRestart("run", proven, async () => {
      throw new Error("Database unavailable");
    }),
  ).rejects.toThrow("Database unavailable");
  expect(records.get(LEASE.instanceId)).toEqual(LEASE);
});
