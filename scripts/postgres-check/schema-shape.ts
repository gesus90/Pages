import type { Database, DatabaseValue } from "@/backend/database/Database";

const TIME_COLUMN_DEFAULT = "utc_now()";

const TABLES = `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE';
  `;

const VIEWS = `
    SELECT table_name
    FROM information_schema.views
    WHERE table_schema = 'public';
  `;

const COLUMNS = `
    SELECT
        table_name,
        column_name,
        data_type,
        is_nullable = 'YES',
        column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY
        table_name,
        ordinal_position;
  `;

const CONSTRAINTS = `
    SELECT
        classes.relname,
        CASE constraints.contype WHEN 'c' THEN 'check' ELSE 'key' END,
        pg_get_constraintdef(constraints.oid)
    FROM pg_constraint AS constraints
    INNER JOIN pg_class AS classes
        ON classes.oid = constraints.conrelid
    INNER JOIN pg_namespace AS namespaces
        ON namespaces.oid = classes.relnamespace
    WHERE namespaces.nspname = 'public'
        AND constraints.contype IN ('p', 'u', 'f', 'c');
  `;

/** PostgreSQL backs a key with an index of its own, DuckDB does not list one. */
const INDEXES = `
    SELECT
        classes.relname,
        pg_get_indexdef(indexes.indexrelid)
    FROM pg_index AS indexes
    INNER JOIN pg_class AS classes
        ON classes.oid = indexes.indexrelid
    INNER JOIN pg_namespace AS namespaces
        ON namespaces.oid = classes.relnamespace
    LEFT JOIN pg_constraint AS constraints
        ON constraints.conindid = indexes.indexrelid
        AND constraints.contype IN ('p', 'u')
    WHERE namespaces.nspname = 'public'
        AND constraints.oid IS NULL;
  `;

const SEQUENCES = `
    SELECT
        sequencename,
        start_value,
        increment_by,
        min_value,
        max_value,
        cycle
    FROM pg_sequences
    WHERE schemaname = 'public';
  `;

/** One column as both catalogs can describe it. */
export interface ColumnShape {
  readonly name: string;
  readonly type: string;
  readonly isNullable: boolean;
  /** The default in the notation both share; `null` when there is none. */
  readonly defaultValue: string | null;
}

/** One table: columns in order, then what the catalogs say about its rows. */
export interface TableShape {
  readonly columns: readonly ColumnShape[];
  /** Primary key, unique constraints and foreign keys, sorted. */
  readonly keys: readonly string[];
  /** The check constraints as their catalog writes them, sorted. */
  readonly checks: readonly string[];
  /** The rows a fresh database holds, without their time stamps, sorted. */
  readonly rows: readonly string[];
}

/** Everything `postgres:check` compares between two freshly migrated databases. */
export interface SchemaShape {
  readonly tables: ReadonlyMap<string, TableShape>;
  readonly views: ReadonlyMap<string, readonly ColumnShape[]>;
  readonly indexes: ReadonlyMap<string, string>;
  readonly sequences: ReadonlyMap<string, string>;
}

function cellText(cell: DatabaseValue | undefined): string {
  if (Buffer.isBuffer(cell)) return cell.toString("hex");
  return String(cell);
}

/** Removes what only the notation of a catalog adds: quotes, spaces, the schema. */
function normalizeDefinition(definition: string): string {
  return definition
    .replaceAll("public.", "")
    .replaceAll("USING btree", "")
    .replaceAll('"', "")
    .replaceAll(/\s+/gu, "")
    .replace(/;$/u, "")
    .replace(/\(\((.*)\)\)$/u, "($1)");
}

/** Removes the casts PostgreSQL writes out and spells DuckDB's booleans like it. */
function normalizeDefault(
  defaultValue: DatabaseValue | undefined,
): string | null {
  if (defaultValue === null || defaultValue === undefined) return null;
  return cellText(defaultValue)
    .replaceAll(/::(?:text|regclass|bigint|integer)\b/gu, "")
    .replace("CAST('t' AS BOOLEAN)", "true")
    .replace("CAST('f' AS BOOLEAN)", "false");
}

function columnsByTable(
  rows: readonly DatabaseValue[][],
): ReadonlyMap<string, readonly ColumnShape[]> {
  const found = new Map<string, ColumnShape[]>();
  for (const row of rows) {
    const table = cellText(row[0]);
    const type = cellText(row[2]);
    const column: ColumnShape = {
      name: cellText(row[1]),
      type,
      isNullable: row[3] === 1,
      defaultValue: normalizeDefault(row[4]),
    };
    found.set(table, [...(found.get(table) ?? []), column]);
  }
  return found;
}

function constraintsOf(
  rows: readonly DatabaseValue[][],
  table: string,
  kind: "key" | "check",
): readonly string[] {
  return rows
    .filter((row) => cellText(row[0]) === table && cellText(row[1]) === kind)
    .map((row) => cellText(row[2]))
    .map((text) => (kind === "key" ? normalizeDefinition(text) : text))
    .sort();
}

/** Time stamps are the one thing two fresh databases cannot share. */
async function readRows(
  database: Database,
  table: string,
  columns: readonly ColumnShape[],
): Promise<readonly string[]> {
  const list = columns
    .filter((column) => column.defaultValue !== TIME_COLUMN_DEFAULT)
    .map((column) => `"${column.name}"`)
    .join(", ");
  const rows = await database.query(`SELECT ${list} FROM "${table}";`);
  return rows.map((row) => row.map(cellText).join(" | ")).sort();
}

async function readNames(
  database: Database,
  statement: string,
): Promise<readonly string[]> {
  const rows = await database.query(statement);
  return rows.map((row) => cellText(row[0])).sort();
}

async function readDefinitions(
  database: Database,
  statement: string,
): Promise<ReadonlyMap<string, string>> {
  const rows = await database.query(statement);
  return new Map(
    rows
      .map(
        (row) =>
          [
            cellText(row[0]),
            normalizeDefinition(row.slice(1).map(cellText).join(" ")),
          ] as const,
      )
      .sort(([first], [second]) => first.localeCompare(second)),
  );
}

/**
 * Reads the schema of a freshly migrated database through the facade.
 *
 * @param database - An open database of either dialect.
 * @returns The schema in the notation both dialects share.
 */
export async function readSchemaShape(
  database: Database,
): Promise<SchemaShape> {
  const columns = columnsByTable(await database.query(COLUMNS));
  const constraints = await database.query(CONSTRAINTS);
  const tables = new Map<string, TableShape>();
  for (const table of await readNames(database, TABLES)) {
    const tableColumns = columns.get(table) ?? [];
    tables.set(table, {
      columns: tableColumns,
      keys: constraintsOf(constraints, table, "key"),
      checks: constraintsOf(constraints, table, "check"),
      rows: await readRows(database, table, tableColumns),
    });
  }
  const viewNames = await readNames(database, VIEWS);
  return {
    tables,
    views: new Map(
      viewNames.map((view) => [view, columns.get(view) ?? []] as const),
    ),
    indexes: await readDefinitions(database, INDEXES),
    sequences: await readDefinitions(database, SEQUENCES),
  };
}
