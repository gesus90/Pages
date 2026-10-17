import { randomUUID } from "node:crypto";

import { logEvent, withLogContext } from "./Logger";
import { withDatabaseLogMetrics } from "./DatabaseLogMetrics";

import type { LogContext } from "./Logger";

/** Runs one business/job boundary with safe lifecycle events and an async correlation. */
export async function loggedOperation<Result>(
  component: string,
  operation: string,
  work: () => Promise<Result>,
  facts: LogContext = {},
): Promise<Result> {
  return withLogContext({ correlationId: randomUUID(), ...facts }, () =>
    withDatabaseLogMetrics(async (metrics) => {
      const started = performance.now();
      logEvent({
        level: "debug",
        event: `${operation}.started`,
        component,
        message: "Operation started",
        metadata: { operation },
      });
      try {
        const result = await work();
        logEvent({
          level: "info",
          event: `${operation}.completed`,
          component,
          message: "Operation completed",
          metadata: {
            operation,
            durationMs: performance.now() - started,
            ...metrics.finish(),
          },
        });
        return result;
      } catch (error: unknown) {
        logEvent({
          level: "error",
          event: `${operation}.failed`,
          component,
          message: "Operation failed",
          error,
          metadata: {
            operation,
            durationMs: performance.now() - started,
            ...metrics.finish(),
          },
        });
        throw error;
      }
    }),
  );
}

/** Gives each scheduler invocation its own job identifier and lifecycle. */
export function loggedJob<Result>(
  component: string,
  operation: string,
  work: () => Promise<Result>,
): Promise<Result> {
  return loggedOperation(component, operation, work, { jobId: randomUUID() });
}
