import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import { readDatabaseState } from "./database-state.server";
import { getApplicationServices } from "./services.server";

import type { DatabaseState } from "./database-state.server";

/** What `/health` reports. */
export type HealthStatus = "ok" | "setup" | "unavailable";

/** Body of `/health`: the overall status and the bare database worker state. */
export interface HealthReport {
  readonly status: HealthStatus;
  /** State of the database worker (PAGE-197), without SQL, paths or counters. */
  readonly database: DatabaseState;
}

/** How long the database may take to answer before Pages counts as unavailable. */
export const HEALTH_TIMEOUT_MILLISECONDS = 3000;

async function queryDatabase(): Promise<HealthReport> {
  const { healthService } = await getApplicationServices();
  const state = healthService.databaseState();
  if (state !== "ready") return { status: "unavailable", database: state };
  const hasAnswered = await healthService.canQueryDatabase();

  return {
    status: hasAnswered ? "ok" : "unavailable",
    database: healthService.databaseState(),
  };
}

/**
 * Checks whether this Pages process can serve requests.
 *
 * @param timeoutMilliseconds - How long to wait for the database.
 * @returns `setup` while the setup wizard is pending, since no database
 * exists yet, `ok` when the database worker is ready and answers, and
 * `unavailable` when the worker is not ready, the query fails or it does not
 * answer in time; always with the worker state.
 */
export async function checkHealth(
  timeoutMilliseconds = HEALTH_TIMEOUT_MILLISECONDS,
): Promise<HealthReport> {
  if ((await getPagesRuntime()).isSetupPending()) {
    return { status: "setup", database: readDatabaseState() };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<HealthReport>((resolve) => {
    timer = setTimeout(
      () => resolve({ status: "unavailable", database: readDatabaseState() }),
      timeoutMilliseconds,
    );
  });

  try {
    return await Promise.race([queryDatabase(), timeout]);
  } catch (error: unknown) {
    logCaughtError("health", error);

    logDiagnostic("health", "error", "[pages] The health check failed.", error);

    return { status: "unavailable", database: readDatabaseState() };
  } finally {
    clearTimeout(timer);
  }
}
