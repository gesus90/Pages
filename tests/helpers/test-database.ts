import { afterEach, beforeEach } from "vitest";

import { Database, IN_MEMORY_DATABASE_PATH } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";

/**
 * Gives every test in the current suite a fresh in-memory DuckDB with the
 * baseline schema, and closes it afterwards.
 *
 * @returns A getter for the database of the running test.
 */
export function useMigratedDatabase(): () => Database {
  let database: Database | undefined;

  beforeEach(async () => {
    database = await Database.create(IN_MEMORY_DATABASE_PATH);
    await database.migrate(DATABASE_MIGRATIONS);
  });

  afterEach(async () => {
    await database?.close();
    database = undefined;
  });

  return () => {
    if (!database) {
      throw new Error("The test database is only available inside a test.");
    }

    return database;
  };
}
