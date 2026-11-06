import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { closeLogging, logEvent } from "@/backend/logging/Logger";

import {
  runShutdownStep,
  SHUTDOWN_LIMITS,
  shutdownProgress,
} from "./ShutdownSteps";

import type { ShutdownStep } from "./ShutdownSteps";

/** How a registered task is named and how long the stop waits for it. */
export interface ShutdownTaskOptions {
  /** Fixed name in the logs. */
  readonly step: string;
  /** Longest wait; by default what remains of the shared cleanup budget. */
  readonly budgetMs?: number;
}

type ShutdownTask = ShutdownStep & Pick<ShutdownTaskOptions, "budgetMs">;

const tasks: ShutdownTask[] = [];
let isInstalled = false;
let isStopping = false;

/** Lets readiness probes stop renewing systemd before shutdown starts draining services. */
export function isProcessStopping(): boolean {
  return isStopping;
}

/**
 * Adds ordered cleanup before the central writer is flushed and closed.
 *
 * @param task - The cleanup; its failure does not keep later tasks from running.
 * @param options - Its name in the logs and its time budget.
 */
export function registerShutdownTask(
  task: () => Promise<void>,
  options: ShutdownTaskOptions,
): void {
  tasks.push({ work: task, ...options });
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

/**
 * Stops normal operation after a signal or a fatal error, with bounded cleanup and flush.
 *
 * @remarks
 * Node runs an `unhandledRejection` handler in the async context of the
 * rejected promise. A stop started there would inherit the abort signal of a
 * closed request and every database job of the cleanup would be refused
 * (PAGE-199), so the stop runs in a neutral context. Its log correlation stays.
 */
export function shutdownProcess(
  exitCode: number,
  reason: string,
  error?: unknown,
): Promise<void> {
  return withBackgroundDatabaseWork("shutdown", () =>
    stopProcess(exitCode, reason, error),
  );
}

async function stopProcess(
  exitCode: number,
  reason: string,
  error: unknown,
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
    const { currentStep, ...progress } = shutdownProgress();
    logEvent({
      level: "fatal",
      event: "server.shutdown.timeout",
      component: "ProcessLifecycle",
      message: "Shutdown deadline exceeded; accepted logs may remain unflushed",
      metadata: { step: currentStep, ...progress },
    });
    process.exit(1);
  }, SHUTDOWN_LIMITS.deadlineMs);
  for (const task of tasks) await runShutdownStep(task, task.budgetMs);
  const { cleanupFailures, databaseClose } = shutdownProgress();
  if (cleanupFailures > 0) {
    process.exitCode = 1;
    logEvent({
      level: "error",
      event: "server.shutdown.failed",
      component: "ProcessLifecycle",
      message: "Server cleanup failed",
      metadata: { cleanupFailures, databaseClose },
    });
  }
  try {
    logEvent({
      level: "info",
      event: "server.shutdown.completed",
      component: "ProcessLifecycle",
      message: "Server cleanup ended",
      metadata: { cleanupFailures, databaseClose },
    });
    await closeLogging();
  } finally {
    clearTimeout(deadline);
    process.exit(process.exitCode ?? exitCode);
  }
}
