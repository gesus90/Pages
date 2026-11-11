import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { logCaughtError } from "@/backend/logging/Logger";
import { recordServiceProgress } from "@/backend/runtime/ServiceWorkHealth";

import {
  NOW,
  at,
  createHarness,
  delivery,
  registration,
} from "./pica-mobile-dispatcher-fixture";

import type { DispatcherHarness } from "./pica-mobile-dispatcher-fixture";

vi.mock("@/backend/database/executor/DatabaseWorkContext", () => ({
  withBackgroundDatabaseWork: (workName: string, work: () => Promise<void>) =>
    work(),
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));
vi.mock("@/backend/runtime/ServiceWorkHealth", () => ({
  recordServiceProgress: vi.fn(),
}));

const COMPONENT = "PicaMobileNotificationDispatcher";

/** Starts a dispatcher and lets its first pass run to the end. */
async function runFirstPass(harness: DispatcherHarness): Promise<void> {
  harness.dispatcher.start();
  await vi.advanceTimersByTimeAsync(0);
}

/** A promise the test settles by hand. */
function deferred<Value>(): {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
} {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((resolver) => {
    resolve = resolver;
  });

  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.mocked(logCaughtError).mockClear();
  vi.mocked(recordServiceProgress).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

it("sends nothing while the process may not dispatch", async () => {
  const harness = createHarness({ canDispatch: () => false });

  harness.dispatcher.start();
  harness.dispatcher.kick();
  await vi.advanceTimersByTimeAsync(60_000);

  expect(harness.deliveries.nextDueAt).not.toHaveBeenCalled();
  expect(harness.deliveries.claimDue).not.toHaveBeenCalled();
});

it("skips a pass when ownership is lost between scheduling and waking", async () => {
  const canDispatch = vi
    .fn<() => boolean>()
    .mockReturnValueOnce(true)
    .mockReturnValue(false);
  const harness = createHarness({ canDispatch });

  await runFirstPass(harness);

  expect(harness.deliveries.releaseExpiredLocks).not.toHaveBeenCalled();
  expect(harness.deliveries.claimDue).not.toHaveBeenCalled();
  expect(harness.sender.send).not.toHaveBeenCalled();
  expect(recordServiceProgress).toHaveBeenCalledWith("integrations.fcm");
});

it("claims a due batch, sends it and comes back shortly after", async () => {
  const harness = createHarness();

  await runFirstPass(harness);

  expect(harness.deliveries.releaseExpiredLocks).toHaveBeenCalledWith(at(0));
  expect(harness.deliveries.expireDue).toHaveBeenCalledWith(at(0));
  expect(harness.sender.ready).toHaveBeenCalledOnce();
  expect(harness.deliveries.claimDue).toHaveBeenCalledWith(
    at(0),
    at(120_000),
    20,
  );
  expect(harness.sender.send).toHaveBeenCalledOnce();
  expect(harness.deliveries.finish).toHaveBeenCalledWith(
    "delivery-1",
    "sent",
    "accepted",
    at(0),
  );
  expect(recordServiceProgress).toHaveBeenCalledWith("integrations.fcm");

  await vi.advanceTimersByTimeAsync(249);
  expect(harness.deliveries.claimDue).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(harness.deliveries.claimDue).toHaveBeenCalledTimes(2);
  await harness.dispatcher.stop();
});

it("reads the clock from the options when it is given", async () => {
  const harness = createHarness({ now: () => new Date(NOW.getTime() + 5_000) });

  await runFirstPass(harness);

  expect(harness.deliveries.claimDue).toHaveBeenCalledWith(
    at(5_000),
    at(125_000),
    20,
  );
  await harness.dispatcher.stop();
});

it("idles for thirty seconds when nothing is pending and prunes only every five minutes", async () => {
  const harness = createHarness();
  harness.deliveries.nextDueAt.mockResolvedValue(null);

  await runFirstPass(harness);

  expect(harness.deliveries.claimDue).not.toHaveBeenCalled();
  expect(harness.deliveries.releaseExpiredLocks).not.toHaveBeenCalled();
  expect(harness.deliveries.nextDueAt).toHaveBeenCalledTimes(2);
  expect(harness.events.prune).toHaveBeenCalledOnce();

  await vi.advanceTimersByTimeAsync(29_999);
  expect(harness.deliveries.nextDueAt).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(harness.deliveries.nextDueAt).toHaveBeenCalledTimes(4);
  expect(harness.events.prune).toHaveBeenCalledOnce();

  await vi.advanceTimersByTimeAsync(300_000);
  expect(harness.events.prune).toHaveBeenCalledTimes(2);
  await harness.dispatcher.stop();
});

it.each([
  ["already due", at(-1_000), 250],
  ["due in five seconds", at(5_000), 5_000],
  ["due in ten minutes", at(600_000), 30_000],
])("waits for a delivery that is %s", async (name, due, delay) => {
  const harness = createHarness();
  harness.deliveries.nextDueAt
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(due)
    .mockResolvedValue(null);

  await runFirstPass(harness);
  expect(harness.deliveries.nextDueAt).toHaveBeenCalledTimes(2);

  await vi.advanceTimersByTimeAsync(delay - 1);
  expect(harness.deliveries.nextDueAt).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(harness.deliveries.nextDueAt).toHaveBeenCalledTimes(4);
  await harness.dispatcher.stop();
});

it("logs a failed look at the next due delivery and idles", async () => {
  const harness = createHarness();
  const failure = new Error("database busy");
  harness.deliveries.nextDueAt
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(failure)
    .mockResolvedValue(null);

  await runFirstPass(harness);

  expect(logCaughtError).toHaveBeenCalledWith(COMPONENT, failure);
  await vi.advanceTimersByTimeAsync(29_999);
  expect(harness.deliveries.nextDueAt).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(harness.deliveries.nextDueAt).toHaveBeenCalledTimes(4);
  await harness.dispatcher.stop();
});

it("logs a failing pass without progress and tries again", async () => {
  const harness = createHarness();
  const failure = new Error("lock table unavailable");
  harness.deliveries.releaseExpiredLocks.mockRejectedValueOnce(failure);

  await runFirstPass(harness);

  expect(logCaughtError).toHaveBeenCalledWith(COMPONENT, failure);
  expect(recordServiceProgress).not.toHaveBeenCalled();
  expect(harness.deliveries.claimDue).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(250);
  expect(harness.deliveries.claimDue).toHaveBeenCalledOnce();
  await harness.dispatcher.stop();
});

it("holds every claim while the sender cannot get ready and asks again after the idle wait", async () => {
  const harness = createHarness();
  harness.sender.ready.mockResolvedValueOnce(false).mockResolvedValue(true);

  await runFirstPass(harness);

  expect(harness.deliveries.expireDue).toHaveBeenCalledOnce();
  expect(harness.deliveries.claimDue).not.toHaveBeenCalled();
  expect(harness.deliveries.nextDueAt).toHaveBeenCalledOnce();

  await vi.advanceTimersByTimeAsync(29_999);
  expect(harness.sender.ready).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(harness.sender.ready).toHaveBeenCalledTimes(2);
  expect(harness.deliveries.claimDue).toHaveBeenCalledOnce();
  await harness.dispatcher.stop();
});

it("lets pending pushes wait out their validity while no sender is configured", async () => {
  const harness = createHarness({ hasSender: false });

  await runFirstPass(harness);

  expect(harness.deliveries.releaseExpiredLocks).toHaveBeenCalledWith(at(0));
  expect(harness.deliveries.expireDue).toHaveBeenCalledWith(at(0));
  expect(harness.sender.ready).not.toHaveBeenCalled();
  expect(harness.deliveries.claimDue).not.toHaveBeenCalled();
  expect(harness.deliveries.nextDueAt).toHaveBeenCalledOnce();
  await harness.dispatcher.stop();
});

it("prunes events and deliveries by their retention and sweeps dead registrations", async () => {
  const harness = createHarness();
  const kept = registration({ deviceId: "device-kept", sessionId: "live" });
  const dropped = registration({ deviceId: "device-gone", sessionId: "dead" });
  harness.deliveries.nextDueAt.mockResolvedValue(null);
  harness.registrations.listAll.mockResolvedValue([kept, dropped]);
  harness.accounts.isBindingValid.mockImplementation(
    async (accountId, sessionId) => sessionId === "live",
  );

  await runFirstPass(harness);

  expect(harness.accounts.isBindingValid).toHaveBeenCalledWith(
    "account-1",
    "dead",
  );
  expect(harness.registrations.removeBinding).toHaveBeenCalledOnce();
  expect(harness.registrations.removeBinding).toHaveBeenCalledWith(
    dropped,
    at(0),
  );
  expect(harness.events.prune).toHaveBeenCalledWith({
    eventsBefore: at(-7 * 24 * 60 * 60 * 1000),
    deliveriesBefore: at(-24 * 60 * 60 * 1000),
    maximumEventsPerAccount: 100,
  });
  await harness.dispatcher.stop();
});

it("prunes even when the sweep fails and sweeps even when the prune fails", async () => {
  const sweepFailure = new Error("registrations unreadable");
  const pruneFailure = new Error("prune failed");
  const failingSweep = createHarness();
  failingSweep.deliveries.nextDueAt.mockResolvedValue(null);
  failingSweep.registrations.listAll.mockRejectedValue(sweepFailure);
  const failingPrune = createHarness();
  failingPrune.deliveries.nextDueAt.mockResolvedValue(null);
  failingPrune.events.prune.mockRejectedValue(pruneFailure);

  await runFirstPass(failingSweep);
  await runFirstPass(failingPrune);

  expect(failingSweep.events.prune).toHaveBeenCalledOnce();
  expect(logCaughtError).toHaveBeenCalledWith(COMPONENT, sweepFailure);
  expect(failingPrune.registrations.listAll).toHaveBeenCalledOnce();
  expect(logCaughtError).toHaveBeenCalledWith(COMPONENT, pruneFailure);
  await failingSweep.dispatcher.stop();
  await failingPrune.dispatcher.stop();
});

it("moves a later pass forward when new pushes are announced and ignores a repeated kick", async () => {
  const harness = createHarness();

  await runFirstPass(harness);
  expect(harness.deliveries.claimDue).toHaveBeenCalledOnce();

  harness.dispatcher.kick();
  harness.dispatcher.kick();
  await vi.advanceTimersByTimeAsync(0);

  expect(harness.deliveries.claimDue).toHaveBeenCalledTimes(2);
  await harness.dispatcher.stop();
});

it("postpones a wake-up that arrives while a pass is still running", async () => {
  const harness = createHarness();
  const claim = deferred<ReturnType<typeof delivery>[]>();
  harness.deliveries.claimDue.mockReturnValueOnce(claim.promise);

  await runFirstPass(harness);
  harness.dispatcher.kick();
  await vi.advanceTimersByTimeAsync(0);
  expect(harness.deliveries.claimDue).toHaveBeenCalledOnce();

  claim.resolve([]);
  await vi.advanceTimersByTimeAsync(250);

  expect(harness.deliveries.claimDue).toHaveBeenCalledTimes(2);
  await harness.dispatcher.stop();
});

it("works through at most four deliveries at the same time", async () => {
  const harness = createHarness();
  const claimed = Array.from({ length: 6 }, (_, index) =>
    delivery({ deliveryId: `delivery-${index}` }),
  );
  let active = 0;
  let peak = 0;
  harness.deliveries.claimDue.mockResolvedValueOnce(claimed);
  harness.registrations.find.mockImplementation(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    active -= 1;

    return null;
  });

  await runFirstPass(harness);
  await vi.advanceTimersByTimeAsync(20);

  expect(peak).toBe(4);
  expect(harness.deliveries.finish).toHaveBeenCalledTimes(6);
  expect(harness.deliveries.finish).toHaveBeenCalledWith(
    "delivery-4",
    "dropped",
    "registration_missing",
    at(20),
  );
  await harness.dispatcher.stop();
});

it("does not start again after it was stopped", async () => {
  const harness = createHarness();

  harness.dispatcher.start();
  await harness.dispatcher.stop();
  harness.dispatcher.kick();
  await vi.advanceTimersByTimeAsync(60_000);

  expect(harness.deliveries.nextDueAt).not.toHaveBeenCalled();
});

it("waits for the pass that is running when it stops", async () => {
  const harness = createHarness();
  const claim = deferred<ReturnType<typeof delivery>[]>();
  let isStopped = false;
  harness.deliveries.claimDue.mockReturnValueOnce(claim.promise);

  await runFirstPass(harness);
  void harness.dispatcher.stop().then(() => {
    isStopped = true;
  });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(isStopped).toBe(false);

  claim.resolve([]);
  await vi.advanceTimersByTimeAsync(0);

  expect(isStopped).toBe(true);
});

it("gives up waiting for a hanging pass after five seconds", async () => {
  const harness = createHarness();
  let isStopped = false;
  harness.deliveries.claimDue.mockReturnValueOnce(new Promise(() => undefined));

  await runFirstPass(harness);
  void harness.dispatcher.stop().then(() => {
    isStopped = true;
  });
  await vi.advanceTimersByTimeAsync(4_999);
  expect(isStopped).toBe(false);
  await vi.advanceTimersByTimeAsync(1);

  expect(isStopped).toBe(true);
});
