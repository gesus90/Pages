import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ProcessLifecycleModule from "./ProcessLifecycle";

const mocks = vi.hoisted(() => ({
  logEvent: vi.fn(),
  logCaughtError: vi.fn(),
  closeLogging: vi.fn(),
  contexts: [] as string[],
}));

vi.mock("@/backend/logging/Logger", () => ({
  logEvent: mocks.logEvent,
  logCaughtError: mocks.logCaughtError,
  closeLogging: mocks.closeLogging,
}));

vi.mock("@/backend/database/executor/DatabaseWorkContext", () => ({
  withBackgroundDatabaseWork: <Result>(
    origin: string,
    work: () => Promise<Result>,
  ): Promise<Result> => {
    mocks.contexts.push(origin);
    return work();
  },
}));

type LifecycleModule = typeof ProcessLifecycleModule;
type SignalHandler = (reason?: unknown) => void;

const originalExitCode = process.exitCode;
const handlers = new Map<string, SignalHandler>();

async function loadLifecycle(): Promise<LifecycleModule> {
  vi.resetModules();
  return import("./ProcessLifecycle");
}

function hang(): Promise<void> {
  return new Promise<void>(() => undefined);
}

function eventNames(): readonly string[] {
  return mocks.logEvent.mock.calls.map(
    (call: readonly { event: string }[]) => call[0]?.event ?? "",
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
  mocks.contexts.length = 0;
  mocks.closeLogging.mockResolvedValue(undefined);
  process.exitCode = undefined;
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  vi.spyOn(process, "once").mockImplementation(
    (event: string | symbol, listener: SignalHandler) => {
      handlers.set(String(event), listener);
      return process;
    },
  );
  vi.spyOn(process, "on").mockImplementation(
    (event: string | symbol, listener: SignalHandler) => {
      handlers.set(String(event), listener);
      return process;
    },
  );
});

afterEach(() => {
  vi.useRealTimers();
  process.exitCode = originalExitCode;
});

describe("installProcessLogging", () => {
  it("registers the signal and fatal error handlers only once", async () => {
    const lifecycle = await loadLifecycle();

    lifecycle.installProcessLogging();
    lifecycle.installProcessLogging();

    expect([...handlers.keys()].sort()).toEqual([
      "SIGINT",
      "SIGTERM",
      "uncaughtException",
      "unhandledRejection",
    ]);
    expect(process.once).toHaveBeenCalledTimes(2);
    expect(process.on).toHaveBeenCalledTimes(2);
  });

  it("stops with exit code 0 after SIGINT and SIGTERM", async () => {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      handlers.clear();
      mocks.logEvent.mockClear();
      const lifecycle = await loadLifecycle();
      lifecycle.installProcessLogging();

      handlers.get(signal)?.();
      await vi.advanceTimersByTimeAsync(0);

      expect(mocks.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "info",
          metadata: { reason: signal, exitCode: 0 },
        }),
      );
      expect(process.exit).toHaveBeenLastCalledWith(0);
    }
  });

  it("stops with exit code 1 and the error after an uncaught exception", async () => {
    const lifecycle = await loadLifecycle();
    lifecycle.installProcessLogging();
    const error = new Error("crash");

    handlers.get("uncaughtException")?.(error);
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "fatal",
        event: "server.shutdown.started",
        error,
        metadata: { reason: "uncaughtException", exitCode: 1 },
      }),
    );
    expect(process.exit).toHaveBeenLastCalledWith(1);
  });

  it("stops with exit code 1 after an unhandled rejection", async () => {
    const lifecycle = await loadLifecycle();
    lifecycle.installProcessLogging();

    handlers.get("unhandledRejection")?.("rejected");
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "rejected",
        metadata: { reason: "unhandledRejection", exitCode: 1 },
      }),
    );
    expect(process.exit).toHaveBeenLastCalledWith(1);
  });
});

