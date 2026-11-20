import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type * as LoggerModule from "./Logger";
import type * as PinoModule from "pino";
import type * as LogFallbackModule from "./LogFallback";
import type { LoggingStatus } from "@/definition/Logging";

interface RetentionRecord {
  readonly directory: string;
  readonly emit: (event: LoggerModule.ServerLogEvent) => void;
  readonly updates: { readonly days: number; readonly reason: string }[];
  closed: number;
}

const sink = vi.hoisted(() => {
  const state: {
    appended: { line: string; date: string }[];
    started: string[];
    fallback: string[];
    streams: { write(line: string): void }[];
    serializationLosses: number;
    writerClosed: number;
    writerStatus: LoggingStatus;
    retentions: RetentionRecord[];
  } = {
    appended: [],
    started: [],
    fallback: [],
    streams: [],
    serializationLosses: 0,
    writerClosed: 0,
    writerStatus: {
      state: "healthy",
      queuedEntries: 0,
      lostEntries: 0,
      failureCode: null,
    },
    retentions: [],
  };
  return state;
});

vi.mock("./DailyLogWriter", () => ({
  DailyLogWriter: class {
    /** Records the directory the logger asked the writer to own. */
    public async start(directory: string): Promise<void> {
      sink.started.push(directory);
    }

    /** Records a line the logger handed to the daily writer. */
    public append(line: string, date: string): void {
      sink.appended.push({ line, date });
    }

    /** Returns the writer status configured by the test. */
    public status(): LoggingStatus {
      return sink.writerStatus;
    }

    /** Counts a serialization loss reported by the logger. */
    public recordSerializationLoss(): void {
      sink.serializationLosses += 1;
    }

    /** Records that the logger closed the writer. */
    public async close(): Promise<void> {
      sink.writerClosed += 1;
    }
  },
}));

vi.mock("./LogRetention", () => ({
  LogRetention: class {
    /** Records the retention job the logger created with its emitter. */
    public constructor(
      directory: string,
      writer: unknown,
      emit: (event: LoggerModule.ServerLogEvent) => void,
    ) {
      void writer;
      sink.retentions.push({ directory, emit, updates: [], closed: 0 });
    }

    /** Records a retention setting the logger applied. */
    public async update(days: number, reason: string): Promise<void> {
      sink.retentions.at(-1)?.updates.push({ days, reason });
    }

    /** Records that the logger closed the retention job. */
    public async close(): Promise<void> {
      const retention = sink.retentions.at(-1);
      if (retention) retention.closed += 1;
    }
  },
}));

vi.mock("./LogFallback", async (importOriginal) => {
  const actual = await importOriginal<typeof LogFallbackModule>();
  return {
    ...actual,
    writeLogFallback: (line: string) => {
      sink.fallback.push(line);
    },
  };
});

vi.mock("pino", async (importOriginal) => {
  const actual = await importOriginal<typeof PinoModule>();
  return {
    default: (...args: Parameters<typeof actual.default>) => {
      const destination = args[1];
      if (destination) sink.streams.push(destination);
      return actual.default(...args);
    },
  };
});

/**
 * Types a Vitest asymmetric matcher as unknown, so that it can sit inside an
 * expected object without being typed as any.
 */
function asserted(matcher: unknown): unknown {
  return matcher;
}

/** Loads a fresh logger with the given environment, so that startup settings apply. */
async function loadLogger(
  environment: Readonly<Record<string, string>> = {},
): Promise<typeof LoggerModule> {
  vi.resetModules();
  for (const [name, value] of Object.entries(environment)) {
    vi.stubEnv(name, value);
  }
  return import("./Logger");
}

/** Returns every record appended to the daily writer as parsed JSON. */
function appendedRecords(): Record<string, unknown>[] {
  return sink.appended.map(
    ({ line }) => JSON.parse(line) as Record<string, unknown>,
  );
}

