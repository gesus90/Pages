import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { interruptedAcpOwners } from "@/backend/service/agents/AgentPlanRecovery";
import { createSessionRecord } from "@/backend/service/agents/AgentPlanSessionRecords";

import {
  deferred,
  nativeSession,
  owner,
  resourceWorld,
} from "./page81-resource-fixture";
import { parameterRunFixture } from "./page55-run-fixture";

import type { AgentPlanRun } from "@/definition/AgentPlan";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

it("cleans partially started processes before allowing a queued successor", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const cleanup = deferred<{ remaining: number }>();
  world.cleanup.mockReturnValueOnce(cleanup.promise);
  const failed = world.scheduler.open(
    owner("a"),
    new AbortController().signal,
    async () => {
      throw new Error("partial spawn");
    },
  );
  const rejected = expect(failed).rejects.toThrow("partial spawn");
  const start = vi.fn(async () => nativeSession());
  const pending = world.scheduler.open(
    owner("b"),
    new AbortController().signal,
    start,
  );
  await vi.advanceTimersByTimeAsync(1000);
  expect(start).not.toHaveBeenCalled();
  cleanup.resolve({ remaining: 0 });
  await rejected;
  await vi.advanceTimersByTimeAsync(1000);
  await (await pending).close();
  expect(world.records.size).toBe(0);
  await world.scheduler.shutdown();
});

it.each(["leftovers", "unknown"])(
  "retains failed starts with %s cleanup and reports the blocker",
  async (failure) => {
    const world = resourceWorld();
    await world.scheduler.recover();
    if (failure === "unknown")
      world.cleanup.mockRejectedValueOnce(new Error("unreadable proc"));
    else world.cleanup.mockResolvedValueOnce({ remaining: 1 });
    await expect(
      world.scheduler.open(
        owner("a"),
        new AbortController().signal,
        async () => {
          throw new Error("start failed");
        },
      ),
    ).rejects.toThrow("start failed");
    expect(world.scheduler.snapshot().active).toMatchObject([
      { instanceId: "a", state: "cleanup_failed" },
    ]);
    expect(world.records.get("a")?.state).toBe("cleanup_failed");
    await world.scheduler.shutdown();
  },
);

it.each(["unconfirmed", "rejected"])(
  "does not release after %s closeout",
  async (failure) => {
    const world = resourceWorld();
    await world.scheduler.recover();
    const native = nativeSession();
    if (failure === "rejected")
      native.close.mockRejectedValueOnce(new Error("close failed"));
    else
      native.close.mockResolvedValueOnce({
        exit: null,
        endedAt: "now",
        leftovers: 1,
        isConfirmed: false,
      });
    const session = await world.scheduler.open(
      owner("a"),
      new AbortController().signal,
      async () => native,
    );
    if (failure === "rejected")
      await expect(session.close()).rejects.toThrow("close failed");
    else expect((await session.close()).isConfirmed).toBe(false);
    expect(world.scheduler.snapshot().active[0]?.state).toBe("cleanup_failed");
    expect(world.store.remove).not.toHaveBeenCalled();
    await world.scheduler.shutdown();
  },
);

it("closes a crashed idle adapter and its descendants before giving back its lease", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const terminated = deferred<void>();
  const native = nativeSession();
  const session = await world.scheduler.open(
    owner("a"),
    new AbortController().signal,
    async () => ({ ...native, terminated: terminated.promise }),
  );
  await session.turn;
  terminated.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(native.close).toHaveBeenCalledOnce();
  expect(world.scheduler.snapshot().active).toEqual([]);
  await world.scheduler.shutdown();
});

it("retains paused native sessions until idle expiry, then refuses reuse without a replacement", async () => {
  const world = resourceWorld({ acpIdleTimeout: 5000 });
  await world.scheduler.recover();
  const native = nativeSession();
  const session = await world.scheduler.open(
    owner("a"),
    new AbortController().signal,
    async () => native,
  );
  await session.turn;
  world.scheduler.pauseRun("run-a");
  await vi.advanceTimersByTimeAsync(4999);
  expect(world.scheduler.snapshot().active[0]?.state).toBe("idle");
  expect(native.close).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(native.close).toHaveBeenCalledOnce();
  expect(world.scheduler.snapshot().active).toEqual([]);
  const fixture = await parameterRunFixture();
  const prepared = await fixture.start.prepare(
    fixture.run,
    fixture.snapshot,
    fixture.step,
  );
  await expect(
    session.next?.(prepared.input, new AbortController().signal, {
      started: () => {},
      identified: () => {},
    }),
  ).rejects.toMatchObject({ code: "plan_context_changed" });
  expect(native.next).not.toHaveBeenCalled();
  await world.scheduler.shutdown();
});

