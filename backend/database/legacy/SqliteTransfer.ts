import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";

import SqliteDatabase from "better-sqlite3";

import { Database } from "@/backend/database/Database";
import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import {
  LEGACY_LABEL_COLUMNS,
  LEGACY_LABEL_TABLE,
  createLegacyLabelTable,
  mergeLegacyLabels,
} from "./LegacyLabels";

import type {
  DatabaseTransaction,
  SqlParameters,
} from "@/backend/database/Database";
import type { Migration } from "@/backend/database/Migration";

/** A value as SQLite stores it, read with exact integers. */
type SqliteValue = string | number | bigint | Buffer | null;

/** Rows are copied in batches of this size. */
const ROWS_PER_INSERT = 100;

/** The table holding the default workflow statuses of a fresh baseline. */
const SEEDED_TABLE = "workflow_statuses";

/**
 * Gives the copied wiki pages the owner the former file never stored: the
 * author owns and last edited the page.
 */
const WIKI_BACKFILL = `
  UPDATE wiki_pages
  SET
      owner_id = author_id,
      updated_by = author_id
  WHERE owner_id = '';
`;

/** Inputs of a one-time transfer from the former SQLite file to DuckDB. */
export interface TransferOptions {
  /** SQLite database file; it is opened read-only and never changed. */
  readonly sourcePath: string;
  /** DuckDB database file; it is created when it does not exist. */
  readonly targetPath: string;
  /** DuckDB migrations that give the target its schema. */
  readonly migrations: readonly Migration[];
  /** Names of the SQLite migrations the source must have applied. */
  readonly legacyMigrationNames: readonly string[];
}

/** Row counts of one table on both sides of the transfer. */
interface TableTransferResult {
  readonly table: string;
  readonly sourceRows: number;
  readonly targetRows: number;
}

/** Outcome of a completed transfer. */
export interface TransferResult {
  /** `copied` when rows were written, `already-transferred` when none were. */
  readonly status: "copied" | "already-transferred";
  readonly tables: readonly TableTransferResult[];
}

/** Raised when the transfer cannot or must not proceed. */
export class TransferError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TransferError";
  }
}

/**
 * Copies every table of a SQLite Pages database into a DuckDB database.
 *
 * @param options - Source, target and the schema definitions to use.
 * @returns Row counts per table and whether anything was copied.
 * @throws {TransferError} When the source is unusable, the target holds other
 * data, or the row counts differ after the copy.
 *
 * @remarks
 * Safe to repeat: when the target already holds exactly the rows of the
 * source, nothing is written. All rows are copied in one transaction, so a
 * failure leaves the target without partial data, and a target that this call
 * created is removed again.
 */
export async function transferSqliteToDuckDb(
  options: TransferOptions,
): Promise<TransferResult> {
  const source = openSource(options.sourcePath);

  try {
    verifyLegacySchema(source, options.legacyMigrationNames);

    return await transferInto(source, options);
  } finally {
    source.close();
  }
}

async function transferInto(
  source: SqliteDatabase.Database,
  options: TransferOptions,
): Promise<TransferResult> {
  const targetExisted = existsSync(options.targetPath);

  try {
    const target = await Database.create(options.targetPath);

    try {
      await target.migrate(options.migrations);

      return await copyMissingRows(source, target, {
        targetExisted,
        authorizationBackfill: authorizationBackfillForSchema(
          options.migrations,
        ),
        wikiBackfill: wikiBackfillForSchema(options.migrations),
      });
    } finally {
      await target.close();
    }
  } catch (error: unknown) {
    if (!targetExisted) {
      await removeDatabaseFiles(options.targetPath);
    }

    throw error;
  }
}

/** What the transfer knows about one table before it copies anything. */
interface TablePlan extends TableTransferResult {
  readonly columns: readonly string[];
  /** True for the former label table, which exists only while copying. */
  readonly isLegacyLabels: boolean;
}

