import { expect, it, vi } from "vitest";

import { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import { classifyLease } from "@/backend/service/agents/resources/AcpLeaseEvidence";

import { closed, completedTurn, deferred } from "./page81-resource-fixture";

import type { PlanSession } from "@/backend/agents/AgentPlanExecution";
import type { AcpStartLifecycle } from "@/backend/service/agents/resources/AcpStartLifecycle";
import type {
  AcpNamespaceOwner,
  AcpResourceOwner,
  AcpResourceRecord,
} from "@/definition/AcpResource";

const UNIT = "pages-acp-chat-1-0a1b2c3d.service";
const IDENTITY: AcpNamespaceOwner = {
  pid: 4242,
  uid: 1000,
  start: 77,
  boot: "01234567-89ab-4def-8123-456789abcdef",
  unit: UNIT,
};

/** The scheduler hands a turn on unread, so its identity is all a test needs. */
function roundInput(): Parameters<NonNullable<PlanSession["next"]>>[0] {
  const input: unknown = { prompt: "round", directory: "/workspace" };
  return input as Parameters<NonNullable<PlanSession["next"]>>[0];
}

function chatOwner(instanceId: string): AcpResourceOwner {
  return {
    instanceId,
    userId: "agent-1",
    provider: "claude_code",
    runId: null,
    stepId: null,
  };
}

interface ChatNative extends PlanSession {
  readonly next: ReturnType<typeof vi.fn<NonNullable<PlanSession["next"]>>>;
  readonly close: ReturnType<typeof vi.fn<PlanSession["close"]>>;
  /** The process ends, as after a kill. */
  readonly kill: () => void;
}

function chatNative(isConfirmed = true): ChatNative {
  const exited = deferred<undefined>();
  return {
    turn: Promise.resolve(completedTurn()),
    terminated: exited.promise.then(() => undefined),
    next: vi.fn(async () => completedTurn()),
    close: vi.fn(async () => closed(isConfirmed)),
    kill: () => exited.resolve(undefined),
  };
}

function world(maxConcurrentAcpSessions = 4): {
  readonly scheduler: AcpResourceScheduler;
  readonly records: Map<string, AcpResourceRecord>;
  readonly settleUnits: ReturnType<
    typeof vi.fn<(instanceId: string) => Promise<number>>
  >;
  readonly cleanup: ReturnType<typeof vi.fn>;
} {
  const records = new Map<string, AcpResourceRecord>();
  const store = {
    list: vi.fn(async () => [...records.values()]),
    save: vi.fn(async (record: AcpResourceRecord) => {
      records.set(record.instanceId, record);
    }),
    remove: vi.fn(async (instanceId: string) => {
      records.delete(instanceId);
    }),
  };
  const settleUnits = vi.fn<(instanceId: string) => Promise<number>>(
    async () => 0,
  );
  const cleanup = vi.fn(async () => {
    throw new Error("Process ownership is unverified");
  });
  const scheduler = new AcpResourceScheduler({
    store,
    options: { maxConcurrentAcpSessions },
    memory: async () => 4096,
    cleanup,
    settleUnits,
  });
  return { scheduler, records, settleUnits, cleanup };
}

/** Starts a chat worker the way the CLI execution does: unit before spawn, identity after. */
function startChat(
  scheduler: AcpResourceScheduler,
  native: PlanSession,
  options: { readonly isIdentified: boolean } = { isIdentified: true },
): (signal: AbortSignal, lifecycle: AcpStartLifecycle) => Promise<PlanSession> {
  return async (signal, lifecycle) => {
    lifecycle.trackSpawn();
    await lifecycle.beforeSpawn(UNIT);
    if (options.isIdentified)
      await scheduler.registerNamespace("chat-1", IDENTITY);
    return native;
  };
}

it("records the unit before the spawn and moves a chat lease to `process` with its identity", async () => {
  const { scheduler, records } = world();
  await scheduler.recover();
  const native = chatNative();
  const session = await scheduler.open(
    chatOwner("chat-1"),
    new AbortController().signal,
    startChat(scheduler, native),
  );
  expect(records.get("chat-1")).toMatchObject({
    lifecycle: "process",
    workerUnit: UNIT,
    namespace: IDENTITY,
    state: "running",
  });
  await session.turn;
  for (let round = 0; round < 9; round += 1)
    await session.next?.(roundInput(), new AbortController().signal, {
      started: () => undefined,
      identified: () => undefined,
    });
  expect(native.next).toHaveBeenCalledTimes(9);
  expect(records.size).toBe(1);
  expect(records.get("chat-1")?.state).toBe("idle");
  await session.close();
  expect(records.size).toBe(0);
  await scheduler.shutdown();
});

it("releases a killed chat at once when its unit is proven inactive", async () => {
  const { scheduler, records, settleUnits } = world();
  await scheduler.recover();
  const native = chatNative(false);
  await scheduler.open(
    chatOwner("chat-1"),
    new AbortController().signal,
    startChat(scheduler, native, { isIdentified: false }),
  );
  native.kill();
  await vi.waitFor(() => expect(records.size).toBe(0));
  expect(settleUnits).toHaveBeenCalledWith("chat-1");
  expect(scheduler.snapshot().active).toEqual([]);
  await scheduler.shutdown();
});

it("keeps the lease of a chat whose unit still runs or cannot be read", async () => {
  const { scheduler, records, settleUnits } = world();
  await scheduler.recover();
  settleUnits.mockResolvedValueOnce(1);
  const living = chatNative(false);
  const first = await scheduler.open(
    chatOwner("chat-1"),
    new AbortController().signal,
    startChat(scheduler, living, { isIdentified: false }),
  );
  await first.close();
  expect(records.get("chat-1")).toMatchObject({
    state: "cleanup_failed",
    lifecycle: "spawning",
    workerUnit: UNIT,
  });
  settleUnits.mockRejectedValueOnce(new Error("manager unreadable"));
  await expect(scheduler.reconcile()).resolves.toBe(1);
  expect(records.get("chat-1")?.state).toBe("cleanup_failed");
  await expect(scheduler.reconcile()).resolves.toBe(0);
  expect(records.size).toBe(0);
  await scheduler.shutdown();
});

it("leaves no `cleanup_failed` lease in `spawning` after a hundred chat rounds", async () => {
  const { scheduler, records } = world(1);
  await scheduler.recover();
  for (let round = 0; round < 100; round += 1) {
    const instanceId = `chat-${round}`;
    const session = await scheduler.open(
      chatOwner(instanceId),
      new AbortController().signal,
      async (signal, lifecycle) => {
        lifecycle.trackSpawn();
        await lifecycle.beforeSpawn(`pages-acp-${instanceId}-0a1b2c3d.service`);
        // The native closeout cannot confirm the end; the recorded unit does.
        return chatNative(false);
      },
    );
    await session.turn;
    await session.close();
  }
  expect([...records.values()]).toEqual([]);
  await scheduler.shutdown();
});

it("releases a chat lease without identity at startup once its unit is gone, and keeps a living one", async () => {
  const { scheduler, records, settleUnits } = world();
  const lease = (instanceId: string): AcpResourceRecord => ({
    ...chatOwner(instanceId),
    state: "cleanup_failed",
    since: new Date().toISOString(),
    lifecycle: "spawning",
    workerUnit: `pages-acp-${instanceId}-0a1b2c3d.service`,
    namespace: null,
  });
  records.set("gone", lease("gone"));
  records.set("alive", lease("alive"));
  settleUnits.mockImplementation(async (instanceId) =>
    instanceId === "alive" ? 1 : 0,
  );
  await scheduler.recover();
  expect([...records.keys()]).toEqual(["alive"]);
  expect(records.get("alive")?.state).toBe("cleanup_failed");
  await scheduler.shutdown();
});

it("lets a start at the instance limit take the place of a resting chat session", async () => {
  const { scheduler } = world(1);
  const reclaim = vi.fn(() => true);
  scheduler.setIdleReclaimer(reclaim);
  await scheduler.recover();
  const resting = await scheduler.open(
    chatOwner("chat-1"),
    new AbortController().signal,
    startChat(scheduler, chatNative()),
  );
  await resting.turn;
  const waiting = scheduler.open(
    chatOwner("chat-2"),
    new AbortController().signal,
    async () => chatNative(),
  );
  await vi.waitFor(() => expect(reclaim).toHaveBeenCalled());
  await resting.close();
  await (await waiting).close();
  await scheduler.shutdown();
});

it("classifies a lease without identity from its recorded unit", async () => {
  const record: AcpResourceRecord = {
    ...chatOwner("chat-9"),
    state: "cleanup_failed",
    since: new Date().toISOString(),
    lifecycle: "spawning",
    workerUnit: "pages-acp-chat-9-0a1b2c3d.service",
  };
  await expect(
    classifyLease(record, { isUnverifiedLocal: false, units: new Set() }),
  ).resolves.toBe("unit_inactive");
  await expect(
    classifyLease(record, {
      isUnverifiedLocal: false,
      units: new Set(["pages-acp-chat-9-0a1b2c3d.service"]),
    }),
  ).resolves.toBe("unit_active");
  await expect(
    classifyLease(record, { isUnverifiedLocal: false, units: null }),
  ).rejects.toThrow("Worker units are unreadable");
});
