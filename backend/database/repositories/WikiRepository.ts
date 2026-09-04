import type { Database } from "@/backend/database/Database";

/** Establishes the persistence boundary for wiki pages. */
export class WikiRepository {
  private readonly database: Database;

  /**
   * Creates a wiki repository.
   *
   * @param database - Central DuckDB access.
   */
  public constructor(database: Database) {
    this.database = database;
  }
}