async function copyMissingRows(
  source: SqliteDatabase.Database,
  target: Database,
  options: {
    readonly targetExisted: boolean;
    readonly authorizationBackfill: string | undefined;
    readonly wikiBackfill: string | undefined;
  },
): Promise<TransferResult> {
  const plans = await planTables(source, target);

  if (!options.targetExisted || isBlank(plans)) {
    await target.transaction(async (transaction) => {
      const mergesLabels = plans.some((plan) => plan.isLegacyLabels);

      if (mergesLabels) {
        await createLegacyLabelTable(transaction);
      }

      await copyAllTables(source, transaction, plans);

      if (mergesLabels) {
        await mergeLegacyLabels(transaction);
      }

      if (options.authorizationBackfill) {
        await transaction.execute(options.authorizationBackfill);
      }

      if (options.wikiBackfill) {
        await transaction.execute(options.wikiBackfill);
      }
    });

    return {
      status: "copied",
      tables: plans.map((plan) => toResult(plan, plan.sourceRows)),
    };
  }

  // Merging labels changes their row counts, so they cannot be compared.
  const mergesLabels = plans.some((plan) => plan.isLegacyLabels);

  if (
    plans
      .filter((plan) => !isRewrittenByLabelMerge(plan, mergesLabels))
      .every((plan) => plan.sourceRows === plan.targetRows)
  ) {
    return {
      status: "already-transferred",
      tables: plans.map((plan) => toResult(plan, plan.targetRows)),
    };
  }

  throw new TransferError(
    "The target database already holds data that differs from the source. Use a new target file.",
  );
}

/** The wiki backfill, for targets whose schema has the wiki owner column. */
function wikiBackfillForSchema(
  migrations: readonly Migration[],
): string | undefined {
  return migrations.some((migration) => migration.name === "019_wiki.sql")
    ? WIKI_BACKFILL
    : undefined;
}

/** Adapts the frozen A2 backfill to the merged A3 capability catalog. */
function authorizationBackfillForSchema(
  migrations: readonly Migration[],
): string | undefined {
  const backfill = migrations.find(
    (migration) => migration.name === "006_legacy_user_roles.sql",
  )?.sql;
  if (
    !migrations.some(
      (migration) => migration.name === "008_project_permissions.sql",
    )
  ) {
    return backfill;
  }
  return backfill?.replaceAll("'create_projects'", "'manage_projects'");
}

/** The plans whose rows the label merge rewrites instead of copying 1:1. */
function isRewrittenByLabelMerge(
  plan: TablePlan,
  mergesLabels: boolean,
): boolean {
  return (
    mergesLabels && (plan.isLegacyLabels || plan.table === "work_item_labels")
  );
}

function toResult(plan: TablePlan, targetRows: number): TableTransferResult {
  return { sourceRows: plan.sourceRows, table: plan.table, targetRows };
}

async function planTables(
  source: SqliteDatabase.Database,
  target: Database,
): Promise<TablePlan[]> {
  const plans: TablePlan[] = [];

  const targetColumns = await readTargetColumns(target);

  // Labels became global in the target; the former table is merged in.
  const hasGlobalLabels = targetColumns.delete("labels");

  for (const [table, columns] of targetColumns) {
    plans.push({
      columns,
      isLegacyLabels: false,
      sourceRows: countSourceRows(source, table),
      table,
      targetRows: await countRows(target, table),
    });
  }

  if (hasGlobalLabels) {
    plans.push({
      columns: LEGACY_LABEL_COLUMNS,
      isLegacyLabels: true,
      sourceRows: countSourceRows(source, LEGACY_LABEL_TABLE),
      table: LEGACY_LABEL_TABLE,
      targetRows: await countRows(target, "labels"),
    });
  }

  return plans;
}

/** A target is blank when only the seeded default rows are present. */
function isBlank(plans: readonly TablePlan[]): boolean {
  return plans.every(
    (plan) => plan.table === SEEDED_TABLE || plan.targetRows === 0,
  );
}

