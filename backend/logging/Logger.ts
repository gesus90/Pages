import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import path from "node:path";

import pino from "pino";

import { DailyLogWriter } from "./DailyLogWriter";
import { takeUnscopedDatabaseLogMetrics } from "./DatabaseLogMetrics";
import { logDate, LOG_TIME_ZONE } from "./LogCalendar";
import { serializeLogError } from "./LogError";
import { loggingFailureCode, writeLogFallback } from "./LogFallback";
import { redactLogText, safeLogMetadata } from "./LogRedaction";
import { LogRetention } from "./LogRetention";
import { isPollingLogContext } from "./PollingLogPolicy";

import type { LoggingStatus } from "@/definition/Logging";

/** Correlation facts propagated through asynchronous work, never request payloads. */
export interface LogContext {
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly runId?: string;
  readonly jobId?: string;
  readonly attemptId?: string;
}

/** Stable, structured operational event. Metadata is centrally allowlisted. */
export interface ServerLogEvent {
  readonly level: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  readonly event: string;
  readonly component: string;
  readonly message: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly error?: unknown;
}

const instanceId = randomUUID();
const context = new AsyncLocalStorage<LogContext>();
const writer = new DailyLogWriter(instanceId);
const reportedErrors = new WeakMap<object, string>();
let retention: LogRetention | null = null;
let databaseMetricsTimer: NodeJS.Timeout | null = null;

function flushUnscopedDatabaseMetrics(): void {
  const summary = takeUnscopedDatabaseLogMetrics();
  if (summary === null) return;
  logEvent({
    level: "trace",
    event: "database.operations.completed",
    component: "Database",
    message: "Unscoped database operation totals",
    metadata: { ...summary, source: "unscoped", jobId: randomUUID() },
  });
}

const logger = pino(
  {
    level: "trace",
    base: { schemaVersion: 1, pid: process.pid, instanceId },
    timestamp: false,
    messageKey: "message",
    formatters: { level: (severity) => ({ severity }) },
  },
  {
    write(line: string): void {
      const record: unknown = JSON.parse(line);
      if (
        typeof record !== "object" ||
        record === null ||
        !("time" in record) ||
        typeof record.time !== "string"
      )
        return;
      const bounded =
        Buffer.byteLength(line) > 32_768 ? boundRecord(record) : line;
      writer.append(bounded, logDate(new Date(record.time)));
    },
  },
);

function boundRecord(record: object): string {
  const bounded = {
    ...record,
    message: "Oversized event; details truncated",
    metadata: { truncated: true },
    error: {
      type: "TruncatedError",
      message: "Entry exceeded 32 KiB; diagnostic omitted",
      code: null,
      stack: "",
      truncated: true,
    },
  };
  return `${JSON.stringify(bounded)}\n`;
}

/** Emits all severities without sampling, using bounded safe metadata and error chains. */
export function logEvent(event: ServerLogEvent): void {
  try {
    const errorId = identifyError(event.error);
    logger[event.level](
      {
        time: new Date().toISOString(),
        event: event.event.replace(/[^a-zA-Z0-9_.-]/gu, "_").slice(0, 120),
        component: event.component
          .replace(/[^a-zA-Z0-9_.-]/gu, "_")
          .slice(0, 80),
        ...safeLogMetadata({ ...context.getStore() }),
        metadata: safeLogMetadata(event.metadata),
        ...(errorId === null
          ? {}
          : {
              errorId: errorId.id,
              ...(errorId.isNew
                ? { error: serializeLogError(event.error) }
                : { errorPreviouslyReported: true }),
            }),
      },
      redactLogText(event.message),
    );
  } catch {
    writer.recordSerializationLoss();
    const captured = new Date();
    const line = `${JSON.stringify({ schemaVersion: 1, time: captured.toISOString(), severity: "error", event: "logging.serialization.failed", component: "Logger", message: "Event serialization failed; payload omitted", pid: process.pid, instanceId })}\n`;
    writeLogFallback(line);
    writer.append(line, logDate(captured));
  }
}

