import { existsSync } from "node:fs";

import {
  DuckDBBlobValue,
  DuckDBInstance,
  DuckDBListValue,
} from "@duckdb/node-api";

import { columnListOf, quoteIdentifier, sortClauseOf } from "./table-plan";
import { TransferRefusal } from "./transfer-refusal";

import type { DuckDBConnection, DuckDBValue } from "@duckdb/node-api";

import type { DatabaseValue } from "@/backend/database/Database";
import type { TablePlan, TableColumn, TableColumns } from "./table-plan";

/** Far above the visible data; the file is much larger, but is only read in parts. */
const MEMORY_LIMIT = "4GB";

/** The version table of the DuckDB migrations; PostgreSQL has its own. */
const VERSION_TABLE = "schema_migrations";

const READ_APPLIED_MIGRATIONS = `
  SELECT name
  FROM schema_migrations
  ORDER BY name;
`;

const READ_COLUMNS = `
  SELECT
      table_columns.table_name,
      table_columns.column_name,
      table_columns.data_type
  FROM duckdb_columns() AS table_columns
  INNER JOIN duckdb_tables() AS base_tables
      ON base_tables.table_oid = table_columns.table_oid
  WHERE NOT base_tables.internal
  ORDER BY
      table_columns.table_name,
      table_columns.column_index;
`;

const READ_PRIMARY_KEYS = `
  SELECT
      table_name,
      constraint_column_names
  FROM duckdb_constraints()
  WHERE constraint_type = 'PRIMARY KEY';
`;

/**
 * In a file opened anew, `start_value` is the next value of a sequence: a
 * checkpoint stores the counter there. `last_value` then shows the same number,
 * although no statement received it.
 */
const READ_SEQUENCES = `
  SELECT
      sequence_name,
      start_value
  FROM duckdb_sequences()
  ORDER BY sequence_name;
`;

function toDatabaseValue(value: DuckDBValue): DatabaseValue {
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  )
    return value;
  // The facade reads a PostgreSQL boolean as these integers, too.
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof DuckDBBlobValue) return Buffer.from(value.bytes);
  throw new TransferRefusal(
    "The DuckDB file holds a column of a type the transfer does not know.",
  );
}

/** A Pages DuckDB file opened read-only. */
export class DuckDbSource {
  private readonly instance: DuckDBInstance;
  private readonly connection: DuckDBConnection;

  private constructor(instance: DuckDBInstance, connection: DuckDBConnection) {
    this.instance = instance;
    this.connection = connection;
  }

  /**
   * Opens the file read-only, so neither it nor anything beside it changes.
   *
   * @param filePath - The DuckDB file.
   * @returns The open source, which owes a {@link close}.
   * @throws {TransferRefusal} When the file is missing or has a write-ahead log.
   *
   * @remarks
   * Without a temporary directory a sort beyond the memory limit fails instead
   * of spilling next to the file. A write-ahead log means Pages did not stop
   * cleanly, so the file alone does not hold the last changes.
   */
  public static async open(filePath: string): Promise<DuckDbSource> {
    if (!existsSync(filePath))
      throw new TransferRefusal("The DuckDB file does not exist.");
    if (existsSync(`${filePath}.wal`))
      throw new TransferRefusal(
        "The DuckDB file has a write-ahead log. Stop Pages cleanly first, so its changes are in the file.",
      );
    const instance = await DuckDBInstance.create(filePath, {
      access_mode: "READ_ONLY",
      memory_limit: MEMORY_LIMIT,
      temp_directory: "",
    });
    return new DuckDbSource(instance, await instance.connect());
  }

  /** Closes the file. */
  public close(): void {
    this.connection.closeSync();
    this.instance.closeSync();
  }

  /**
   * Reads which migrations the file has.
   *
   * @returns The names of the migrations in name order.
   */
  public async readAppliedMigrations(): Promise<readonly string[]> {
    const rows = await this.readAll(READ_APPLIED_MIGRATIONS);
    return rows.map((row) => String(row[0]));
  }

  /**
   * Reads the columns of the tables to transfer.
   *
   * @returns The columns per table, without the version table.
   */
  public async readColumns(): Promise<TableColumns> {
    const columns = new Map<string, TableColumn[]>();
    for (const row of await this.readAll(READ_COLUMNS)) {
      const table = String(row[0]);
      if (table === VERSION_TABLE) continue;
      columns.set(table, [
        ...(columns.get(table) ?? []),
        { name: String(row[1]), type: String(row[2]) },
      ]);
    }
    return columns;
  }

  /**
   * Reads the primary keys.
   *
   * @returns The key columns per table.
   */
  public async readPrimaryKeys(): Promise<
    ReadonlyMap<string, readonly string[]>
  > {
    const keys = new Map<string, readonly string[]>();
    for (const row of await this.readAll(READ_PRIMARY_KEYS)) {
      const columns = row[1];
      if (columns instanceof DuckDBListValue)
        keys.set(String(row[0]), columns.items.map(String));
    }
    return keys;
  }

  /**
   * Reads the value each sequence hands out next.
   *
   * @returns The next value per sequence.
   */
  public async readSequences(): Promise<ReadonlyMap<string, bigint>> {
    const rows = await this.readAll(READ_SEQUENCES);
    return new Map(
      rows.map((row) => [String(row[0]), BigInt(String(row[1]))] as const),
    );
  }

  /**
   * Reads every row of a table without holding the table in memory.
   *
   * @param plan - The table.
   * @yields The rows in the stable order of the plan.
   */
  public async *readRows(plan: TablePlan): AsyncGenerator<DatabaseValue[]> {
    const result = await this.connection.stream(
      `SELECT ${columnListOf(plan)} FROM ${quoteIdentifier(plan.name)} ORDER BY ${sortClauseOf(plan)};`,
    );
    for await (const rows of result.yieldRows())
      for (const row of rows) yield row.map(toDatabaseValue);
  }

  private async readAll(statement: string): Promise<DuckDBValue[][]> {
    return (await this.connection.runAndReadAll(statement)).getRows();
  }
}