/** Returns the latest record appended to the daily writer. */
function lastRecord(): Record<string, unknown> {
  const record = appendedRecords().at(-1);
  if (!record) throw new Error("No record was appended");
  return record;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date(2026, 10, 20, 10, 0, 0));
  for (const name of ["PAGES_LOG_LEVEL", "PAGES_CORRELATION_ID"]) {
    vi.stubEnv(name, undefined);
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  sink.appended.length = 0;
  sink.started.length = 0;
  sink.fallback.length = 0;
  sink.streams.length = 0;
  sink.serializationLosses = 0;
  sink.writerClosed = 0;
  sink.retentions.length = 0;
});

it("writes a structured record with schema, severity and the instance identity", async () => {
  const logger = await loadLogger();

  logger.logEvent({
    level: "info",
    event: "plan.started",
    component: "Plans",
    message: "Plan started",
  });

  expect(lastRecord()).toEqual({
    schemaVersion: 1,
    severity: "info",
    event: "plan.started",
    component: "Plans",
    message: "Plan started",
    pid: process.pid,
    instanceId: asserted(expect.any(String)),
    time: asserted(expect.any(String)),
    metadata: {},
  });
  expect(sink.appended[0]?.date).toBe("2026-11-20");
});

it("drops events below the configured level and enables the lower level on request", async () => {
  const quiet = await loadLogger();
  quiet.logEvent({ level: "debug", event: "x", component: "C", message: "m" });
  expect(sink.appended).toEqual([]);

  const verbose = await loadLogger({ PAGES_LOG_LEVEL: "debug" });
  verbose.logEvent({
    level: "debug",
    event: "x",
    component: "C",
    message: "m",
  });
  expect(lastRecord()).toMatchObject({ severity: "debug" });
});

it("keeps only allowlisted metadata, safe context and redacted text", async () => {
  const logger = await loadLogger();

  logger.withLogContext({ requestId: "request-1", runId: "run-1" }, () => {
    logger.logEvent({
      level: "info",
      event: "request.done",
      component: "Routes",
      message: "Bearer abc123 finished",
      metadata: {
        statusCode: 500,
        password: "hunter2",
        body: "private text",
        note: "free text",
      },
    });
  });

  expect(lastRecord()).toMatchObject({
    requestId: "request-1",
    runId: "run-1",
    message: "[REDACTED] finished",
    metadata: { statusCode: 500, truncated: true },
  });
});

it("sanitizes event and component names and bounds their length", async () => {
  const logger = await loadLogger();

  logger.logEvent({
    level: "info",
    event: "bad name!/x",
    component: "C".repeat(100),
    message: "m",
  });
  logger.logEvent({
    level: "info",
    event: "e".repeat(200),
    component: "Plans",
    message: "m",
  });

  const [first, second] = appendedRecords();
  expect(first).toMatchObject({ event: "bad_name__x" });
  expect(first?.component).toBe("C".repeat(80));
  expect(second?.event).toBe("e".repeat(120));
});

it("attaches an error once and later refers to it by its identifier", async () => {
  const logger = await loadLogger();
  const failure = new Error("boom");

  logger.logEvent({
    level: "error",
    event: "a",
    component: "C",
    message: "m",
    error: failure,
  });
  logger.logEvent({
    level: "warn",
    event: "b",
    component: "C",
    message: "m",
    error: failure,
  });
  logger.logEvent({
    level: "info",
    event: "c",
    component: "C",
    message: "m",
    error: "text",
  });
  logger.logEvent({ level: "info", event: "d", component: "C", message: "m" });

  const [first, second, third, fourth] = appendedRecords();
  expect(first).toMatchObject({
    errorId: asserted(expect.any(String)),
    error: asserted(expect.objectContaining({ type: "Error" })),
  });
  expect(second).toMatchObject({
    errorId: first?.errorId,
    errorPreviouslyReported: true,
  });
  expect(second).not.toHaveProperty("error");
  expect(third).toMatchObject({
    error: asserted(expect.objectContaining({ type: "NonError" })),
  });
  expect(fourth).not.toHaveProperty("errorId");
});