async function copyAllTables(
  source: SqliteDatabase.Database,
  transaction: DatabaseTransaction,
  plans: readonly TablePlan[],
): Promise<void> {
  for (const plan of plans) {
    verifySourceColumns(source, plan.table, plan.columns);

    await transaction.execute(`DELETE FROM ${quoteIdentifier(plan.table)};`);
    await copyTable(source, transaction, plan.table, plan.columns);

    const copiedRows = await countRows(transaction, plan.table);

    if (copiedRows !== plan.sourceRows) {
      throw new TransferError(
        `Table "${plan.table}" has ${copiedRows} rows after the copy, expected ${plan.sourceRows}.`,
      );
    }
  }
}

async function copyTable(
  source: SqliteDatabase.Database,
  transaction: DatabaseTransaction,
  table: string,
  columns: readonly string[],
): Promise<void> {
  const columnList = columns.map(quoteIdentifier).join(", ");
  const rows = source
    .prepare(`SELECT ${columnList} FROM ${quoteIdentifier(table)};`)
    .raw()
    .safeIntegers(true)
    .iterate() as IterableIterator<SqliteValue[]>;
  let batch: SqliteValue[][] = [];

  for (const row of rows) {
    batch.push(row);

    if (batch.length === ROWS_PER_INSERT) {
      await insertBatch(transaction, table, columns, batch);
      batch = [];
    }
  }

  if (batch.length > 0) {
    await insertBatch(transaction, table, columns, batch);
  }
}

async function insertBatch(
  transaction: DatabaseTransaction,
  table: string,
  columns: readonly string[],
  batch: readonly SqliteValue[][],
): Promise<void> {
  const parameters: Record<string, SqlParameters[string]> = {};
  const tuples = batch.map((row, rowIndex) => {
    const placeholders = row.map((value, columnIndex) => {
      const name = `value_${rowIndex}_${columnIndex}`;

      parameters[name] = value;

      return `$${name}`;
    });

    return `(${placeholders.join(", ")})`;
  });

  await transaction.execute(
    `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")}) VALUES ${tuples.join(", ")};`,
    parameters,
  );
}

function openSource(sourcePath: string): SqliteDatabase.Database {
  if (!existsSync(sourcePath)) {
    throw new TransferError(`The SQLite file "${sourcePath}" does not exist.`);
  }

  return new SqliteDatabase(sourcePath, {
    fileMustExist: true,
    readonly: true,
  });
}

function verifyLegacySchema(
  source: SqliteDatabase.Database,
  legacyMigrationNames: readonly string[],
): void {
  const hasMigrationTable = source
    .prepare(
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations';",
    )
    .pluck()
    .get() as number;
  const applied = new Set(
    hasMigrationTable === 0
      ? []
      : (source
          .prepare("SELECT name FROM schema_migrations;")
          .pluck()
          .all() as string[]),
  );
  const missing = legacyMigrationNames.filter((name) => !applied.has(name));

  if (missing.length > 0) {
    throw new TransferError(
      `The SQLite database does not have the current schema (missing ${missing.join(", ")}). Start the previous Pages version once so it migrates the file, then transfer.`,
    );
  }
}

function verifySourceColumns(
  source: SqliteDatabase.Database,
  table: string,
  columns: readonly string[],
): void {
  const present = new Set(
    (
      source.prepare(`PRAGMA table_info(${quoteIdentifier(table)});`).all() as {
        name: string;
      }[]
    ).map((column) => column.name),
  );
  const missing = columns.filter((column) => !present.has(column));

  if (missing.length > 0) {
    throw new TransferError(
      `The SQLite table "${table}" lacks the columns ${missing.join(", ")}.`,
    );
  }
}

