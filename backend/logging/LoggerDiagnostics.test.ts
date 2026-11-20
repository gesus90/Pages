import path from "node:path";

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

it("keeps the default level and warns once when the configured level is unknown", async () => {
  const logger = await loadLogger({ PAGES_LOG_LEVEL: "verbose" });

  await logger.initializeLogging(path.join("/srv/pages", "config.toml"));

  const events = appendedRecords().map((record) => record.event);
  expect(events).toEqual(["logging.initialized", "logging.level.invalid"]);
  expect(lastRecord()).toMatchObject({
    severity: "warn",
    message: asserted(expect.stringContaining("using info")),
  });
});

it("writes under the instance log directory or the requested subdirectory", async () => {
  const logger = await loadLogger();

  await logger.initializeLogging(path.join("/srv/pages", "config.toml"));
  await logger.initializeLogging(
    path.join("/srv/pages", "config.toml"),
    "entrance",
  );

  expect(sink.started).toEqual([
    path.join("/srv/pages", "log"),
    path.join("/srv/pages", "log", "entrance"),
  ]);
});

it("writes diagnostics to the matching console channel with redacted text", async () => {
  const logger = await loadLogger();
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  const consoleWarn = vi
    .spyOn(console, "warn")
    .mockImplementation(() => undefined);
  const consoleInfo = vi
    .spyOn(console, "info")
    .mockImplementation(() => undefined);
  const consoleDebug = vi
    .spyOn(console, "debug")
    .mockImplementation(() => undefined);

  logger.logDiagnostic(
    "Runner",
    "error",
    "failed with token=abc123",
    new Error("x"),
  );
  logger.logDiagnostic("Runner", "warn", "slow");
  logger.logDiagnostic("Runner", "info", "started");
  logger.logDiagnostic("Runner", "debug", "hidden at info level");
  logger.logDiagnostic("Runner", "trace", "never printed");
  logger.logDiagnostic("Runner", "fatal", "fatal goes to logs only");

  expect(consoleError).toHaveBeenCalledWith(
    "failed with token=[REDACTED]",
    asserted(expect.objectContaining({ type: "Error" })),
  );
  expect(consoleWarn).toHaveBeenCalledWith("slow");
  expect(consoleInfo).toHaveBeenCalledWith("started");
  expect(consoleDebug).not.toHaveBeenCalled();
  expect(appendedRecords().map((record) => record.event)).toContain(
    "Runner.diagnostic.fatal",
  );
});

it("prints debug diagnostics only when the debug level is enabled", async () => {
  const logger = await loadLogger({ PAGES_LOG_LEVEL: "debug" });
  const consoleDebug = vi
    .spyOn(console, "debug")
    .mockImplementation(() => undefined);

  logger.logDiagnostic("Runner", "debug", "visible");

  expect(consoleDebug).toHaveBeenCalledWith("visible");
});

it("records control responses at debug level and skips successful polling responses", async () => {
  const logger = await loadLogger({ PAGES_LOG_LEVEL: "debug" });
  const polling = await import("./PollingLogPolicy");

  logger.logCaughtError("Routes", new Response(null, { status: 404 }));
  polling.withPollingLogPolicy(true, () => {
    logger.logCaughtError("Routes", new Response(null, { status: 200 }));
  });
  polling.withPollingLogPolicy(true, () => {
    logger.logCaughtError("Routes", new Response(null, { status: 500 }));
  });
  logger.logCaughtError("Routes", new Response(null, { status: 302 }));

  expect(appendedRecords()).toEqual([
    asserted(
      expect.objectContaining({
        event: "application.control_response",
        severity: "debug",
        metadata: { statusCode: 404 },
      }),
    ),
    asserted(
      expect.objectContaining({
        event: "application.control_response",
        metadata: { statusCode: 500 },
      }),
    ),
    asserted(
      expect.objectContaining({
        event: "application.control_response",
        metadata: { statusCode: 302 },
      }),
    ),
  ]);
});

it("does not report an error that was already reported", async () => {
  const logger = await loadLogger();
  const failure = new Error("reported");
  logger.logEvent({
    level: "error",
    event: "first",
    component: "C",
    message: "m",
    error: failure,
  });
  const before = sink.appended.length;

  logger.logCaughtError("C", failure);

  expect(sink.appended).toHaveLength(before);
});

it("records a recovered exception at its level with a fallback correlation only without context", async () => {
  const logger = await loadLogger();

  logger.logCaughtError("Plans", new Error("db"), "warn", "fallback-trace");
  expect(lastRecord()).toMatchObject({
    severity: "warn",
    event: "application.exception.caught",
    metadata: { correlationId: "fallback-trace" },
  });

  logger.withLogContext({ correlationId: "context-trace" }, () => {
    logger.logCaughtError("Plans", new Error("db"), "info", "fallback-trace");
  });
  expect(lastRecord()).toMatchObject({
    correlationId: "context-trace",
    metadata: {},
  });
});

it("reports a hostile error that cannot be inspected as a serialization error", async () => {
  const logger = await loadLogger();
  const hostile = new Proxy<object>(
    {},
    {
      getPrototypeOf(): never {
        throw new Error("proxy trap failed");
      },
    },
  );

  logger.logCaughtError("Plans", hostile, "error");

  expect(lastRecord()).toMatchObject({
    event: "application.exception.caught",
    error: { type: "SerializationError" },
  });
});

