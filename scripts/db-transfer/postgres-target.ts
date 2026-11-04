import { readTextColumn } from "@/backend/database/RowValue";

import { columnListOf, quoteIdentifier, sortClauseOf } from "./table-plan";
import { TransferRefusal } from "./transfer-refusal";

import type {
  Database,
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { Migration } from "@/backend/database/Migration";
import type {
  ForeignKey,
  TableColumn,
  TableColumns,
  TablePlan,
} from "./table-plan";

/** PostgreSQL's own migration count, which the transfer neither fills nor compares. */
const VERSION_TABLE = "postgres_schema_migrations";

/** Rows of one `INSERT` or one read; the statement stays far below 65535 values. */
const ROWS_PER_BLOCK = 100;

/** A block ends earlier once it holds this much, since single values reach megabytes. */
const BYTES_PER_BLOCK = 16 * 1024 * 1024;

const READ_TABLES = `
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
  ORDER BY table_name;
`;

const READ_COLUMNS = `
  SELECT
      table_columns.table_name,
      table_columns.column_name,
      table_columns.data_type
  FROM information_schema.columns AS table_columns
  INNER JOIN information_schema.tables AS base_tables
      ON base_tables.table_schema = table_columns.table_schema
      AND base_tables.table_name = table_columns.table_name
  WHERE table_columns.table_schema = 'public'
      AND base_tables.table_type = 'BASE TABLE'
  ORDER BY
      table_columns.table_name,
      table_columns.ordinal_position;
`;

const READ_FOREIGN_KEYS = `
  SELECT
      base_tables.relname,
      referenced_tables.relname
  FROM pg_constraint AS constraints
  INNER JOIN pg_class AS base_tables
      ON base_tables.oid = constraints.conrelid
  INNER JOIN pg_class AS referenced_tables
      ON referenced_tables.oid = constraints.confrelid
  INNER JOIN pg_namespace AS namespaces
      ON namespaces.oid = base_tables.relnamespace
  WHERE namespaces.nspname = 'public'
      AND constraints.contype = 'f';
`;

const READ_SEQUENCES = `
  SELECT
      sequencename,
      increment_by
  FROM pg_sequences
  WHERE schemaname = 'public'
  ORDER BY sequencename;
`;

/**
 * A row a migration wrote and nobody changed since carries the transaction of
 * that migration, which is also the one of its version row. So this finds every
 * other row, without a list of what the migrations seed.
 */
const IS_BUSINESS_ROW = `xmin::TEXT NOT IN (SELECT xmin::TEXT FROM ${VERSION_TABLE})`;

function byteSizeOf(row: readonly DatabaseValue[]): number {
  let bytes = 0;
  for (const value of row)
    if (typeof value === "string" || Buffer.isBuffer(value))
      bytes += value.length;
  return bytes;
}

/**
 * Gives an empty database its schema; a migrated one gets what it lacks.
 *
 * @param database - The target.
 * @param migrations - The PostgreSQL migrations.
 * @throws {TransferRefusal} When the database holds tables of something else.
 */
export async function prepareTarget(
  database: Database,
  migrations: readonly Migration[],
): Promise<void> {
  const rows = await database.query(READ_TABLES);
  const tables = rows.map((row) => readTextColumn(row, 0, "table_name"));
  if (tables.length > 0 && !tables.includes(VERSION_TABLE))
    throw new TransferRefusal(
      `The target holds ${String(tables.length)} tables and no Pages schema. Use a new database.`,
    );
  await database.migrate(migrations);
}

/**
 * Reads the columns of the tables to transfer.
 *
 * @param database - The target.
 * @returns The columns per table, without the version table.
 */
export async function readTargetColumns(
  database: Database,
): Promise<TableColumns> {
  const columns = new Map<string, TableColumn[]>();
  for (const row of await database.query(READ_COLUMNS)) {
    const table = readTextColumn(row, 0, "table_name");
    if (table === VERSION_TABLE) continue;
    columns.set(table, [
      ...(columns.get(table) ?? []),
      {
        name: readTextColumn(row, 1, "column_name"),
        type: readTextColumn(row, 2, "data_type"),
      },
    ]);
  }
  return columns;
}

/**
 * Reads the foreign keys that decide the copying order.
 *
 * @param database - The target.
 * @returns The foreign keys of the public schema.
 */
export async function readForeignKeys(
  database: Database,
): Promise<readonly ForeignKey[]> {
  const rows = await database.query(READ_FOREIGN_KEYS);
  return rows.map((row) => ({
    table: readTextColumn(row, 0, "table"),
    referencedTable: readTextColumn(row, 1, "referenced_table"),
  }));
}

/**
 * Refuses a target that holds anything but the rows of its migrations.
 *
 * @param database - The target.
 * @param plans - The tables to transfer.
 * @throws {TransferRefusal} Naming the tables and the number of their rows.
 */
export async function refuseTargetWithData(
  database: Database,
  plans: readonly TablePlan[],
): Promise<void> {
  const findings: string[] = [];
  for (const plan of plans) {
    const rows = await database.query(
      `SELECT COUNT(*) FROM ${quoteIdentifier(plan.name)} WHERE ${IS_BUSINESS_ROW};`,
    );
    const count = Number(rows[0]?.[0] ?? 0);
    if (count > 0) findings.push(`${plan.name}: ${String(count)} rows`);
  }
  if (findings.length > 0)
    throw new TransferRefusal(
      `The target already holds business data. Nothing was changed. Use a new database.\n  ${findings.join("\n  ")}`,
    );
}

async function insertBlock(
  transaction: DatabaseTransaction,
  plan: TablePlan,
  block: readonly (readonly DatabaseValue[])[],
): Promise<void> {
  const parameters: Record<string, DatabaseValue> = {};
  const tuples = block.map((row, rowIndex) => {
    const placeholders = row.map((value, columnIndex) => {
      const name = `value_${String(rowIndex)}_${String(columnIndex)}`;
      parameters[name] = value;
      return `$${name}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  await transaction.execute(
    `INSERT INTO ${quoteIdentifier(plan.name)} (${columnListOf(plan)}) VALUES ${tuples.join(", ")};`,
    parameters,
  );
}

/**
 * Copies one table in one transaction, in blocks.
 *
 * @param database - The target, checked with {@link refuseTargetWithData}.
 * @param plan - The table.
 * @param rows - The rows of the source.
 *
 * @remarks
 * The source holds the rows a migration seeds as well, possibly changed, so those
 * go first. The same condition as in the check leaves everything else in place,
 * so a row that appeared since then fails on its key instead of being deleted.
 */
export async function copyTable(
  database: Database,
  plan: TablePlan,
  rows: AsyncIterable<readonly DatabaseValue[]>,
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.execute(
      `DELETE FROM ${quoteIdentifier(plan.name)} WHERE NOT (${IS_BUSINESS_ROW});`,
    );
    let block: (readonly DatabaseValue[])[] = [];
    let blockBytes = 0;
    for await (const row of rows) {
      block.push(row);
      blockBytes += byteSizeOf(row);
      if (block.length < ROWS_PER_BLOCK && blockBytes < BYTES_PER_BLOCK)
        continue;
      await insertBlock(transaction, plan, block);
      block = [];
      blockBytes = 0;
    }
    if (block.length > 0) await insertBlock(transaction, plan, block);
  });
}

/**
 * Reads every row of a table in blocks.
 *
 * @param database - The target.
 * @param plan - The table.
 * @yields The rows in the stable order of the plan.
 */
export async function* readTargetRows(
  database: Database,
  plan: TablePlan,
): AsyncGenerator<readonly DatabaseValue[]> {
  const statement = `SELECT ${columnListOf(plan)} FROM ${quoteIdentifier(plan.name)} ORDER BY ${sortClauseOf(plan)} LIMIT $block_rows OFFSET $skipped_rows;`;
  for (let skippedRows = 0; ; skippedRows += ROWS_PER_BLOCK) {
    const rows = await database.query(statement, {
      block_rows: ROWS_PER_BLOCK,
      skipped_rows: skippedRows,
    });
    yield* rows;
    if (rows.length < ROWS_PER_BLOCK) return;
  }
}

/**
 * Makes a sequence hand out the given value next.
 *
 * @param database - The target.
 * @param name - The sequence.
 * @param nextValue - The value the next call returns.
 */
export async function setTargetSequence(
  database: Database,
  name: string,
  nextValue: bigint,
): Promise<void> {
  await database.execute("SELECT setval($name, $next_value, FALSE);", {
    name,
    next_value: nextValue,
  });
}

/**
 * Reads the value each sequence hands out next.
 *
 * @param database - The target.
 * @returns The next value per sequence.
 */
export async function readTargetSequences(
  database: Database,
): Promise<ReadonlyMap<string, bigint>> {
  const sequences = new Map<string, bigint>();
  for (const row of await database.query(READ_SEQUENCES)) {
    const name = readTextColumn(row, 0, "sequence");
    const [state] = await database.query(
      `SELECT last_value, is_called FROM ${quoteIdentifier(name)};`,
    );
    const lastValue = BigInt(String(state?.[0]));
    sequences.set(
      name,
      state?.[1] === 1 ? lastValue + BigInt(String(row[1])) : lastValue,
    );
  }
  return sequences;
}
