import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import type { Database } from "@/backend/database/Database";
import type { DatabaseWorkerState } from "@/backend/database/DatabaseExecutorTypes";

/** Tells whether the database answers, for the `/health` endpoint. */
export class HealthService {
  private readonly database: Database;

  /**
   * Creates the service.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /**
   * Reads the state of the database worker without querying it (PAGE-197).
   *
   * @returns Only the state name; no SQL, path or counter.
   */
  public databaseState(): DatabaseWorkerState {
    return this.database.executorStatus().worker.state;
  }

  /**
   * Runs a trivial query on a reader connection, so a long write does not hold it back.
   *
   * @returns Whether the database answered it; a failure is logged.
   */
  public async canQueryDatabase(): Promise<boolean> {
    try {
      await this.database.query("SELECT 1 AS alive;");

      return true;
    } catch (error: unknown) {
      logCaughtError("HealthService", error);

      logDiagnostic(
        "HealthService",
        "error",
        "[pages] The health check could not query the database.",
        error,
      );

      return false;
    }
  }
}
