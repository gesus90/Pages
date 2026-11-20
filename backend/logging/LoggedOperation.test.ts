import { afterEach, expect, it, vi } from "vitest";

import { recordDatabaseLogMetrics } from "./DatabaseLogMetrics";
import { loggedJob, loggedOperation } from "./LoggedOperation";

import type { LogContext, ServerLogEvent } from "./Logger";
import type * as NodeCrypto from "node:crypto";

const logging = vi.hoisted(() => ({
  events: [] as ServerLogEvent[],
  contexts: [] as LogContext[],
  jobId: "job-fixed",
}));

vi.mock("./Logger", () => ({
  captureLogContext: () => ({ correlationId: "captured-trace" }),
  logEvent: (event: ServerLogEvent) => {
    logging.events.push(event);
  },
  withLogContext: <Result>(facts: LogContext, work: () => Result): Result => {
    logging.contexts.push(facts);
    return work();
  },
}));

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  return { ...actual, randomUUID: () => logging.jobId };
});

afterEach(() => {
  logging.events.length = 0;
  logging.contexts.length = 0;
});

it("logs a started and a completed event with its database totals", async () => {
  const clock = vi.spyOn(performance, "now");
  clock.mockReturnValueOnce(100).mockReturnValueOnce(175);

  const result = await loggedOperation("Plans", "plan.sync", async () => {
    recordDatabaseLogMetrics("select", "statement-1", 4);
    return "done";
  });

  expect(result).toBe("done");
  expect(logging.events.map((event) => event.event)).toEqual([
    "plan.sync.started",
    "plan.sync.completed",
  ]);
  expect(logging.events[0]).toMatchObject({
    level: "debug",
    component: "Plans",
    metadata: { operation: "plan.sync" },
  });
  expect(logging.events[1]).toMatchObject({
    level: "info",
    component: "Plans",
    metadata: {
      operation: "plan.sync",
      durationMs: 75,
      databaseQueries: 1,
      databaseTotalMs: 4,
    },
  });
});

it("runs the work inside the captured trace and the supplied facts", async () => {
  await loggedOperation("Plans", "plan.sync", async () => undefined, {
    runId: "run-9",
  });

  expect(logging.contexts).toEqual([
    { correlationId: "captured-trace", runId: "run-9" },
  ]);
});

it("uses an empty fact set when the caller supplies none", async () => {
  await loggedOperation("Plans", "plan.sync", async () => undefined);

  expect(logging.contexts).toEqual([{ correlationId: "captured-trace" }]);
});

it("logs a failure with its error and rethrows the same error", async () => {
  const failure = new Error("sync failed");
  vi.spyOn(performance, "now").mockReturnValueOnce(10).mockReturnValueOnce(35);

  await expect(
    loggedOperation("Plans", "plan.sync", async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);

  const failedEvent = logging.events.at(-1);
  expect(logging.events.map((event) => event.event)).toEqual([
    "plan.sync.started",
    "plan.sync.failed",
  ]);
  expect(failedEvent).toMatchObject({
    level: "error",
    error: failure,
    metadata: { operation: "plan.sync", durationMs: 25 },
  });
});

it("gives every scheduled job its own job identifier", async () => {
  logging.jobId = "job-42";

  await loggedJob("Scheduler", "github.sync", async () => "ok");

  expect(logging.contexts).toEqual([
    { correlationId: "captured-trace", jobId: "job-42" },
  ]);
  expect(logging.events[0]?.event).toBe("github.sync.started");
});