it("keeps the event when its payload cannot be serialized and reports the loss", async () => {
  const logger = await loadLogger();
  const hostileMetadata = new Proxy<Record<string, unknown>>(
    {},
    {
      ownKeys(): never {
        throw new Error("metadata cannot be enumerated");
      },
    },
  );

  logger.logEvent({
    level: "info",
    event: "payload.bad",
    component: "C",
    message: "m",
    metadata: hostileMetadata,
  });

  expect(sink.serializationLosses).toBe(1);
  expect(lastRecord()).toMatchObject({
    severity: "error",
    event: "logging.serialization.failed",
    message: "Event serialization failed; payload omitted",
  });
  expect(sink.fallback).toEqual([sink.appended[0]?.line]);
});

it("bounds an oversized record and keeps its capture date", async () => {
  await loadLogger();
  const time = "2026-11-19T23:30:00.000Z";
  const stream = sink.streams[0];
  if (!stream) throw new Error("The logger stream was not created");

  stream.write(
    `${JSON.stringify({ time, severity: "info", event: "big", message: "x".repeat(40_000) })}\n`,
  );

  expect(sink.appended).toEqual([
    {
      line: asserted(
        expect.stringContaining(
          '"message":"Oversized event; details truncated"',
        ),
      ),
      date: asserted(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u)),
    },
  ]);
  expect(lastRecord()).toMatchObject({
    time,
    error: { type: "TruncatedError", truncated: true },
    metadata: { truncated: true },
  });
});

it("ignores stream lines that are not timestamped records", async () => {
  await loadLogger();
  const stream = sink.streams[0];
  if (!stream) throw new Error("The logger stream was not created");

  stream.write("5\n");
  stream.write("null\n");
  stream.write('{"message":"without time"}\n');
  stream.write('{"time":5}\n');
  expect(sink.appended).toEqual([]);

  stream.write(`${JSON.stringify({ time: "2026-11-20T10:00:00.000Z" })}\n`);
  expect(sink.appended).toHaveLength(1);
});

it("forwards plan-run lines of enabled levels to the run log store", async () => {
  const logger = await loadLogger();
  const runLog = await import("./RunLogSink");
  const listener = vi.fn<(record: unknown) => void>();
  const unregister = runLog.registerRunLogSink(listener);

  logger.withLogContext(
    { runId: "run-1", stepId: "step-1", attemptId: "attempt-1" },
    () => {
      logger.logEvent({
        level: "warn",
        event: "x",
        component: "Runner",
        message: "hello",
      });
    },
  );
  logger.withLogContext({ runId: "run-2" }, () => {
    logger.logEvent({
      level: "fatal",
      event: "y",
      component: "Runner",
      message: "failed",
    });
  });
  logger.logEvent({
    level: "error",
    event: "z",
    component: "Runner",
    message: "no run",
  });
  logger.withLogContext({ runId: "run-3", jobId: "job-1" }, () => {
    logger.logEvent({
      level: "error",
      event: "j",
      component: "Runner",
      message: "job",
    });
  });
  unregister();

  const forwarded = listener.mock.calls.map(([record]) => record);
  expect(forwarded).toEqual([
    {
      runId: "run-1",
      stepId: "step-1",
      attemptId: "attempt-1",
      at: asserted(expect.any(String)),
      level: "warn",
      source: "server",
      message: "Runner: hello",
    },
    {
      runId: "run-2",
      stepId: null,
      attemptId: null,
      at: asserted(expect.any(String)),
      level: "error",
      source: "server",
      message: "Runner: failed",
    },
  ]);
});

it("never forwards trace lines, even when the trace level is enabled", async () => {
  const logger = await loadLogger({ PAGES_LOG_LEVEL: "trace" });
  const runLog = await import("./RunLogSink");
  const listener = vi.fn();
  const unregister = runLog.registerRunLogSink(listener);

  logger.withLogContext({ runId: "run-1" }, () => {
    logger.logEvent({
      level: "trace",
      event: "t",
      component: "Runner",
      message: "trace",
    });
  });
  unregister();

  expect(lastRecord()).toMatchObject({ severity: "trace" });
  expect(listener).not.toHaveBeenCalled();
});
