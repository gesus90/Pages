import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";

import {
  closed,
  deferred,
  nativeSession,
  owner,
  resourceWorld,
} from "./page81-resource-fixture";

import type {
  PlanSession,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it("constructs the shared scheduler with default 2 and an explicit default source", async () => {
  const world = resourceWorld();
  const scheduler = new AcpResourceScheduler({
    store: world.store,
    memory: world.memory,
  });
  expect(scheduler.snapshot()).toMatchObject({
    options: { maxConcurrentAcpSessions: 2 },
    limitSource: "default",
  });
  await scheduler.shutdown();
  await world.scheduler.shutdown();
});

it("wakes the existing mixed Pica/plan FIFO immediately on 1 to 2 without closing idle sessions", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const native = nativeSession();
  const first = await world.scheduler.open(
    owner("a"),
    new AbortController().signal,
    async () => native,
  );
  await first.turn;
  const order: string[] = [];
  const second = world.scheduler.open(
    { ...owner("pica", "claude_code"), runId: null, stepId: null },
    new AbortController().signal,
    async () => {
      order.push("pica");
      return nativeSession();
    },
  );
  const third = world.scheduler.open(
    owner("plan", "opencode"),
    new AbortController().signal,
    async () => {
      order.push("plan");
      return nativeSession();
    },
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(world.scheduler.snapshot().waiting).toHaveLength(2);
  const before = Date.now();
  world.scheduler.updateMaxConcurrentAcpSessions(2);
  const pica = await second;
  expect(Date.now()).toBe(before);
  expect(order).toEqual(["pica"]);
  expect(native.close).not.toHaveBeenCalled();
  expect(world.scheduler.snapshot()).toMatchObject({
    limitSource: "config",
    options: { maxConcurrentAcpSessions: 2 },
    waiting: [{ instanceId: "plan", reason: "capacity" }],
  });
  await first.close();
  const plan = await third;
  expect(order).toEqual(["pica", "plan"]);
  await pica.close();
  await plan.close();
  await world.scheduler.shutdown();
});

it("reduces 3 to 1 without interrupting running, idle or starting leases and preserves the waiter", async () => {
  const world = resourceWorld({ maxConcurrentAcpSessions: 3 });
  await world.scheduler.recover();
  const runningTurn = deferred<PlanSessionTurn>();
  const runningNative = nativeSession();
  const running = await world.scheduler.open(
    owner("running"),
    new AbortController().signal,
    async () => ({ ...runningNative, turn: runningTurn.promise }),
  );
  const idleNative = nativeSession();
  const idle = await world.scheduler.open(
    owner("idle"),
    new AbortController().signal,
    async () => idleNative,
  );
  await idle.turn;
  const startBoundary = deferred<PlanSession>();
  const starting = world.scheduler.open(
    owner("starting"),
    new AbortController().signal,
    async () => startBoundary.promise,
  );
  const startWaiter = vi.fn(async () => nativeSession());
  const waiting = world.scheduler.open(
    owner("waiting"),
    new AbortController().signal,
    startWaiter,
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(world.scheduler.snapshot().active.map((entry) => entry.state)).toEqual(
    ["running", "idle", "starting"],
  );
  world.scheduler.updateMaxConcurrentAcpSessions(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(runningNative.close).not.toHaveBeenCalled();
  expect(idleNative.close).not.toHaveBeenCalled();
  expect(world.scheduler.snapshot().active).toHaveLength(3);
  await idle.close();
  expect(startWaiter).not.toHaveBeenCalled();
  const startedNative = nativeSession();
  startBoundary.resolve(startedNative);
  const started = await starting;
  await started.turn;
  await running.close();
  expect(startedNative.close).not.toHaveBeenCalled();
  expect(startWaiter).not.toHaveBeenCalled();
  expect(world.scheduler.snapshot().waiting).toMatchObject([
    { instanceId: "waiting", reason: "capacity" },
  ]);
  await started.close();
  await (await waiting).close();
  await world.scheduler.shutdown();
});

it("rechecks a reduced limit after an in-flight memory probe before reserving a new slot", async () => {
  const world = resourceWorld({ maxConcurrentAcpSessions: 2 });
  await world.scheduler.recover();
  const first = await world.scheduler.open(
    owner("a"),
    new AbortController().signal,
    async () => nativeSession(),
  );
  const probe = deferred<number | null>();
  world.memory.mockReturnValueOnce(probe.promise);
  const start = vi.fn(async () => nativeSession());
  const pending = world.scheduler.open(
    owner("b"),
    new AbortController().signal,
    start,
  );
  await vi.advanceTimersByTimeAsync(0);
  world.scheduler.updateMaxConcurrentAcpSessions(1);
  probe.resolve(4096);
  await vi.advanceTimersByTimeAsync(0);
  expect(start).not.toHaveBeenCalled();
  expect(world.scheduler.snapshot().active).toHaveLength(1);
  expect(world.scheduler.snapshot().waiting[0]?.reason).toBe("capacity");
  await first.close();
  await (await pending).close();
  await world.scheduler.shutdown();
});

it.each([null, 1024])(
  "admits more than two at zero while still blocking on RAM %s",
  async (available) => {
    const world = resourceWorld({ maxConcurrentAcpSessions: 0 });
    await world.scheduler.recover();
    const sessions: PlanSession[] = [];
    for (const id of ["a", "b", "c"])
      sessions.push(
        await world.scheduler.open(
          owner(id),
          new AbortController().signal,
          async () => nativeSession(),
        ),
      );
    expect(world.scheduler.snapshot().active).toHaveLength(3);
    world.memory.mockResolvedValue(available);
    const start = vi.fn(async () => nativeSession());
    const pending = world.scheduler.open(
      owner("d"),
      new AbortController().signal,
      start,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(world.scheduler.snapshot().waiting[0]?.reason).toBe(
      available === null ? "memory_unknown" : "memory",
    );
    expect(start).not.toHaveBeenCalled();
    world.memory.mockResolvedValue(2048);
    await vi.advanceTimersByTimeAsync(1000);
    sessions.push(await pending);
    for (const session of sessions) await session.close();
    await world.scheduler.shutdown();
  },
);

it.each([0, 999])(
  "enforces the absolute 999 ceiling at configured limit %s, including recovery leftovers",
  async (limit) => {
    const world = resourceWorld({
      maxConcurrentAcpSessions: limit,
      memoryAwareScheduling: false,
    });
    for (let index = 0; index < 999; index++) {
      const id = `retained-${index}`;
      world.records.set(id, {
        ...owner(id),
        state: "idle",
        since: "2026-10-17",
      });
    }
    world.cleanup.mockResolvedValue({ remaining: 1 });
    await world.scheduler.recover();
    const start = vi.fn(async () => nativeSession());
    const controller = new AbortController();
    const pending = world.scheduler.open(
      owner("next"),
      controller.signal,
      start,
    );
    const rejected = expect(pending).rejects.toBeInstanceOf(
      AgentPlanCancelledError,
    );
    world.scheduler.updateMaxConcurrentAcpSessions(limit);
    await vi.advanceTimersByTimeAsync(0);
    expect(world.scheduler.snapshot().active).toHaveLength(999);
    expect(
      world.scheduler
        .snapshot()
        .active.every((entry) => entry.state === "cleanup_failed"),
    ).toBe(true);
    expect(world.scheduler.snapshot().waiting[0]?.reason).toBe("capacity");
    expect(start).not.toHaveBeenCalled();
    controller.abort();
    await rejected;
    await world.scheduler.shutdown();
  },
);

it("keeps failed cleanup occupied after reducing unlimited mode and admits only the additional slot", async () => {
  const world = resourceWorld({ maxConcurrentAcpSessions: 0 });
  await world.scheduler.recover();
  const native = nativeSession();
  native.close.mockResolvedValue(closed(false));
  const session = await world.scheduler.open(
    owner("failed"),
    new AbortController().signal,
    async () => native,
  );
  await session.turn;
  expect(world.scheduler.snapshot().active[0]?.state).toBe("idle");
  await session.close();
  // The recheck of a waiting request finds the leftover process still there.
  world.cleanup.mockResolvedValue({ remaining: 1 });
  world.scheduler.updateMaxConcurrentAcpSessions(1);
  const start = vi.fn(async () => nativeSession());
  const pending = world.scheduler.open(
    owner("next"),
    new AbortController().signal,
    start,
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(world.scheduler.snapshot()).toMatchObject({
    active: [{ state: "cleanup_failed" }],
    waiting: [{ reason: "capacity" }],
  });
  expect(start).not.toHaveBeenCalled();
  world.scheduler.updateMaxConcurrentAcpSessions(2);
  const next = await pending;
  expect(world.scheduler.snapshot().active).toHaveLength(2);
  await next.close();
  expect(world.scheduler.snapshot().active).toHaveLength(1);
  await world.scheduler.shutdown();
});

it("preserves paused FIFO entries, cancellation and shutdown after increasing to unlimited", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const first = await world.scheduler.open(
    owner("first"),
    new AbortController().signal,
    async () => nativeSession(),
  );
  world.scheduler.pauseRun("run-paused");
  const controller = new AbortController();
  const pausedStart = vi.fn(async () => nativeSession());
  const paused = world.scheduler.open(
    owner("paused"),
    controller.signal,
    pausedStart,
  );
  const rejected = expect(paused).rejects.toBeInstanceOf(
    AgentPlanCancelledError,
  );
  const order: string[] = [];
  const queued = ["pica", "plan"].map((id) =>
    world.scheduler.open(
      { ...owner(id), runId: id === "pica" ? null : "run-plan" },
      new AbortController().signal,
      async () => {
        order.push(id);
        return nativeSession();
      },
    ),
  );
  world.scheduler.updateMaxConcurrentAcpSessions(0);
  await Promise.all(queued);
  expect(order).toEqual(["pica", "plan"]);
  expect(world.scheduler.snapshot().waiting).toMatchObject([
    { instanceId: "paused", reason: "paused" },
  ]);
  controller.abort();
  await rejected;
  expect(pausedStart).not.toHaveBeenCalled();
  await world.scheduler.shutdown();
  expect(world.scheduler.snapshot().active).toEqual([]);
  await expect(
    world.scheduler.open(
      owner("closed"),
      new AbortController().signal,
      pausedStart,
    ),
  ).rejects.toBeInstanceOf(AgentPlanCancelledError);
  await first.close();
});

it("keeps storage failures distinct from capacity after a live increase to unlimited", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const session = await world.scheduler.open(
    owner("first"),
    new AbortController().signal,
    async () => nativeSession(),
  );
  world.store.remove.mockRejectedValueOnce(
    new Error("synthetic journal failure"),
  );
  await session.close();
  const controller = new AbortController();
  const start = vi.fn(async () => nativeSession());
  const pending = world.scheduler.open(
    owner("waiting"),
    controller.signal,
    start,
  );
  const rejected = expect(pending).rejects.toBeInstanceOf(
    AgentPlanCancelledError,
  );
  world.scheduler.updateMaxConcurrentAcpSessions(0);
  await vi.advanceTimersByTimeAsync(0);
  expect(world.scheduler.snapshot()).toMatchObject({
    problem: "storage",
    active: [{ state: "cleanup_failed" }],
    waiting: [{ reason: "scheduler_error" }],
  });
  expect(start).not.toHaveBeenCalled();
  controller.abort();
  await rejected;
  await world.scheduler.shutdown();
});

it.each([-1, 1.5, 1000, Number.NaN, Number.POSITIVE_INFINITY])(
  "rejects invalid runtime limit %s without changing the live value",
  async (limit) => {
    const world = resourceWorld();
    expect(() => world.scheduler.updateMaxConcurrentAcpSessions(limit)).toThrow(
      "Invalid ACP resource setting",
    );
    expect(world.scheduler.snapshot().options.maxConcurrentAcpSessions).toBe(1);
    await world.scheduler.shutdown();
  },
);
