import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  DatabaseOverloadedError,
  DatabaseUnavailableError,
} from "@/backend/database/executor/DatabaseExecutorErrors";
import {
  DatabaseLane,
  type LaneJobOptions,
} from "@/backend/database/executor/DatabaseLane";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const options = (over: Partial<LaneJobOptions> = {}): LaneJobOptions => ({
  workClass: "request",
  budgetMs: 1000,
  signal: undefined,
  ...over,
});

function gate(): { promise: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

it("runs a job at once and counts it", async () => {
  const lane = new DatabaseLane({
    concurrency: 1,
    maximumQueued: 2,
    maximumQueuedRecurring: 1,
  });
  await expect(
    lane.schedule((ms) => Promise.resolve(ms), options()),
  ).resolves.toBeGreaterThanOrEqual(0);
  expect(lane.status()).toMatchObject({ completed: 1, running: 0, queued: 0 });
});

it("queues jobs in order and records the longest wait", async () => {
  const lane = new DatabaseLane({
    concurrency: 1,
    maximumQueued: 2,
    maximumQueuedRecurring: 1,
  });
  const first = gate();
  const order: string[] = [];
  const a = lane.schedule(async () => {
    await first.promise;
    order.push("a");
  }, options());
  const b = lane.schedule(() => {
    order.push("b");
    return Promise.resolve();
  }, options());
  expect(lane.status().queued).toBe(1);
  await vi.advanceTimersByTimeAsync(40);
  first.open();
  await Promise.all([a, b]);
  expect(order).toEqual(["a", "b"]);
  expect(lane.status().longestQueueWaitMs).toBeGreaterThanOrEqual(40);
});

it("propagates a failing queued job", async () => {
  const lane = new DatabaseLane({
    concurrency: 1,
    maximumQueued: 2,
    maximumQueuedRecurring: 1,
  });
  const first = gate();
  const a = lane.schedule(() => first.promise, options());
  const b = lane.schedule(() => Promise.reject(new Error("fail")), options());
  const outcome = expect(b).rejects.toThrow("fail");
  first.open();
  await a;
  await outcome;
});

it("refuses when the queue or the recurring share is full", async () => {
  const lane = new DatabaseLane({
    concurrency: 1,
    maximumQueued: 2,
    maximumQueuedRecurring: 1,
  });
  const first = gate();
  const running = lane.schedule(() => first.promise, options());
  const recurring = lane.schedule(
    () => Promise.resolve(),
    options({ workClass: "recurring" }),
  );
  await expect(
    lane.schedule(() => Promise.resolve(), options({ workClass: "recurring" })),
  ).rejects.toMatchObject({ failure: "overloaded" });
  const plain = lane.schedule(
    () => Promise.resolve(),
    options({ workClass: "background" }),
  );
  await expect(
    lane.schedule(() => Promise.resolve(), options()),
  ).rejects.toBeInstanceOf(DatabaseOverloadedError);
  expect(lane.status().refusedOverloaded).toBe(2);
  first.open();
  await Promise.all([running, recurring, plain]);
});

it("refuses a queued job after its budget", async () => {
  const lane = new DatabaseLane({
    concurrency: 1,
    maximumQueued: 2,
    maximumQueuedRecurring: 1,
  });
  const first = gate();
  const running = lane.schedule(() => first.promise, options());
  const waiting = lane.schedule(
    () => Promise.resolve(),
    options({ budgetMs: 10 }),
  );
  const outcome = expect(waiting).rejects.toMatchObject({
    failure: "queue_timeout",
  });
  await vi.advanceTimersByTimeAsync(10);
  await outcome;
  expect(lane.status()).toMatchObject({ refusedQueueTimeout: 1, queued: 0 });
  first.open();
  await running;
});

it("refuses an aborted job before and while it waits", async () => {
  const lane = new DatabaseLane({
    concurrency: 1,
    maximumQueued: 2,
    maximumQueuedRecurring: 1,
  });
  const done = new AbortController();
  done.abort();
  await expect(
    lane.schedule(() => Promise.resolve(), options({ signal: done.signal })),
  ).rejects.toMatchObject({ failure: "aborted" });
  const first = gate();
  const running = lane.schedule(() => first.promise, options());
  const live = new AbortController();
  const waiting = lane.schedule(
    () => Promise.resolve(),
    options({ signal: live.signal }),
  );
  const outcome = expect(waiting).rejects.toMatchObject({ failure: "aborted" });
  live.abort();
  await outcome;
  expect(lane.status().refusedAborted).toBe(2);
  first.open();
  await running;
});

it("drains accepted jobs and refuses later ones", async () => {
  const lane = new DatabaseLane({
    concurrency: 1,
    maximumQueued: 2,
    maximumQueuedRecurring: 1,
  });
  const first = gate();
  const running = lane.schedule(() => first.promise, options());
  const waiting = lane.schedule(() => Promise.resolve(), options());
  const drained = lane.drain();
  await expect(
    lane.schedule(() => Promise.resolve(), options()),
  ).rejects.toBeInstanceOf(DatabaseUnavailableError);
  first.open();
  await Promise.all([running, waiting, drained]);
  await expect(lane.drain()).resolves.toBeUndefined();
});

it("refuses waiting jobs on close while the started one runs on", async () => {
  const lane = new DatabaseLane({
    concurrency: 1,
    maximumQueued: 2,
    maximumQueuedRecurring: 1,
  });
  const first = gate();
  const running = lane.schedule(() => first.promise, options());
  const waiting = lane.schedule(() => Promise.resolve(), options());
  const outcome = expect(waiting).rejects.toBeInstanceOf(
    DatabaseUnavailableError,
  );
  const drained = lane.drain();
  lane.refuseWaiting();
  await outcome;
  first.open();
  await Promise.all([running, drained]);
});