it("keeps paused waiters suspended and resumes their original FIFO order", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  world.scheduler.pauseRun("run-a");
  const pausedStart = vi.fn(async () => nativeSession());
  const paused = world.scheduler.open(
    owner("a"),
    new AbortController().signal,
    pausedStart,
  );
  const runnable = await world.scheduler.open(
    owner("b"),
    new AbortController().signal,
    async () => nativeSession(),
  );
  expect(world.scheduler.snapshot().waiting).toMatchObject([
    { instanceId: "a", reason: "paused" },
  ]);
  await runnable.close();
  await vi.advanceTimersByTimeAsync(1000);
  expect(pausedStart).not.toHaveBeenCalled();
  world.scheduler.resumeRun("run-a");
  await vi.advanceTimersByTimeAsync(1000);
  await (await paused).close();
  await world.scheduler.shutdown();
});

it("recovers durable leases before admission and never repeats their native start", async () => {
  const world = resourceWorld();
  world.records.set("old", {
    ...owner("old"),
    state: "starting",
    since: "2026-10-16",
  });
  const recovery = deferred<{ remaining: number }>();
  world.cleanup.mockReturnValueOnce(recovery.promise);
  const recovering = world.scheduler.recover();
  const start = vi.fn(async () => nativeSession());
  const pending = world.scheduler.open(
    owner("new"),
    new AbortController().signal,
    start,
  );
  await vi.advanceTimersByTimeAsync(1000);
  expect(start).not.toHaveBeenCalled();
  expect(world.scheduler.snapshot().waiting[0]?.reason).toBe("recovery");
  recovery.resolve({ remaining: 0 });
  await recovering;
  await vi.advanceTimersByTimeAsync(1000);
  await (await pending).close();
  expect(world.cleanup).toHaveBeenCalledExactlyOnceWith("old");
  expect(start).toHaveBeenCalledOnce();
  await world.scheduler.shutdown();
});

it("continues to occupy capacity when startup recovery cannot prove process death", async () => {
  const world = resourceWorld();
  world.records.set("old", {
    ...owner("old"),
    state: "idle",
    since: "2026-10-16",
  });
  world.cleanup.mockRejectedValueOnce(new Error("unknown"));
  await world.scheduler.recover();
  const start = vi.fn(async () => nativeSession());
  const controller = new AbortController();
  const pending = world.scheduler.open(owner("new"), controller.signal, start);
  const rejection = expect(pending).rejects.toBeInstanceOf(
    AgentPlanCancelledError,
  );
  await vi.advanceTimersByTimeAsync(1000);
  expect(world.scheduler.snapshot().active[0]?.state).toBe("cleanup_failed");
  expect(start).not.toHaveBeenCalled();
  controller.abort();
  await rejection;
  await world.scheduler.shutdown();
});

it("cancels a request during durable reservation without calling its native start", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  world.cleanup.mockRejectedValue(new Error("unreadable proc"));
  const saved = deferred<void>();
  world.store.save.mockReturnValueOnce(saved.promise);
  const controller = new AbortController();
  const start = vi.fn(async () => nativeSession());
  const pending = world.scheduler.open(owner("a"), controller.signal, start);
  const rejection = expect(pending).rejects.toBeInstanceOf(
    AgentPlanCancelledError,
  );
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  saved.resolve();
  await rejection;
  expect(start).not.toHaveBeenCalled();
  expect(world.cleanup).not.toHaveBeenCalled();
  expect(world.scheduler.snapshot().active).toEqual([]);
  await world.scheduler.shutdown();
});

it("fails closed on journal write or delete uncertainty", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const session = await world.scheduler.open(
    owner("a"),
    new AbortController().signal,
    async () => nativeSession(),
  );
  world.store.remove.mockRejectedValueOnce(new Error("write uncertain"));
  expect((await session.close()).isConfirmed).toBe(false);
  expect(world.scheduler.snapshot()).toMatchObject({
    problem: "storage",
    active: [{ state: "cleanup_failed" }],
  });
  await world.scheduler.shutdown();
  const failed = resourceWorld();
  await failed.scheduler.recover();
  failed.store.save.mockRejectedValueOnce(new Error("write uncertain"));
  const start = vi.fn(async () => nativeSession());
  await expect(
    failed.scheduler.open(owner("a"), new AbortController().signal, start),
  ).rejects.toThrow("reservation");
  expect(start).not.toHaveBeenCalled();
  expect(failed.scheduler.snapshot().active[0]?.state).toBe("cleanup_failed");
  await failed.scheduler.shutdown();
});