describe("shutdownProcess", () => {
  it("runs in a neutral background context and reports a clean stop", async () => {
    const lifecycle = await loadLifecycle();
    const order: string[] = [];
    lifecycle.registerShutdownTask(
      async () => {
        order.push("first");
      },
      { step: "first" },
    );
    lifecycle.registerShutdownTask(
      async () => {
        order.push("second");
      },
      { step: "second" },
    );

    await lifecycle.shutdownProcess(0, "test");

    expect(mocks.contexts).toEqual(["shutdown"]);
    expect(order).toEqual(["first", "second"]);
    expect(eventNames()).toEqual([
      "server.shutdown.started",
      "server.shutdown.completed",
    ]);
    expect(mocks.closeLogging).toHaveBeenCalledTimes(1);
    expect(process.exit).toHaveBeenCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps running later tasks after a failure and exits with 1", async () => {
    const lifecycle = await loadLifecycle();
    let secondRan = false;
    lifecycle.registerShutdownTask(() => Promise.reject(new Error("broken")), {
      step: "broken",
    });
    lifecycle.registerShutdownTask(
      async () => {
        secondRan = true;
      },
      { step: "after" },
    );

    await lifecycle.shutdownProcess(0, "SIGTERM");

    expect(secondRan).toBe(true);
    expect(eventNames()).toEqual([
      "server.shutdown.started",
      "server.shutdown.step_failed",
      "server.shutdown.failed",
      "server.shutdown.completed",
    ]);
    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "server.shutdown.failed",
        metadata: { cleanupFailures: 1, databaseClose: "not_attempted" },
      }),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("gives a task its own budget", async () => {
    const lifecycle = await loadLifecycle();
    lifecycle.registerShutdownTask(hang, { step: "stuck", budgetMs: 200 });

    const pending = lifecycle.shutdownProcess(0, "test");
    await vi.advanceTimersByTimeAsync(200);
    await pending;

    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "server.shutdown.step_timeout",
        metadata: { step: "stuck", durationMs: 200 },
      }),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe("shutdownProcess exit handling", () => {
  it("falls back to the requested exit code when a task cleared the process code", async () => {
    const lifecycle = await loadLifecycle();
    lifecycle.registerShutdownTask(
      async () => {
        process.exitCode = undefined;
      },
      { step: "reset" },
    );

    await lifecycle.shutdownProcess(3, "custom");

    expect(process.exit).toHaveBeenCalledWith(3);
  });

  it("still exits and clears its deadline when the log flush fails", async () => {
    const lifecycle = await loadLifecycle();
    mocks.closeLogging.mockRejectedValue(new Error("flush failed"));

    await expect(lifecycle.shutdownProcess(0, "test")).rejects.toThrow(
      "flush failed",
    );

    expect(process.exit).toHaveBeenCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends the process at the deadline when a task never finishes", async () => {
    const lifecycle = await loadLifecycle();
    lifecycle.registerShutdownTask(hang, {
      step: "endless",
      budgetMs: 200_000,
    });

    void lifecycle.shutdownProcess(0, "test");
    await vi.advanceTimersByTimeAsync(79_999);
    expect(process.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(mocks.logEvent).toHaveBeenLastCalledWith({
      level: "fatal",
      event: "server.shutdown.timeout",
      component: "ProcessLifecycle",
      message: "Shutdown deadline exceeded; accepted logs may remain unflushed",
      metadata: {
        step: "endless",
        cleanupFailures: 0,
        databaseClose: "not_attempted",
      },
    });
  });

  it("ignores a second stop while one runs but lets a fatal one raise the exit code", async () => {
    const lifecycle = await loadLifecycle();
    lifecycle.registerShutdownTask(hang, { step: "endless", budgetMs: 1_000 });

    const first = lifecycle.shutdownProcess(0, "SIGTERM");
    await vi.advanceTimersByTimeAsync(0);
    expect(lifecycle.isProcessStopping()).toBe(true);
    await lifecycle.shutdownProcess(0, "SIGINT");
    expect(process.exitCode).toBe(0);
    await lifecycle.shutdownProcess(1, "uncaughtException");
    expect(process.exitCode).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await first;

    expect(
      eventNames().filter((name) => name === "server.shutdown.started"),
    ).toHaveLength(1);
    expect(process.exit).toHaveBeenCalledTimes(1);
  });
});

describe("isProcessStopping", () => {
  it("is false until a stop starts", async () => {
    const lifecycle = await loadLifecycle();

    expect(lifecycle.isProcessStopping()).toBe(false);
  });
});
