import type { Database } from "@/backend/database/Database";

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
   * Runs a trivial query.
   *
   * @returns Whether the database answered it; a failure is logged.
   */
  public async canQueryDatabase(): Promise<boolean> {
    try {
      await this.database.query("SELECT 1 AS alive;");

      return true;
    } catch (error: unknown) {
      console.error(
        "[pages] The health check could not query the database.",
        error,
      );

      return false;
    }
  }
}
