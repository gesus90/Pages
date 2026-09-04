import type { Database } from "@/backend/database/Database";

/** Establishes the persistence boundary for projects. */
export class ProjectRepository {
  private readonly database: Database;

  /**
   * Creates a project repository.
   *
   * @param database - Central DuckDB access.
   */
  public constructor(database: Database) {
    this.database = database;
  }
}