it("logs file probe failures other than expected missing paths", async () => {
  const logger = await loadLogger({ PAGES_LOG_LEVEL: "debug" });

  logger.logFileProbeError(
    "Storage",
    Object.assign(new Error("gone"), { code: "ENOENT" }),
  );
  logger.logFileProbeError(
    "Storage",
    Object.assign(new Error("file"), { code: "ENOTDIR" }),
  );
  logger.logFileProbeError(
    "Storage",
    Object.assign(new Error("denied"), { code: "EACCES" }),
  );

  expect(appendedRecords()).toEqual([
    asserted(
      expect.objectContaining({
        event: "application.exception.caught",
        error: asserted(expect.objectContaining({ code: "EACCES" })),
      }),
    ),
  ]);
});

it("uses the parent correlation and merges nested context facts", async () => {
  const inherited = await loadLogger({ PAGES_CORRELATION_ID: "parent-trace" });

  inherited.logEvent({
    level: "info",
    event: "a",
    component: "C",
    message: "m",
  });
  expect(lastRecord()).toMatchObject({ correlationId: "parent-trace" });
  expect(inherited.captureLogContext()).toEqual({
    correlationId: "parent-trace",
  });

  const merged = inherited.withLogContext({ requestId: "r-1" }, () =>
    inherited.withLogContext({ jobId: "job-1" }, () =>
      inherited.currentLogContext(),
    ),
  );
  expect(merged).toEqual({
    correlationId: "parent-trace",
    requestId: "r-1",
    jobId: "job-1",
  });
});

it("ignores a parent correlation that is not a valid identifier", async () => {
  const logger = await loadLogger({ PAGES_CORRELATION_ID: "bad id!" });

  expect(logger.currentLogContext()).toEqual({});
  const captured = logger.withLogContext({ correlationId: "kept" }, () =>
    logger.captureLogContext(),
  );
  expect(captured).toEqual({ correlationId: "kept" });
});

it("assigns a new correlation identifier to work without a trigger", async () => {
  const logger = await loadLogger();

  const captured = logger.captureLogContext();

  expect(captured.correlationId).toMatch(/^[0-9a-f-]{36}$/u);
});

it("applies retention settings only after logging is initialized", async () => {
  const logger = await loadLogger();
  await logger.updateLogRetention(7);
  expect(sink.retentions).toEqual([]);

  await logger.initializeLogging(path.join("/srv/pages", "config.toml"));
  await logger.updateLogRetention(14, "settings");
  await logger.updateLogRetention(3);

  expect(sink.retentions[0]?.updates).toEqual([
    { days: 14, reason: "settings" },
    { days: 3, reason: "configuration" },
  ]);
  sink.retentions[0]?.emit({
    level: "info",
    event: "logging.cleanup.completed",
    component: "LogRetention",
    message: "Retention finished",
  });
  expect(lastRecord()).toMatchObject({ event: "logging.cleanup.completed" });
});

it("creates one retention job and one database flush timer for repeated initialization", async () => {
  const logger = await loadLogger();

  await logger.initializeLogging(path.join("/srv/pages", "config.toml"));
  await logger.initializeLogging(path.join("/srv/pages", "config.toml"));

  expect(sink.retentions).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(1);
  await logger.closeLogging();
});

it("reports the writer status for administrators", async () => {
  const logger = await loadLogger();
  sink.writerStatus = {
    state: "degraded",
    queuedEntries: 3,
    lostEntries: 1,
    failureCode: "LOG_WRITER_BUSY",
  };

  expect(logger.readLoggingStatus()).toBe(sink.writerStatus);
});

it("flushes unscoped database totals on each tick and at close", async () => {
  const logger = await loadLogger({ PAGES_LOG_LEVEL: "trace" });
  const metrics = await import("./DatabaseLogMetrics");
  await logger.initializeLogging(path.join("/srv/pages", "config.toml"));

  metrics.recordDatabaseLogMetrics("select", "statement-a", 3);
  await vi.advanceTimersByTimeAsync(5_000);
  const afterTick = sink.appended.length;
  await vi.advanceTimersByTimeAsync(5_000);
  expect(sink.appended).toHaveLength(afterTick);
  expect(
    appendedRecords().find(
      (record) => record.event === "database.operations.completed",
    ),
  ).toMatchObject({
    severity: "trace",
    metadata: asserted(
      expect.objectContaining({
        databaseQueries: 1,
        source: "unscoped",
      }),
    ),
  });

  metrics.recordDatabaseLogMetrics("update", "statement-b", 1);
  await logger.closeLogging();

  expect(vi.getTimerCount()).toBe(0);
  expect(sink.writerClosed).toBe(1);
  expect(sink.retentions[0]?.closed).toBe(1);
});

it("closes an uninitialized logger without a retention job or timer", async () => {
  const logger = await loadLogger();

  await logger.closeLogging();

  expect(sink.writerClosed).toBe(1);
  expect(sink.retentions).toEqual([]);
});
