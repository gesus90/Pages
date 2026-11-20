import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ShutdownStepsModule from "./ShutdownSteps";

const logger = vi.hoisted(() => ({
  logEvent: vi.fn(),
  logCaughtError: vi.fn(),
}));

vi.mock("@/backend/logging/Logger", () => logger);

type ShutdownModule = typeof ShutdownStepsModule;

async function loadShutdownSteps(): Promise<ShutdownModule> {
  vi.resetModules();
  return import("./ShutdownSteps");
}

function hang(): Promise<void> {
  return new Promise<void>(() => undefined);
}

function sleep(durationMs: number): () => Promise<void> {
  return () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, durationMs);
    });
}

function rejectWith(reason: unknown): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    reject(reason);
  });
}

function loggedEvents(): readonly string[] {
  return logger.logEvent.mock.calls.map(
    (call: readonly { event: string }[]) => call[0]?.event ?? "",
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("shutdownProgress", () => {
  it("starts without a current step, failures or a database close attempt", async () => {
    const steps = await loadShutdownSteps();

    expect(steps.shutdownProgress()).toEqual({
      currentStep: null,
      cleanupFailures: 0,
      databaseClose: "not_attempted",
    });
  });
});

describe("runShutdownStep", () => {
  it("returns null, exposes the step name while it runs and restores the previous one", async () => {
    const steps = await loadShutdownSteps();
    let nameWhileRunning: string | null = null;

    const failure = await steps.runShutdownStep({
      step: "sessions",
      work: async () => {
        nameWhileRunning = steps.shutdownProgress().currentStep;
      },
    });

    expect(failure).toBeNull();
    expect(nameWhileRunning).toBe("sessions");
    expect(steps.shutdownProgress().currentStep).toBeNull();
    expect(logger.logEvent).not.toHaveBeenCalled();
  });

  it("reports a failing step once, counts it and returns the error", async () => {
    const steps = await loadShutdownSteps();
    const error = new Error("disk gone");

    const failure = await steps.runShutdownStep({
      step: "files",
      work: () => rejectWith(error),
    });

    expect(failure).toBe(error);
    expect(steps.shutdownProgress().cleanupFailures).toBe(1);
    expect(logger.logEvent.mock.calls[0]?.[0]).toMatchObject({
      level: "error",
      event: "server.shutdown.step_failed",
      error,
      metadata: { step: "files" },
    });
  });

  it("does not count the same error object twice", async () => {
    const steps = await loadShutdownSteps();
    const error = new Error("shared");

    await steps.runShutdownStep({ step: "one", work: () => rejectWith(error) });
    await steps.runShutdownStep({ step: "two", work: () => rejectWith(error) });

    expect(steps.shutdownProgress().cleanupFailures).toBe(1);
    expect(loggedEvents()).toEqual(["server.shutdown.step_failed"]);
  });

  it("counts every rejection with a non-object reason", async () => {
    const steps = await loadShutdownSteps();

    const first = await steps.runShutdownStep({
      step: "text",
      work: () => rejectWith("plain text"),
    });
    const second = await steps.runShutdownStep({
      step: "text",
      work: () => rejectWith("plain text"),
    });

    expect(first).toBe("plain text");
    expect(second).toBe("plain text");
    expect(steps.shutdownProgress().cleanupFailures).toBe(2);
  });

  it("substitutes an error when the step rejects with nothing", async () => {
    const steps = await loadShutdownSteps();

    const failure = await steps.runShutdownStep({
      step: "silent",
      work: () => rejectWith(undefined),
    });

    expect(failure).toBeInstanceOf(Error);
    expect(failure).toHaveProperty("message", "Shutdown step silent failed.");
    expect(steps.shutdownProgress().cleanupFailures).toBe(1);
  });
});

describe("runShutdownStep timeouts", () => {
  it("times out a stuck step at its budget and reports it", async () => {
    const steps = await loadShutdownSteps();

    const pending = steps.runShutdownStep({ step: "stuck", work: hang }, 500);
    await vi.advanceTimersByTimeAsync(499);
    expect(steps.shutdownProgress().currentStep).toBe("stuck");
    await vi.advanceTimersByTimeAsync(1);
    const failure = await pending;

    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({
      name: "ShutdownTimeoutError",
      message: "Shutdown step stuck exceeded its time budget.",
    });
    expect(steps.shutdownProgress()).toMatchObject({
      currentStep: null,
      cleanupFailures: 1,
    });
    expect(logger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "server.shutdown.step_timeout",
        metadata: { step: "stuck", durationMs: 500 },
      }),
    );
  });

  it("still logs a failure of a step that ends after its timeout", async () => {
    const steps = await loadShutdownSteps();
    let rejectLate: (reason: Error) => void = () => undefined;
    const late = new Promise<void>((resolve, reject) => {
      rejectLate = reject;
    });

    const pending = steps.runShutdownStep(
      { step: "late", work: () => late },
      100,
    );
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    const error = new Error("too late");
    rejectLate(error);
    await vi.advanceTimersByTimeAsync(0);

    expect(logger.logCaughtError).toHaveBeenCalledWith("shutdown.late", error);
  });

  it("does not report a timeout for a step that finishes within its budget", async () => {
    const steps = await loadShutdownSteps();

    const pending = steps.runShutdownStep(
      { step: "quick", work: sleep(50) },
      100,
    );
    await vi.advanceTimersByTimeAsync(50);

    await expect(pending).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(logger.logCaughtError).not.toHaveBeenCalled();
  });
});