function identifyError(
  error: unknown,
): { readonly id: string; readonly isNew: boolean } | null {
  if (error === undefined) return null;
  if (typeof error !== "object" || error === null)
    return { id: randomUUID(), isNew: true };
  const existing = reportedErrors.get(error);
  if (existing) return { id: existing, isNew: false };
  const id = randomUUID();
  reportedErrors.set(error, id);
  return { id, isNew: true };
}

/** Migrates existing diagnostics without dumping extra console arguments or provider output. */
export function logDiagnostic(
  component: string,
  level: ServerLogEvent["level"],
  message: string,
  error?: unknown,
): void {
  logEvent({
    component,
    level,
    event: `${component}.diagnostic.${level}`,
    message,
    error,
  });
  if (level === "trace" || level === "fatal") return;
  const argumentsList: unknown[] = [
    redactLogText(message),
    ...(error === undefined ? [] : [serializeLogError(error)]),
  ];
  if (level === "error") console.error(...argumentsList);
  else if (level === "warn") console.warn(...argumentsList);
  else if (level === "debug") console.debug(...argumentsList);
  else console.info(...argumentsList);
}

function controlResponseStatus(error: unknown): number | null {
  try {
    return error instanceof Response ? error.status : null;
  } catch {
    // A revoked/hostile proxy can throw even during instanceof inspection.
    return null;
  }
}

/** Captures a recovered exception once, before domain code translates or suppresses it. */
export function logCaughtError(component: string, error: unknown): void {
  if (typeof error === "object" && error !== null && reportedErrors.has(error))
    return;
  const status = controlResponseStatus(error);
  if (status !== null) {
    if (status >= 200 && status < 400 && isPollingLogContext()) return;
    logEvent({
      level: "debug",
      event: "application.control_response",
      component,
      message: "Caught HTTP control response",
      metadata: { statusCode: status },
    });
    return;
  }
  logEvent({
    level: "debug",
    event: "application.exception.caught",
    component,
    message: "Application exception caught; the caller decides recovery",
    error,
  });
}

/** Reports failed existence probes except expected missing paths; required-file reads use logCaughtError. */
export function logFileProbeError(component: string, error: unknown): void {
  const code = loggingFailureCode(error);
  if (code === "ENOENT" || code === "ENOTDIR") return;
  logCaughtError(component, error);
}

/** Runs a callback with inherited, isolated async correlation; no global mutable request ID. */
export function withLogContext<Result>(
  facts: LogContext,
  work: () => Result,
): Result {
  return context.run({ ...context.getStore(), ...facts }, work);
}

/** Configures the directory before reading configuration, preserving queued bootstrap events. */
export async function initializeLogging(configPath: string): Promise<void> {
  const directory = path.join(path.dirname(configPath), "log");
  await writer.start(directory);
  retention ??= new LogRetention(directory, writer, logEvent);
  databaseMetricsTimer ??= setInterval(flushUnscopedDatabaseMetrics, 5_000);
  databaseMetricsTimer.unref();
  logEvent({
    level: "info",
    event: "logging.initialized",
    component: "Logger",
    message: "Instance logging initialized",
    metadata: { timeZone: LOG_TIME_ZONE },
  });
}

/** Applies the successfully persisted setting without a process restart. */
export async function updateLogRetention(
  days: number,
  reason = "configuration",
): Promise<void> {
  await retention?.update(days, reason);
}

/** Returns the safe writer health for administrator-only settings. */
export function readLoggingStatus(): LoggingStatus {
  return writer.status();
}

/** Flushes the accepted queue, synchronizes the daily file and releases the ownership lock. */
export async function closeLogging(): Promise<void> {
  if (databaseMetricsTimer !== null) clearInterval(databaseMetricsTimer);
  databaseMetricsTimer = null;
  flushUnscopedDatabaseMetrics();
  await retention?.close();
  await writer.close();
}
