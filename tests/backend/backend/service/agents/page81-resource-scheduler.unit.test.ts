import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";

import { parameterRunFixture } from "./page55-run-fixture";
import {
  closed,
  deferred,
  nativeSession,
  owner,
  resourceWorld,
} from "./page81-resource-fixture";

import type { PlanSessionClosed } from "@/backend/agents/AgentPlanExecution";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it("admits three mixed-provider independent runs FIFO with exactly one durable starting lease", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const durable = deferred<void>();
  world.store.save.mockImplementationOnce(() => durable.promise);
  const start = vi.fn(async () => nativeSession());
  const first = world.scheduler.open(
    owner("a"),
    new AbortController().signal,
    start,
  );
  const second = world.scheduler.open(
    owner("b", "claude_code"),
    new AbortController().signal,
    start,
  );
  const third = world.scheduler.open(
    owner("c"),
    new AbortController().signal,
    start,
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(start).not.toHaveBeenCalled();
  expect(world.scheduler.snapshot().active).toMatchObject([
    { instanceId: "a", state: "starting" },
  ]);
  expect(
    world.scheduler.snapshot().waiting.map((entry) => entry.instanceId),
  ).toEqual(["b", "c"]);
  durable.resolve();
  const a = await first;
  await a.turn;
  expect(start).toHaveBeenCalledTimes(1);
  await a.close();
  await vi.advanceTimersByTimeAsync(1000);
  const b = await second;
  expect(start).toHaveBeenCalledTimes(2);
  expect(world.scheduler.snapshot().waiting).toMatchObject([
    { instanceId: "c", reason: "capacity" },
  ]);
  await b.close();
  await vi.advanceTimersByTimeAsync(1000);
  await (await third).close();
  expect(start).toHaveBeenCalledTimes(3);
  expect(world.scheduler.snapshot().active).toEqual([]);
  await world.scheduler.shutdown();
});

it("does not admit a successor until the entire closeout and durable release complete", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const cleanup = deferred<PlanSessionClosed>();
  const native = nativeSession();
  native.close.mockReturnValue(cleanup.promise);
  const first = await world.scheduler.open(
    owner("a"),
    new AbortController().signal,
    async () => native,
  );
  const next = vi.fn(async () => nativeSession());
  const pending = world.scheduler.open(
    owner("b"),
    new AbortController().signal,
    next,
  );
  const closing = first.close();
  await vi.advanceTimersByTimeAsync(5000);
  expect(next).not.toHaveBeenCalled();
  expect(world.scheduler.snapshot().active[0]?.state).toBe("closing");
  const removed = deferred<void>();
  world.store.remove.mockImplementationOnce(() => removed.promise);
  cleanup.resolve(closed());
  await vi.advanceTimersByTimeAsync(1000);
  expect(next).not.toHaveBeenCalled();
  removed.resolve();
  await closing;
  await vi.advanceTimersByTimeAsync(1000);
  await (await pending).close();
  await world.scheduler.shutdown();
});

it("removes an aborted FIFO waiter and never invokes its start callback", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const first = await world.scheduler.open(
    owner("a"),
    new AbortController().signal,
    async () => nativeSession(),
  );
  const controller = new AbortController();
  const start = vi.fn(async () => nativeSession());
  const pending = world.scheduler.open(owner("b"), controller.signal, start);
  const rejection = expect(pending).rejects.toBeInstanceOf(
    AgentPlanCancelledError,
  );
  controller.abort();
  await rejection;
  await first.close();
  await vi.advanceTimersByTimeAsync(1000);
  expect(start).not.toHaveBeenCalled();
  expect(world.scheduler.snapshot().waiting).toEqual([]);
  await world.scheduler.shutdown();
});

it.each([null, 1024])(
  "blocks on insufficient or unknown memory (%s), then retries automatically",
  async (available) => {
    const world = resourceWorld();
    world.memory.mockResolvedValue(available);
    await world.scheduler.recover();
    const start = vi.fn(async () => nativeSession());
    const pending = world.scheduler.open(
      owner("a"),
      new AbortController().signal,
      start,
    );
    await vi.advanceTimersByTimeAsync(3000);
    expect(start).not.toHaveBeenCalled();
    expect(world.records.size).toBe(0);
    expect(world.scheduler.snapshot().waiting[0]?.reason).toBe(
      available === null ? "memory_unknown" : "memory",
    );
    world.memory.mockResolvedValue(2048);
    await vi.advanceTimersByTimeAsync(1000);
    await (await pending).close();
    expect(start).toHaveBeenCalledOnce();
    await world.scheduler.shutdown();
  },
);

it("treats a failed memory probe as unknown and supports disabling admission checks", async () => {
  const world = resourceWorld({ memoryAwareScheduling: false });
  world.memory.mockRejectedValue(new Error("probe failed"));
  await world.scheduler.recover();
  const session = await world.scheduler.open(
    owner("a"),
    new AbortController().signal,
    async () => nativeSession(),
  );
  expect(world.scheduler.snapshot().availableMemory).toBeNull();
  await session.close();
  await world.scheduler.shutdown();
});

it("admits two native sessions at configured limit 2, holding the third", async () => {
  const world = resourceWorld({ maxConcurrentAcpSessions: 2 });
  await world.scheduler.recover();
  const first = await world.scheduler.open(
    owner("a"),
    new AbortController().signal,
    async () => nativeSession(),
  );
  const second = await world.scheduler.open(
    owner("b", "claude_code"),
    new AbortController().signal,
    async () => nativeSession(),
  );
  const start = vi.fn(async () => nativeSession());
  const controller = new AbortController();
  const pending = world.scheduler.open(owner("c"), controller.signal, start);
  const rejection = expect(pending).rejects.toBeInstanceOf(
    AgentPlanCancelledError,
  );
  await vi.advanceTimersByTimeAsync(1000);
  expect(world.scheduler.snapshot().active).toHaveLength(2);
  expect(start).not.toHaveBeenCalled();
  controller.abort();
  await rejection;
  await Promise.all([first.close(), second.close()]);
  await world.scheduler.shutdown();
});

it("holds capacity across reuse, concurrent close, and waiter cancellation without duplicate releases", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const native = nativeSession();
  const session = await world.scheduler.open(
    owner("a"),
    new AbortController().signal,
    async () => native,
  );
  await session.turn;
  const controller = new AbortController();
  const pending = world.scheduler.open(
    owner("b"),
    controller.signal,
    async () => nativeSession(),
  );
  const rejected = expect(pending).rejects.toBeInstanceOf(
    AgentPlanCancelledError,
  );
  const fixture = await parameterRunFixture();
  const prepared = await fixture.start.prepare(
    fixture.run,
    fixture.snapshot,
    fixture.step,
  );
  await session.next?.(
    {
      ...prepared.input,
      resourceContext: { runId: "run-a", stepId: "next-step" },
    },
    new AbortController().signal,
    {
      started: () => {},
      identified: () => {},
    },
  );
  expect(native.next).toHaveBeenCalledOnce();
  expect(world.scheduler.snapshot().active[0]?.stepId).toBe("next-step");
  expect(world.scheduler.snapshot().active).toHaveLength(1);
  controller.abort();
  await Promise.all([session.close(), session.close(), rejected]);
  expect(native.close).toHaveBeenCalledOnce();
  expect(world.store.remove).toHaveBeenCalledTimes(1);
  expect(world.records.size).toBe(0);
  await world.scheduler.shutdown();
});
