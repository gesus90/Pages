import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { releasePlanRun } from "@/backend/service/agents/AgentPlanRecoveryOperation";

import { nativeSession, owner, resourceWorld } from "./page81-resource-fixture";
import { recoveryFixture } from "./page84-recovery-fixture";
import { recoveryWorld } from "./page171-recovery-world";

import type * as Logger from "@/backend/logging/Logger";

const boundaries = vi.hoisted(() => ({
  settleOwner: vi.fn<(instanceId: string) => Promise<boolean | null>>(),
  logEvent: vi.fn<typeof Logger.logEvent>(),
}));

vi.mock("@/backend/agents/local/LocalOwnerControl", () => ({
  settleManagedLocalOwner: boundaries.settleOwner,
  inspectManagedLocalOwner: () => "owned",
}));
vi.mock("@/backend/agents/cli/CliOwnedNamespace", () => ({
  settleOwnedNamespace: async (namespace: unknown, instanceId: string) => (await boundaries.settleOwner(instanceId)) === true,
}));
vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  readScopeSince: vi.fn(async () => ({ earliestStart: 0 })),
  findTaggedProcesses: vi.fn(async () => []),
  endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
}));
vi.mock("@/backend/logging/Logger", async (importOriginal) => ({
  ...(await importOriginal<typeof Logger>()),
  logCaughtError: vi.fn(),
  logEvent: boundaries.logEvent,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T12:00:00.000Z"));
  boundaries.settleOwner.mockReset().mockResolvedValue(false);
  boundaries.logEvent.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Process ownership is a controlled boundary; the recovery command and lease journal are real units. */
async function recoveryWithUnverifiedOwner(): Promise<{
  readonly resources: ReturnType<typeof resourceWorld>;
  readonly world: ReturnType<typeof recoveryWorld>;
  readonly input: {
    readonly operationId: string;
    readonly planId: string;
    readonly runId: string;
    readonly expectedRecoveryRevision: number;
  };
  readonly instanceId: string;
  readonly userId: string;
}> {
  const fixture = await recoveryFixture();
  const previous = fixture.failed;
  const session = previous.steps.find((step) => step.id === "a")?.session;
  if (!session) throw new Error("Synthetic accepted session is missing");
  const run = {
    ...previous,
    steps: previous.steps.map((step) => step.id === "a" ? {
      ...step,
      error: "plan_closeout_failed",
      session: { ...session, closeout: "failed" as const, namespace: { pid: 42, uid: 1000, start: 12, boot: "11111111-1111-4111-8111-111111111111" } },
    } : step),
  };
  const resources = resourceWorld();
  resources.records.set(session.instanceId, {
    ...owner(session.instanceId),
    runId: run.id,
    stepId: "a",
    state: "cleanup_failed",
    lifecycle: "process",
    since: run.startedAt,
  });
  await resources.scheduler.recover(
    [],
    new Set(),
    new Set(),
    new Set([session.instanceId]),
  );
  const world = recoveryWorld(fixture, run, { resources: resources.scheduler });
  return {
    resources,
    world,
    input: {
      operationId: "page333-release",
      planId: run.planId,
      runId: run.id,
      expectedRecoveryRevision: 0,
    },
    instanceId: session.instanceId,
    userId: run.userId,
  };
}

it("rechecks a previously unverified owner, releases its lease and workspace, and admits one waiting successor", async () => {
  const { resources, world, input, instanceId, userId } =
    await recoveryWithUnverifiedOwner();
  const start = vi.fn(async () => nativeSession());
  const controller = new AbortController();
  const pending = resources.scheduler.open(
    owner("successor"),
    controller.signal,
    start,
  );
  const settled = pending.catch((error: unknown) => error);
  const original = world.database.run(input.runId);
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(start).not.toHaveBeenCalled();
    expect(resources.scheduler.snapshot().waiting).toMatchObject([
      { reason: "capacity" },
    ]);
    // Only the ownership boundary may confirm that the unit and its recorded process ended.
    boundaries.settleOwner.mockResolvedValue(true);
    await expect(releasePlanRun(world, userId, input)).resolves.toMatchObject({
      outcome: "released",
    });
    expect(boundaries.settleOwner).toHaveBeenCalledWith(instanceId);
    expect(resources.records.has(instanceId)).toBe(false);
    expect([...world.database.stored().locks.values()]).not.toContain(
      input.runId,
    );
    expect(world.database.run(input.runId).steps).toEqual(original.steps);
    expect(world.start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(start).toHaveBeenCalledOnce();
    await (await pending).close();
  } finally {
    controller.abort();
    await settled;
    await resources.scheduler.shutdown();
  }
});

it.each(["alive", "unknown", "denied"] as const)(
  "retains the unverified owner's lease and workspace when ownership is %s",
  async (proof) => {
    const { resources, world, input, instanceId, userId } =
      await recoveryWithUnverifiedOwner();
    if (proof === "denied")
      boundaries.settleOwner.mockRejectedValue(
        new Error("Proof is unreadable"),
      );
    else
      boundaries.settleOwner.mockResolvedValue(
        proof === "alive" ? false : null,
      );
    const original = world.database.run(input.runId);
    try {
      await expect(releasePlanRun(world, userId, input)).rejects.toMatchObject({
        code: "cleanup_unconfirmed",
      });
      expect(resources.records.get(instanceId)?.state).toBe("cleanup_failed");
      expect(resources.store.remove).not.toHaveBeenCalled();
      expect(resources.cleanup).not.toHaveBeenCalled();
      expect(world.database.stored().locks.get("workspace")).toBe(input.runId);
      expect(world.database.run(input.runId)).toEqual(original);
      expect(world.start).not.toHaveBeenCalled();
    } finally {
      await resources.scheduler.shutdown();
    }
  },
);

it("reports the ACP capacity wait reason and logs it for the waiting run", async () => {
  boundaries.settleOwner.mockResolvedValue(null);
  const resources = resourceWorld();
  await resources.scheduler.recover();
  const active = await resources.scheduler.open(
    owner("holder"),
    new AbortController().signal,
    async () => nativeSession(),
  );
  const controller = new AbortController();
  const start = vi.fn(async () => nativeSession());
  const waitingOwner = owner("waiting");
  boundaries.logEvent.mockClear();
  const pending = resources.scheduler.open(
    waitingOwner,
    controller.signal,
    start,
  );
  const settled = pending.catch((error: unknown) => error);
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(resources.scheduler.snapshot().waiting).toMatchObject([
      { ...waitingOwner, reason: "capacity" },
    ]);
    expect(start).not.toHaveBeenCalled();
    const metadata = boundaries.logEvent.mock.calls.map(
      ([entry]) => entry.metadata,
    );
    expect(metadata).toContainEqual(
      expect.objectContaining({
        runId: waitingOwner.runId,
        reason: "capacity",
      }),
    );
  } finally {
    controller.abort();
    expect(await settled).toBeInstanceOf(AgentPlanCancelledError);
    await active.close();
    await resources.scheduler.shutdown();
  }
});