describe("runShutdownSteps", () => {
  it("runs the steps in order and collects the failures of the failing ones", async () => {
    const steps = await loadShutdownSteps();
    const order: string[] = [];
    const error = new Error("second failed");

    const failures = await steps.runShutdownSteps([
      {
        step: "first",
        work: async () => {
          order.push("first");
        },
      },
      {
        step: "second",
        work: () => {
          order.push("second");
          return rejectWith(error);
        },
      },
      {
        step: "third",
        work: async () => {
          order.push("third");
        },
      },
    ]);

    expect(order).toEqual(["first", "second", "third"]);
    expect(failures).toEqual([error]);
  });

  it("shares one cleanup budget and still starts a step after it ran out", async () => {
    const steps = await loadShutdownSteps();
    let thirdStarted = false;

    const pending = steps.runShutdownSteps([
      { step: "slow", work: sleep(20_000) },
      { step: "stuck", work: hang },
      {
        step: "last",
        work: async () => {
          thirdStarted = true;
        },
      },
    ]);
    await vi.advanceTimersByTimeAsync(20_000);
    await vi.advanceTimersByTimeAsync(10_000);
    const failures = await pending;

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ name: "ShutdownTimeoutError" });
    expect(thirdStarted).toBe(true);
    expect(logger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { step: "stuck", durationMs: 10_000 },
      }),
    );
  });

  it("returns no failures for an empty list", async () => {
    const steps = await loadShutdownSteps();

    await expect(steps.runShutdownSteps([])).resolves.toEqual([]);
  });
});

describe("closeDatabaseForShutdown", () => {
  it("records closing while it runs and closed after the confirmation", async () => {
    const steps = await loadShutdownSteps();
    let whileClosing: unknown = null;

    const failure = await steps.closeDatabaseForShutdown(async () => {
      whileClosing = steps.shutdownProgress();
    });

    expect(failure).toBeNull();
    expect(whileClosing).toMatchObject({
      currentStep: "database_close",
      databaseClose: "closing",
    });
    expect(steps.shutdownProgress().databaseClose).toBe("closed");
    expect(logger.logEvent).toHaveBeenCalledWith({
      level: "info",
      event: "server.shutdown.database_close",
      component: "ProcessLifecycle",
      message: "The database closed during the server stop",
      metadata: { databaseClose: "closed" },
    });
  });

  it("records failed when the close rejects", async () => {
    const steps = await loadShutdownSteps();
    const error = new Error("checkpoint failed");

    const failure = await steps.closeDatabaseForShutdown(() =>
      rejectWith(error),
    );

    expect(failure).toBe(error);
    expect(steps.shutdownProgress().databaseClose).toBe("failed");
    expect(logger.logEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        level: "error",
        message:
          "The database did not confirm its close during the server stop",
        metadata: { databaseClose: "failed" },
      }),
    );
  });

  it("records timed_out after its own 45 second budget and never claims a close", async () => {
    const steps = await loadShutdownSteps();

    const pending = steps.closeDatabaseForShutdown(hang);
    await vi.advanceTimersByTimeAsync(
      steps.SHUTDOWN_LIMITS.databaseCloseBudgetMs,
    );
    const failure = await pending;

    expect(failure).toMatchObject({ name: "ShutdownTimeoutError" });
    expect(steps.shutdownProgress().databaseClose).toBe("timed_out");
  });
});

describe("throwShutdownFailures", () => {
  it("does nothing without failures", async () => {
    const steps = await loadShutdownSteps();

    expect(() => {
      steps.throwShutdownFailures([]);
    }).not.toThrow();
  });

  it("throws a single failure itself", async () => {
    const steps = await loadShutdownSteps();
    const error = new Error("only one");

    expect(() => {
      steps.throwShutdownFailures([error]);
    }).toThrow(error);
  });

  it("throws an AggregateError of several failures that is not counted again", async () => {
    const steps = await loadShutdownSteps();
    const first = new Error("first");
    const second = new Error("second");

    const failure = await steps.runShutdownStep({
      step: "composed",
      work: async () => {
        steps.throwShutdownFailures([first, second]);
      },
    });

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({
      message: "Several shutdown steps failed.",
      errors: [first, second],
    });
    expect(steps.shutdownProgress().cleanupFailures).toBe(0);
    expect(logger.logEvent).not.toHaveBeenCalled();
  });
});
