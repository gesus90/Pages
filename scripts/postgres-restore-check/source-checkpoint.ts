import { randomUUID } from "node:crypto";

import { Database } from "@/backend/database/Database";
import { postgresErrorCode } from "@/backend/database/postgres/PostgresConnection";
import { readTextColumn } from "@/backend/database/RowValue";

import { quoteIdentifier } from "../db-transfer/table-plan";
import { countRows, readTableNames } from "./table-counts";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { TableCounts } from "./table-counts";

/**
 * For the whole statement, because `lock_timeout` counts per table, and below the
 * `deadlock_timeout` of 1 s: a writer that holds one table and waits for another of
 * this statement only starts its deadlock check after this one has given up, so the
 * server never ends the writer.
 */
const LOCK_STATEMENT_TIMEOUT = "800ms";

/** So a slow count cannot hold back the writers for long. */
const COUNT_STATEMENT_TIMEOUT = "5s";

const SNAPSHOT_ATTEMPTS = 5;

/** Long enough for a short vacuum, which also keeps this lock waiting, to end. */
const SNAPSHOT_RETRY_MS = 15_000;

/** SQLSTATE of `statement_timeout`. */
const POSTGRES_QUERY_CANCELED = "57014";

/** Outside `public`, so markers change neither the counted tables nor a transfer. */
const CREATE_SCHEMA = "CREATE SCHEMA IF NOT EXISTS pages_restore_check;";

const CREATE_MARKERS = `
  CREATE TABLE IF NOT EXISTS pages_restore_check.markers (
      id TEXT PRIMARY KEY,
      confirmed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
  );
`;

const DELETE_MARKERS = "DELETE FROM pages_restore_check.markers;";

const INSERT_MARKER = `
  INSERT INTO pages_restore_check.markers (
      id
  )
  VALUES (
      $id
  );
`;

const READ_CLOCK = `
  SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00';
`;

const SWITCH_WAL = "SELECT pg_walfile_name(pg_switch_wal());";

/** What the source looked like at the point in time the check restores to. */
export interface SourceCheckpoint {
  /** The point in time, in a form `recovery_target_time` reads. */
  readonly targetTime: string;
  readonly counts: TableCounts;
  /** A row confirmed before the point in time, so the restored data must hold it. */
  readonly confirmedMarker: string;
  /** A row confirmed after it, so the restored data must not hold it. */
  readonly laterMarker: string;
  /** The WAL file that holds the end of all of this. */
  readonly walFile: string;
}

interface TableSnapshot {
  readonly targetTime: string;
  readonly counts: TableCounts;
}

/**
 * Counts every table at one exact point in time.
 *
 * @remarks
 * A count of a running database fits no point in time on its own. Every writer
 * that holds a table has committed before this lock is granted, and every other
 * one waits until this transaction ends, so all of them commit after the clock
 * was read. Recovery stops at the first commit after that time. The lock therefore
 * makes the counts exact, at the price of writers waiting for the moment it takes.
 */
async function readSnapshot(
  transaction: DatabaseTransaction,
  tables: readonly string[],
): Promise<TableSnapshot> {
  await transaction.execute(
    `SET LOCAL statement_timeout = '${LOCK_STATEMENT_TIMEOUT}';`,
  );
  await transaction.execute(
    `LOCK TABLE ${tables.map(quoteIdentifier).join(", ")} IN SHARE MODE;`,
  );
  await transaction.execute(
    `SET LOCAL statement_timeout = '${COUNT_STATEMENT_TIMEOUT}';`,
  );
  const counts = await countRows(transaction, tables);
  const clockRows = await transaction.query(READ_CLOCK);
  const clockRow = clockRows[0];
  if (clockRow === undefined)
    throw new Error("The clock query returned no row.");
  return { targetTime: readTextColumn(clockRow, 0, "clock"), counts };
}

async function takeSnapshot(database: Database): Promise<TableSnapshot> {
  const tables = await readTableNames(database);
  if (tables.length === 0) throw new Error("The source holds no tables.");
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await database.transaction((transaction) =>
        readSnapshot(transaction, tables),
      );
    } catch (error: unknown) {
      if (
        attempt >= SNAPSHOT_ATTEMPTS ||
        postgresErrorCode(error) !== POSTGRES_QUERY_CANCELED
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, SNAPSHOT_RETRY_MS));
    }
  }
}

async function closeWal(database: Database): Promise<string> {
  const rows = await database.query(SWITCH_WAL);
  const row = rows[0];
  if (row === undefined) throw new Error("pg_switch_wal returned no row.");
  return readTextColumn(row, 0, "wal_file");
}

/**
 * Fixes a point in time on the running source and delivers its WAL to the archive.
 *
 * @param sourceUrl - The connection URL of the source.
 * @returns The point in time and what must be true of the restored data there.
 */
export async function takeSourceCheckpoint(
  sourceUrl: string,
): Promise<SourceCheckpoint> {
  const database = await Database.connect(sourceUrl);
  try {
    await database.execute(CREATE_SCHEMA);
    await database.execute(CREATE_MARKERS);

    const confirmedMarker = randomUUID();
    await database.transaction(async (transaction) => {
      await transaction.execute(DELETE_MARKERS);
      await transaction.execute(INSERT_MARKER, { id: confirmedMarker });
    });

    const snapshot = await takeSnapshot(database);

    // Recovery only stops at a commit after the target, and a quiet source has none.
    const laterMarker = randomUUID();
    await database.execute(INSERT_MARKER, { id: laterMarker });

    return {
      ...snapshot,
      confirmedMarker,
      laterMarker,
      walFile: await closeWal(database),
    };
  } finally {
    await database.close();
  }
}
