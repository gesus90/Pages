import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { DuckDBInstance } from "@duckdb/node-api";

import type { DuckDBConnection, DuckDBValue } from "@duckdb/node-api";

/** Named values bound to a parameterized statement. */
export type SqlParameters = Readonly<
  Record<string, string | number | bigint | boolean | null>
>;

/** Provides the central server-side connection and migration runner. */
export class Database {
  private readonly instance: DuckDBInstance;
  private readonly connection: DuckDBConnection;

  private constructor(instance: DuckDBInstance, connection: DuckDBConnection) {
    this.instance = instance;
    this.connection = connection;
  }

  /**
   * Opens a DuckDB database, creating its parent directory when needed.
   *
   * @param databasePath - File system path for the database.
   * @returns An open database connection.
   */
  public static async create(databasePath: string): Promise<Database> {
    await mkdir(path.dirname(databasePath), { recursive: true });

    const instance = await DuckDBInstance.create(databasePath);
    const connection = await instance.connect();

    return new Database(instance, connection);
  }

  /** Releases the connection and the underlying database file. */
  public close(): void {
    this.connection.closeSync();
    this.instance.closeSync();
  }

  /**
   * Applies each migration file once in lexical file-name order.
   *
   * @param migrationsPath - Directory containing SQL migration files.
   */
  public async migrate(migrationsPath: string): Promise<void> {
    await this.connection.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
          name VARCHAR PRIMARY KEY,
          applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const appliedMigrations = await this.getAppliedMigrations();
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

      await this.applyMigration(migrationName, migrationSql);
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
    await this.connection.run(statement, { ...parameters });
  }

  /**
   * Runs a query and returns its rows as native DuckDB values.
   *
   * @param statement - SQL owned by a repository.
   * @param parameters - Values bound to the statement placeholders.
   * @returns Rows in query column order.
   */
  public async query(
    statement: string,
    parameters: SqlParameters = {},
  ): Promise<readonly DuckDBValue[][]> {
    const reader = await this.connection.runAndReadAll(statement, {
      ...parameters,
    });

    return reader.getRows();
  }

  private async getAppliedMigrations(): Promise<Set<string>> {
    const reader = await this.connection.runAndReadAll(`
      SELECT
          name
      FROM schema_migrations
      ORDER BY name;
    `);
    const appliedMigrations = new Set<string>();

    for (const row of reader.getRows()) {
      const migrationName = row[0];

      if (typeof migrationName !== "string") {
        throw new Error("Database returned an invalid migration name.");
      }

      appliedMigrations.add(migrationName);
    }

    return appliedMigrations;
  }

  private async applyMigration(name: string, sql: string): Promise<void> {
    await this.connection.run("BEGIN TRANSACTION;");

    try {
      await this.connection.run(sql);
      await this.connection.run(
        `
          INSERT INTO schema_migrations (
              name
          )
          VALUES (
              $name
          );
        `,
        { name },
      );
      await this.connection.run("COMMIT;");
    } catch (error: unknown) {
      await this.connection.run("ROLLBACK;");
      throw new Error(`Failed to apply database migration "${name}".`, {
        cause: error,
      });
    }
  }
}
