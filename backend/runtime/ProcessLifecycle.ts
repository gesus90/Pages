import {
  logCaughtError,
  closeLogging,
  logEvent,
} from "@/backend/logging/Logger";

const tasks: (() => Promise<void>)[] = [];
let isInstalled = false;
let isStopping = false;

/** Adds ordered cleanup before the central writer is flushed and closed. */
export function registerShutdownTask(task: () => Promise<void>): void {
  tasks.push(task);
}

/** Installs fatal and signal handling before configuration and service initialization. */
export function installProcessLogging(): void {
  if (isInstalled) return;
  isInstalled = true;
  process.once("SIGINT", () => {
    void shutdownProcess(0, "SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdownProcess(0, "SIGTERM");
  });
  process.on("uncaughtException", (error) => {
    void shutdownProcess(1, "uncaughtException", error);
  });
  process.on("unhandledRejection", (error: unknown) => {
    void shutdownProcess(1, "unhandledRejection", error);
  });
}

/** Stops normal operation after a fatal error, with a bounded best-effort flush. */
export async function shutdownProcess(
  exitCode: number,
  reason: string,
  error?: unknown,
): Promise<void> {
  if (isStopping) {
    if (exitCode !== 0) process.exitCode = exitCode;
    return;
  }
  isStopping = true;
  process.exitCode = exitCode;
  logEvent({
    level: exitCode === 0 ? "info" : "fatal",
    event: "server.shutdown.started",
    component: "ProcessLifecycle",
    message: "Server shutdown started",
    error,
    metadata: { reason, exitCode },
  });
  const deadline = setTimeout(() => {
    logEvent({
      level: "fatal",
      event: "server.shutdown.timeout",
      component: "ProcessLifecycle",
      message: "Shutdown deadline exceeded; accepted logs may remain unflushed",
    });
    process.exit(1);
  }, 30_000);
  try {
    for (const task of tasks) await task();
  } catch (cleanupError: unknown) {
    logCaughtError("ProcessLifecycle", cleanupError);

    process.exitCode = 1;
    logEvent({
      level: "error",
      event: "server.shutdown.failed",
      component: "ProcessLifecycle",
      message: "Server cleanup failed",
      error: cleanupError,
    });
  }
  try {
    logEvent({
      level: "info",
      event: "server.shutdown.completed",
      component: "ProcessLifecycle",
      message: "Server cleanup completed",
    });
    await closeLogging();
  } finally {
    clearTimeout(deadline);
    process.exit(process.exitCode ?? exitCode);
  }
}
