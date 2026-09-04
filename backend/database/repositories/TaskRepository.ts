import type { Database } from "@/backend/database/Database";

/** Establishes the persistence boundary for tasks. */
export class TaskRepository {
  private readonly database: Database;

  /**
   * Creates a task repository.
   *
   * @param database - Central DuckDB access.
   */
  public constructor(database: Database) {
    this.database = database;
  }
}
