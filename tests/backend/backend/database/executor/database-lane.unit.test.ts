import { expect, it, vi } from "vitest";

import { DatabaseLane } from "@/backend/database/executor/DatabaseLane";

const options = {
  workClass: "request" as const,
  budgetMs: 1000,
  signal: undefined,
};

function deferred(): { promise: Promise<void>; release: () => void } {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

it("starts accepted work in FIFO order and drains after completion", async () => {
  const lane = new DatabaseLane({
    concurrency: 1,
    maximumQueued: 2,
    maximumQueuedRecurring: 1,
  });
  const gate = deferred();
  const order: string[] = [];
  const first = lane.schedule(async () => {
    order.push("first");
    await gate.promise;
  }, options);
  const second = lane.schedule(async () => {
    order.push("second");
  }, options);
  const third = lane.schedule(async () => {
    order.push("third");
  }, options);
  const drained = lane.drain();
  await expect(lane.schedule(async () => undefined, options)).rejects.toThrow();
  gate.release();
  await Promise.all([first, second, third, drained]);
  expect(order).toEqual(["first", "second", "third"]);
  expect(lane.status()).toMatchObject({ queued: 0, running: 0, completed: 3 });
});

it("limits queued recurring work and refuses overload before starting", async () => {
  const lane = new DatabaseLane({
    concurrency: 1,
    maximumQueued: 2,
    maximumQueuedRecurring: 1,
  });
  const gate = deferred();
  const first = lane.schedule(async () => gate.promise, options);
  const recurring = lane.schedule(async () => undefined, {
    ...options,
    workClass: "recurring",
  });
  await expect(
    lane.schedule(async () => undefined, {
      ...options,
      workClass: "recurring",
    }),
  ).rejects.toThrow();
  expect(lane.status()).toMatchObject({
    running: 1,
    queued: 1,
    refusedOverloaded: 1,
  });
  gate.release();
  await Promise.all([first, recurring]);
});

it("refuses aborted and timed-out waiting work without starting it", async () => {
  vi.useFakeTimers();
  try {
    const lane = new DatabaseLane({
      concurrency: 1,
      maximumQueued: 3,
      maximumQueuedRecurring: 1,
    });
    const gate = deferred();
    const first = lane.schedule(async () => gate.promise, options);
    const controller = new AbortController();
    const work = vi.fn(async () => undefined);
    const aborted = lane.schedule(work, {
      ...options,
      signal: controller.signal,
    });
    const timedOut = lane.schedule(work, options);
    const abortedResult = expect(aborted).rejects.toThrow();
    const timeoutResult = expect(timedOut).rejects.toThrow();
    controller.abort();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([abortedResult, timeoutResult]);
    expect(work).not.toHaveBeenCalled();
    expect(lane.status()).toMatchObject({
      refusedAborted: 1,
      refusedQueueTimeout: 1,
      queued: 0,
    });
    gate.release();
    await first;
  } finally {
    vi.useRealTimers();
  }
});
