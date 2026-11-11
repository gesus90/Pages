import { readCountColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

const READ_DATABASE_SIZE = `
  SELECT
      pg_database_size(current_database()) AS database_size;
`;

/** Reads figures of the database itself for the system dashboard (PAGE-282). */
export class SystemMetricsRepository {
  private readonly database: Database;

  /**
   * Creates the repository.
   *
   * @param database - Central database access.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /**
   * Returns the size of the database Pages works in.
   *
   * @returns Its size on disk in bytes, as PostgreSQL counts it.
   * @throws When the database answers no size.
   */
  public async readDatabaseSize(): Promise<number> {
    const [row] = await this.database.query(READ_DATABASE_SIZE);
    if (row === undefined)
      throw new Error("Database returned no size for the system dashboard.");
    return readCountColumn(row, 0, "database_size");
  }
}