/**
 * Reads the tables the transfer fills.
 *
 * @remarks
 * `instance_settings` came after the SQLite version, so the former file
 * has no such table; it stays empty until the setup wizard fills it.
 * Likewise, migrated passwords are already chosen: the new password-change
 * column keeps its database default instead of requiring it in frozen SQLite.
 * Ticket departments were added for A3; legacy tickets remain unassigned.
 * Groups (and group assignments of tickets) came with A4; none exist in SQLite.
 * Global labels replace `project_labels`; their copy is merged by `LegacyLabels`.
 * Ticket templates came with A4; none exist in SQLite.
 * The project-wide GitHub switch came with A4; transferred connections stay active.
 * The ticket number counter came with the A4 follow-up; it starts at 0 after
 * the copy and rises with the tickets on the first allocation.
 * The company logo came with A5; SQLite has none.
 * The wiki came with A6: SQLite has only the former pages, which become
 * project pages whose owner is their author (see `WIKI_BACKFILL`).
 * Ticket attachments and the open branches of the ticket tree came with A8.2;
 * SQLite has neither.
 * The Text role, preferences and private assistant histories came with A8.3;
 * their native defaults and existing rows remain outside the legacy copy.
 */
async function readTargetColumns(
  target: Database,
): Promise<Map<string, readonly string[]>> {
  const rows = await target.query(
    `
      SELECT
          table_name,
          column_name
      FROM information_schema.columns
      WHERE table_schema = 'main'
          AND table_name NOT IN (
              'schema_migrations', 'instance_settings', 'roles', 'role_permissions',
              'departments', 'user_authorization', 'department_members', 'managed_departments',
              'project_departments', 'project_templates', 'project_template_goals',
              'project_template_tags', 'user_groups', 'user_group_members',
              'work_item_templates', 'work_item_template_departments',
              'work_item_template_projects', 'work_item_template_labels',
              'work_item_template_checklist_items', 'user_board_preferences',
              'instance_logo', 'wiki_page_anchors', 'wiki_page_versions',
              'wiki_page_links', 'wiki_attachments', 'wiki_comments', 'wiki_mentions',
              'wiki_favorites', 'wiki_recent_pages', 'wiki_expanded_pages',
              'wiki_user_state', 'wiki_settings',
              'agent_connections', 'agent_connection_checks', 'agent_model_catalogs',
              'work_item_attachments', 'work_item_tree_expansions',
              'text_assistant_settings', 'text_assistant_preferences',
              'assistant_conversations', 'assistant_messages',
              'agent_function_assignments'
          )
          AND NOT (
              table_name = 'wiki_pages'
              AND column_name NOT IN (
                  'id', 'project_id', 'author_id', 'title', 'content',
                  'created_at', 'updated_at'
              )
          )
          AND NOT (table_name = 'users' AND column_name = 'must_change_password')
          AND NOT (table_name = 'work_items' AND column_name = 'department_id')
          AND NOT (table_name = 'work_items' AND column_name = 'assignee_group_id')
          AND NOT (table_name = 'project_activity' AND column_name = 'work_item_id')
          AND NOT (table_name = 'project_integrations' AND column_name = 'sync_enabled')
          AND NOT (table_name = 'project_keys' AND column_name = 'last_number')
      ORDER BY table_name, ordinal_position;
    `,
  );
  const columnsByTable = new Map<string, string[]>();

  for (const row of rows) {
    const table = readTextColumn(row, 0, "table_name");

    columnsByTable.set(table, [
      ...(columnsByTable.get(table) ?? []),
      readTextColumn(row, 1, "column_name"),
    ]);
  }

  return columnsByTable;
}

function countSourceRows(
  source: SqliteDatabase.Database,
  table: string,
): number {
  const hasTable = source
    .prepare(
      "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?;",
    )
    .pluck()
    .get(table) as number;

  if (hasTable === 0) {
    throw new TransferError(`The SQLite database has no table "${table}".`);
  }

  return source
    .prepare(`SELECT COUNT(*) FROM ${quoteIdentifier(table)};`)
    .pluck()
    .get() as number;
}

async function countRows(
  database: Pick<DatabaseTransaction, "query">,
  table: string,
): Promise<number> {
  const rows = await database.query(
    `SELECT COUNT(*) FROM ${quoteIdentifier(table)};`,
  );

  return readCountColumn(rows.flat(), 0, `count of ${table}`);
}

/** Quotes a table or column name that comes from a database catalog. */
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function removeDatabaseFiles(databasePath: string): Promise<void> {
  await rm(databasePath, { force: true });
  await rm(`${databasePath}.wal`, { force: true });
}
