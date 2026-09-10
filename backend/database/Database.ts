import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import SqliteDatabase from "better-sqlite3";

import { recordDatabaseQuery } from "./DatabaseStats";

import type { Database as SqliteConnection } from "better-sqlite3";

/** A single column value as stored and returned by SQLite. */
export type DatabaseValue = string | number | bigint | Buffer | null;

/** Named values bound to a parameterized statement. */
export type SqlParameters = Readonly<
  Record<string, string | number | bigint | boolean | Buffer | null>
>;

/** Provides the central server-side connection and migration runner. */
export class Database {
  private readonly connection: SqliteConnection;

  private constructor(connection: SqliteConnection) {
    this.connection = connection;
  }

  /**
   * Opens a SQLite database, creating its parent directory when needed.
   *
   * @param databasePath - File system path for the database.
   * @returns An open database connection.
   */
  public static async create(databasePath: string): Promise<Database> {
    await mkdir(path.dirname(databasePath), { recursive: true });

    const connection = new SqliteDatabase(databasePath);
    connection.pragma("journal_mode = WAL");
    connection.pragma("foreign_keys = ON");

    return new Database(connection);
  }

  /** Releases the underlying database connection. */
  public close(): void {
    this.connection.close();
  }

  /**
   * Applies each migration file once in lexical file-name order.
   *
   * @param migrationsPath - Directory containing SQL migration files.
   */
  public async migrate(migrationsPath: string): Promise<void> {
    // Table rebuilds (e.g. widened CHECK constraints) cannot run with
    // enforced foreign keys because SQLite validates implicit deletes on
    // DROP TABLE. Migrations run at startup before any request is served,
    // so constraints are lifted here and restored afterwards.
    this.connection.pragma("foreign_keys = OFF");

    try {
      await this.applyPendingMigrations(migrationsPath);
    } finally {
      this.connection.pragma("foreign_keys = ON");
    }
  }

  private async applyPendingMigrations(migrationsPath: string): Promise<void> {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
          name TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const appliedMigrations = this.getAppliedMigrations();
    const directoryEntries = await readdir(migrationsPath, {
      withFileTypes: true,
    });
    const migrationNames = directoryEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => entry.name)
      .sort();

    for (const migrationName of migrationNames) {
      if (appliedMigrations.has(migrationName)) {
        continue;
      }

      const migrationSql = await readFile(
        path.join(migrationsPath, migrationName),
        "utf8",
      );

      this.applyMigration(migrationName, migrationSql);
    }
  }

  /**
   * Runs a persistence statement without returning rows.
   *
   * @param statement - SQL owned by a repository.
   * @param parameters - Values bound to the statement placeholders.
   */
  public async execute(
    statement: string,
    parameters: SqlParameters = {},
  ): Promise<void> {
    const startedAt = performance.now();

    try {
      this.connection.prepare(statement).run(this.toBindings(parameters));
    } finally {
      recordDatabaseQuery(statement, performance.now() - startedAt);
    }
  }

  /**
   * Runs a query and returns its rows as raw positional column values.
   *
   * @param statement - SQL owned by a repository.
   * @param parameters - Values bound to the statement placeholders.
   * @returns Rows in query column order.
   */
  public async query(
    statement: string,
    parameters: SqlParameters = {},
  ): Promise<readonly DatabaseValue[][]> {
    const startedAt = performance.now();

    try {
      const rows = this.connection
        .prepare(statement)
        .raw()
        .all(this.toBindings(parameters));

      return rows as DatabaseValue[][];
    } finally {
      recordDatabaseQuery(statement, performance.now() - startedAt);
    }
  }

  private getAppliedMigrations(): Set<string> {
    const rows = this.connection
      .prepare("SELECT name FROM schema_migrations ORDER BY name;")
      .raw()
      .all() as DatabaseValue[][];
    const appliedMigrations = new Set<string>();

    for (const row of rows) {
      const migrationName = row[0];

      if (typeof migrationName !== "string") {
        throw new Error("Database returned an invalid migration name.");
      }

      appliedMigrations.add(migrationName);
    }

    return appliedMigrations;
  }

  private applyMigration(name: string, sql: string): void {
    const runMigration = this.connection.transaction(() => {
      this.connection.exec(sql);
      this.connection
        .prepare(
          `
            INSERT INTO schema_migrations (
                name
            )
            VALUES (
                $name
            );
          `,
        )
        .run({ name });
    });

    try {
      runMigration();
    } catch (error: unknown) {
      throw new Error(`Failed to apply database migration "${name}".`, {
        cause: error,
      });
    }
  }

  private toBindings(
    parameters: SqlParameters,
  ): Record<string, string | number | bigint | Buffer | null> {
    const bindings: Record<string, string | number | bigint | Buffer | null> =
      {};

    for (const [key, value] of Object.entries(parameters)) {
      bindings[key] = typeof value === "boolean" ? Number(value) : value;
    }

    return bindings;
  }
}
