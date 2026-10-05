import { createHash } from "node:crypto";

/** A named SQL script that moves the schema to its next version. */
export interface Migration {
  readonly name: string;
  readonly sql: string;
}

/** Raised when an applied migration no longer matches its source file. */
export class MigrationChecksumError extends Error {
  public constructor(migrationName: string) {
    super(
      `The applied database migration "${migrationName}" was changed after it ran. Add a new migration instead of editing an applied one.`,
    );
    this.name = "MigrationChecksumError";
  }
}

/** Raised when the database holds a migration this version does not know. */
export class UnknownMigrationError extends Error {
  public constructor(migrationName: string) {
    super(
      `The database contains the migration "${migrationName}", which this version of Pages does not know. Start a newer version of Pages.`,
    );
    this.name = "UnknownMigrationError";
  }
}

/**
 * Computes the fingerprint stored with an applied migration.
 *
 * @param sql - Migration script.
 * @returns A hex digest that is stable across line-ending styles.
 */
export function createMigrationChecksum(sql: string): string {
  return createHash("sha256")
    .update(sql.replaceAll("\r\n", "\n"))
    .digest("hex");
}
