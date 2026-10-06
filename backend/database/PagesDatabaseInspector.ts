import { DuckDBInstance } from "@duckdb/node-api";

/** What an existing file turned out to be. */
export type PagesDatabaseInspection =
  | {
      readonly kind: "pages";
      /** Whether at least one active administrator can sign in. */
      readonly hasActiveAdministrator: boolean;
    }
  | { readonly kind: "foreign" }
  | { readonly kind: "locked" };

/** The migration every Pages DuckDB database starts with. */
const BASELINE_MIGRATION_NAME = "001_baseline.sql";

const COUNT_PAGES_TABLES = `
  SELECT
      COUNT(*) FILTER (WHERE table_name = 'schema_migrations') AS migration_tables,
      COUNT(*) FILTER (WHERE table_name = 'users') AS user_tables,
      COUNT(*) FILTER (WHERE table_name = 'user_authorization') AS authorization_tables
  FROM information_schema.tables
  WHERE table_schema = 'main';
`;

const COUNT_BASELINE_MIGRATIONS = `
  SELECT COUNT(*) AS baseline_migrations
  FROM schema_migrations
  WHERE name = $name;
`;

const COUNT_ACTIVE_ADMINISTRATORS = `
  SELECT COUNT(*) AS active_administrators
  FROM users
  WHERE role = 'admin'
      AND is_active = 1;
`;

const COUNT_PERSONAL_ADMINISTRATORS = `
  SELECT COUNT(*) AS active_administrators
  FROM users
  INNER JOIN user_authorization AS access ON access.user_id = users.id
  WHERE access.is_admin = 1
      AND users.is_active = 1;
`;

type Connection = Awaited<ReturnType<DuckDBInstance["connect"]>>;

async function readCount(
  connection: Connection,
  statement: string,
  parameters?: Record<string, string>,
): Promise<number[]> {
  const reader = await connection.runAndReadAll(statement, parameters);
  const [row = []] = reader.getRows();

  return row.map((value) => Number(value));
}

/** DuckDB reports a file that another process holds open this way. */
function isLockError(error: unknown): boolean {
  return error instanceof Error && /\block\b/iu.test(error.message);
}

async function inspectOpenDatabase(
  connection: Connection,
): Promise<PagesDatabaseInspection> {
  const [migrationTables, userTables, authorizationTables] = await readCount(
    connection,
    COUNT_PAGES_TABLES,
  );

  if (migrationTables !== 1 || userTables !== 1) {
    return { kind: "foreign" };
  }

  const [baselineMigrations] = await readCount(
    connection,
    COUNT_BASELINE_MIGRATIONS,
    { name: BASELINE_MIGRATION_NAME },
  );

  if (baselineMigrations !== 1) {
    return { kind: "foreign" };
  }

  const [activeAdministrators] = await readCount(
    connection,
    authorizationTables === 1
      ? COUNT_PERSONAL_ADMINISTRATORS
      : COUNT_ACTIVE_ADMINISTRATORS,
  );

  return {
    hasActiveAdministrator: Number(activeAdministrators) > 0,
    kind: "pages",
  };
}

/**
 * Finds out without changing it whether an existing file is a Pages database.
 *
 * @param databasePath - Absolute path of an existing file.
 * @returns `pages` for a DuckDB file with the Pages schema, `locked` when
 * another process holds the file open, `foreign` for everything else.
 *
 * @remarks
 * The file is opened read-only, so neither the file nor its write-ahead log
 * changes. A file that is no DuckDB database at all fails to open and counts
 * as foreign.
 */
export async function inspectPagesDatabase(
  databasePath: string,
): Promise<PagesDatabaseInspection> {
  let instance: DuckDBInstance;

  try {
    instance = await DuckDBInstance.create(databasePath, {
      access_mode: "READ_ONLY",
    });
  } catch (error: unknown) {
    return isLockError(error) ? { kind: "locked" } : { kind: "foreign" };
  }

  try {
    const connection = await instance.connect();

    try {
      return await inspectOpenDatabase(connection);
    } finally {
      connection.closeSync();
    }
  } catch {
    return { kind: "foreign" };
  } finally {
    instance.closeSync();
  }
}