it("shutdown rejects queued work, closes current sessions once, and refuses new starts", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const native = nativeSession();
  await world.scheduler.open(
    owner("a"),
    new AbortController().signal,
    async () => native,
  );
  const start = vi.fn(async () => nativeSession());
  const pending = world.scheduler.open(
    owner("b"),
    new AbortController().signal,
    start,
  );
  const rejection = expect(pending).rejects.toBeInstanceOf(
    AgentPlanCancelledError,
  );
  await world.scheduler.shutdown();
  await rejection;
  expect(native.close).toHaveBeenCalledOnce();
  expect(world.scheduler.snapshot().active).toEqual([]);
  expect(world.scheduler.snapshot().waiting).toEqual([]);
  await expect(
    world.scheduler.open(owner("c"), new AbortController().signal, start),
  ).rejects.toBeInstanceOf(AgentPlanCancelledError);
  expect(start).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("does not override a known unconfirmed process exit with a later empty tag scan", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  await expect(
    world.scheduler.open(owner("a"), new AbortController().signal, async () => {
      throw new AcpCleanupUnconfirmedError();
    }),
  ).rejects.toMatchObject({ code: "plan_closeout_failed" });
  expect(world.cleanup).not.toHaveBeenCalled();
  expect(world.scheduler.snapshot().active[0]?.state).toBe("cleanup_failed");
  await world.scheduler.shutdown();
});

it("reports automatic idle retirement to the retained run observer and refreshes monitoring RAM", async () => {
  const world = resourceWorld({ acpIdleTimeout: 1000 });
  await world.scheduler.recover();
  const retired = vi.fn();
  const session = await world.scheduler.open(
    owner("a"),
    new AbortController().signal,
    async () => nativeSession(),
    { started: () => {}, identified: () => {}, retired },
  );
  await session.turn;
  world.scheduler.pauseRun("run-a");
  expect(world.scheduler.snapshot().active[0]?.isPaused).toBe(true);
  world.memory.mockResolvedValueOnce(3072);
  expect((await world.scheduler.inspect()).availableMemory).toBe(3072);
  await vi.advanceTimersByTimeAsync(1000);
  expect(retired).toHaveBeenCalledWith(
    expect.objectContaining({ isConfirmed: true }),
    "idle_timeout",
  );
  expect(world.records.size).toBe(0);
  await world.scheduler.shutdown();
});

it("adopts pre-journal group sessions once on upgrade and keeps uncertain legacy cleanup occupied", async () => {
  const fixture = await parameterRunFixture(undefined, "codex_cli");
  const prepared = await fixture.start.prepare(
    fixture.run,
    fixture.snapshot,
    fixture.step,
  );
  const session = createSessionRecord({
    instanceId: "legacy",
    prepared,
    contract: null,
    usesMcp: false,
  });
  const run: AgentPlanRun = {
    ...fixture.run,
    steps: [
      {
        id: "legacy-step",
        name: "Legacy",
        status: "paused",
        isBlocked: false,
        cancellation: "none",
        output: null,
        error: null,
        session,
      },
    ],
  };
  const owners = interruptedAcpOwners([run]);
  expect(owners.length).toBeGreaterThan(0);
  const world = resourceWorld();
  world.cleanup.mockResolvedValue({ remaining: 1 });
  await world.scheduler.recover([...owners, ...owners]);
  expect(world.cleanup).toHaveBeenCalledExactlyOnceWith("legacy");
  expect(world.scheduler.snapshot().active).toMatchObject([
    { instanceId: "legacy", state: "cleanup_failed" },
  ]);
  expect(world.records.size).toBe(1);
  expect(
    interruptedAcpOwners([
      {
        ...run,
        steps: run.steps.map((step) => ({
          ...step,
          session: { ...session, closeout: "confirmed" },
        })),
      },
    ]),
  ).toEqual([]);
  await world.scheduler.shutdown();
});

it("prevents a reuse prompt when close begins during the durable reuse transition", async () => {
  const world = resourceWorld();
  await world.scheduler.recover();
  const native = nativeSession();
  const session = await world.scheduler.open(
    owner("a"),
    new AbortController().signal,
    async () => native,
  );
  await session.turn;
  const fixture = await parameterRunFixture();
  const prepared = await fixture.start.prepare(
    fixture.run,
    fixture.snapshot,
    fixture.step,
  );
  const saved = deferred<void>();
  world.store.save.mockReturnValueOnce(saved.promise);
  const reuse = session.next?.(prepared.input, new AbortController().signal, {
    started: () => {},
    identified: () => {},
  });
  const rejection = expect(reuse).rejects.toMatchObject({
    code: "plan_context_changed",
  });
  const closing = session.close();
  await vi.advanceTimersByTimeAsync(0);
  saved.resolve();
  await Promise.all([rejection, closing]);
  expect(native.next).not.toHaveBeenCalled();
  expect(native.close).toHaveBeenCalledOnce();
  expect(world.store.remove).toHaveBeenCalledOnce();
  await world.scheduler.shutdown();
});
