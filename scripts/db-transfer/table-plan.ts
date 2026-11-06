import { POSTGRES_TYPE_OF_DUCKDB_TYPE } from "../postgres-check/legacy-schema-shape";
import { TransferRefusal } from "./transfer-refusal";

/** A column as a catalog describes it. */
export interface TableColumn {
  readonly name: string;
  readonly type: string;
}

/** The columns of every table of one database, in column order. */
export type TableColumns = ReadonlyMap<string, readonly TableColumn[]>;

/** A foreign key between two tables of the target. */
export interface ForeignKey {
  readonly table: string;
  readonly referencedTable: string;
}

/** What the transfer knows about one table before it reads a row. */
export interface TablePlan {
  readonly name: string;
  readonly columns: readonly string[];
  /** The primary key, or every column for a table without one. */
  readonly sortColumns: readonly string[];
  /** The columns of type text, the only ones U+0000 can leave. */
  readonly textColumns: readonly string[];
}

/** The catalogs a plan is made from. */
export interface PlanInput {
  readonly sourceColumns: TableColumns;
  readonly targetColumns: TableColumns;
  readonly primaryKeys: ReadonlyMap<string, readonly string[]>;
  readonly foreignKeys: readonly ForeignKey[];
}

/**
 * Quotes a table or column name that comes from a catalog.
 *
 * @param identifier - The name.
 * @returns The name for a statement of either database.
 */
export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * The select list of a table, the same for both databases.
 *
 * @param plan - The table.
 * @returns The quoted columns in column order.
 */
export function columnListOf(plan: TablePlan): string {
  return plan.columns.map(quoteIdentifier).join(", ");
}

/**
 * The sort order of a table, the same for both databases.
 *
 * @param plan - The table.
 * @returns The `ORDER BY` terms.
 *
 * @remarks
 * Text sorts by its bytes in both: DuckDB always, PostgreSQL because
 * `Database.connect` refuses another locale.
 */
export function sortClauseOf(plan: TablePlan): string {
  return plan.sortColumns
    .map((column) => `${quoteIdentifier(column)} ASC NULLS FIRST`)
    .join(", ");
}

/**
 * The sort order of a table in DuckDB, which equals that of the target.
 *
 * @param plan - The table.
 * @returns The `ORDER BY` terms.
 *
 * @remarks
 * The target sorts a key without U+0000, so the rows of the source have to arrive
 * in that order to reach the same checksum.
 */
export function sourceSortClauseOf(plan: TablePlan): string {
  return plan.sortColumns
    .map((column) => {
      const quoted = quoteIdentifier(column);
      const term = plan.textColumns.includes(column)
        ? `replace(${quoted}, chr(0), '')`
        : quoted;
      return `${term} ASC NULLS FIRST`;
    })
    .join(", ");
}

function describeColumns(columns: readonly TableColumn[]): string {
  return columns.map((column) => `${column.name} ${column.type}`).join(", ");
}

function compareCatalogs(
  source: TableColumns,
  target: TableColumns,
): readonly string[] {
  const findings: string[] = [];
  for (const table of source.keys())
    if (!target.has(table)) findings.push(`table only in DuckDB: ${table}`);
  for (const [table, targetColumns] of target) {
    const sourceColumns = source.get(table);
    if (sourceColumns === undefined) {
      findings.push(`table only in PostgreSQL: ${table}`);
      continue;
    }
    const expected = sourceColumns.map((column) => ({
      name: column.name,
      type: POSTGRES_TYPE_OF_DUCKDB_TYPE[column.type] ?? column.type,
    }));
    if (describeColumns(expected) !== describeColumns(targetColumns))
      findings.push(`columns of ${table} differ`);
  }
  return findings;
}

/** Tables without a foreign key keep their name order, so a report stays comparable. */
function orderByForeignKeys(
  tables: readonly string[],
  foreignKeys: readonly ForeignKey[],
): readonly string[] {
  const remaining = [...tables].sort();
  const ordered: string[] = [];
  while (remaining.length > 0) {
    const next = remaining.find(
      (table) =>
        !foreignKeys.some(
          (key) =>
            key.table === table &&
            key.referencedTable !== table &&
            remaining.includes(key.referencedTable),
        ),
    );
    if (next === undefined)
      throw new TransferRefusal(
        `The foreign keys of these tables form a cycle: ${remaining.join(", ")}.`,
      );
    ordered.push(next);
    remaining.splice(remaining.indexOf(next), 1);
  }
  return ordered;
}

/**
 * Compares both catalogs and puts the tables into a copying order.
 *
 * @param input - The catalogs of source and target.
 * @returns One plan per table; a table comes after every table it refers to.
 * @throws {TransferRefusal} When the schemas differ or the foreign keys form a cycle.
 */
export function planTables(input: PlanInput): readonly TablePlan[] {
  const findings = compareCatalogs(input.sourceColumns, input.targetColumns);
  if (findings.length > 0)
    throw new TransferRefusal(
      `The schemas of source and target differ:\n  ${findings.join("\n  ")}`,
    );
  return orderByForeignKeys(
    [...input.targetColumns.keys()],
    input.foreignKeys,
  ).map((name) => {
    const tableColumns = input.targetColumns.get(name) ?? [];
    const columns = tableColumns.map((column) => column.name);
    const primaryKey = input.primaryKeys.get(name) ?? [];
    return {
      name,
      columns,
      sortColumns: primaryKey.length > 0 ? primaryKey : columns,
      textColumns: tableColumns
        .filter((column) => column.type === "text")
        .map((column) => column.name),
    };
  });
}
