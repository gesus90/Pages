import { rm } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { logCaughtError } from "@/backend/logging/Logger";

import {
  expireProviderFiles,
  isProtectedProviderEntry,
  physicalStorageDirectory,
  storageEntries,
  storageMetadata,
} from "./StorageFiles";

const TRANSCRIPT_DIRECTORIES = [
  "codex/sessions",
  "claude/projects",
  "opencode/opencode/storage",
] as const;
const OPENCODE_DATABASE_PATHS = [
  "opencode/opencode/opencode.db",
  "opencode/opencode.db",
] as const;
const CODEX_THREAD_HISTORY_DATABASE = "codex/thread_history_1.sqlite";
const ANTIGRAVITY_HISTORY =
  /^(?:sessions?|history|histories|conversations?)(?:$|[-_.])/iu;
const OPENCODE_SESSION_TIME_COLUMNS = [
  "time_updated",
  "time_created",
  "updated_at",
  "created_at",
] as const;
const OPENCODE_AUXILIARY_SESSION_TABLES = ["todo", "session_share"] as const;
const CODEX_TURN_TIME_COLUMNS = [
  "completed_at",
  "started_at",
  "updated_at_ms",
  "updated_at",
  "created_at_ms",
  "created_at",
] as const;
const CODEX_ITEM_TIME_COLUMNS = [
  "updated_at_ms",
  "created_at_ms",
  "updated_at",
  "created_at",
] as const;
const SQLITE_BUSY_ERRCODES = new Set([5, 6]);

async function physicalStorageFile(
  root: string,
  relative: string,
): Promise<string | null> {
  const segments = relative.split("/");
  const fileName = segments.pop();
  if (!fileName) return null;
  const parent =
    segments.length > 0
      ? await physicalStorageDirectory(root, segments.join("/"))
      : await physicalStorageDirectory(root, "");
  if (!parent) return null;
  const location = path.join(parent, fileName);
  const metadata = await storageMetadata(location);
  return metadata?.isFile() && !metadata.isSymbolicLink() ? location : null;
}

function isSqliteBusyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (
    "errcode" in error &&
    typeof error.errcode === "number" &&
    SQLITE_BUSY_ERRCODES.has(error.errcode & 0xff)
  )
    return true;
  if (error instanceof Error)
    return /database is (?:locked|busy)/iu.test(error.message);
  return false;
}

function listTables(database: DatabaseSync): ReadonlySet<string> {
  const rows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table';")
    .all();
  const names = new Set<string>();
  for (const row of rows) {
    if (typeof row.name === "string") names.add(row.name);
  }
  return names;
}

function tableColumns(
  database: DatabaseSync,
  table: string,
): ReadonlySet<string> {
  const rows = database.prepare(`PRAGMA table_info(${table});`).all();
  const names = new Set<string>();
  for (const row of rows) {
    if (typeof row.name === "string") names.add(row.name);
  }
  return names;
}

function readFreelistCount(database: DatabaseSync): number {
  const row = database.prepare("PRAGMA freelist_count;").get();
  if (!row) return 0;
  const value = row.freelist_count;
  return typeof value === "number" ? value : Number(value ?? 0);
}

function timestampMsExpression(column: string): string {
  return `CASE
    WHEN typeof(${column}) IN ('integer', 'real') THEN
      CASE WHEN ${column} >= 100000000000 THEN ${column} ELSE ${column} * 1000 END
    WHEN typeof(${column}) = 'text' THEN
      CAST(strftime('%s', ${column}) AS INTEGER) * 1000
    ELSE NULL
  END`;
}

function coalesceTimestampExpression(
  table: string,
  columns: readonly string[],
): string {
  const expressions = columns.map((column) =>
    timestampMsExpression(`${table}.${column}`),
  );
  return expressions.length === 1
    ? `(${expressions[0]})`
    : `COALESCE(${expressions.join(", ")})`;
}

function countChanges(result: { readonly changes: number | bigint }): number {
  return Number(result.changes);
}

function selectExpiredOpenCodeSessions(
  database: DatabaseSync,
  tables: ReadonlySet<string>,
  sessionColumns: ReadonlySet<string>,
  cutoffMs: number,
): number {
  const sessionTimeColumns = OPENCODE_SESSION_TIME_COLUMNS.filter((column) =>
    sessionColumns.has(column),
  );
  if (sessionTimeColumns.length === 0) return 0;
  const sessionActivity = coalesceTimestampExpression(
    "session",
    sessionTimeColumns,
  );
  const messageColumns = tables.has("message")
    ? tableColumns(database, "message")
    : new Set<string>();
  const messageTimeColumns = OPENCODE_SESSION_TIME_COLUMNS.filter((column) =>
    messageColumns.has(column),
  );
  const hasMessageTime =
    messageColumns.has("session_id") && messageTimeColumns.length > 0;
  const messageClause = hasMessageTime
    ? ` OR EXISTS (
        SELECT 1 FROM message
        WHERE message.session_id = session.id
          AND ${coalesceTimestampExpression("message", messageTimeColumns)} >= ?
      )`
    : "";
  const directClause = `(${sessionActivity} IS NULL OR ${sessionActivity} >= ?)${messageClause}`;
  const params = hasMessageTime ? [cutoffMs, cutoffMs] : [cutoffMs];
  const query = sessionColumns.has("parent_id")
    ? `WITH RECURSIVE
        direct_retained (id) AS (
          SELECT session.id FROM session WHERE ${directClause}
        ),
        ancestors (id) AS (
          SELECT id FROM direct_retained
          UNION
          SELECT parent.id
          FROM session AS child
          INNER JOIN ancestors ON ancestors.id = child.id
          INNER JOIN session AS parent ON parent.id = child.parent_id
        ),
        retained (id) AS (
          SELECT id FROM ancestors
          UNION
          SELECT child.id
          FROM session AS child
          INNER JOIN retained ON retained.id = child.parent_id
        )
      INSERT INTO _pages_expired_sessions (id)
      SELECT session.id
      FROM session
      WHERE session.id NOT IN (SELECT id FROM retained);`
    : `INSERT INTO _pages_expired_sessions (id)
      SELECT session.id
      FROM session
      WHERE NOT (${directClause});`;
  return countChanges(database.prepare(query).run(...params));
}

function deleteOpenCodeSessionDependents(
  database: DatabaseSync,
  tables: ReadonlySet<string>,
): number {
  let deleted = 0;
  const messageColumns = tables.has("message")
    ? tableColumns(database, "message")
    : new Set<string>();
  if (tables.has("part")) {
    const partColumns = tableColumns(database, "part");
    if (partColumns.has("session_id"))
      deleted += countChanges(
        database
          .prepare(
            "DELETE FROM part WHERE session_id IN (SELECT id FROM _pages_expired_sessions);",
          )
          .run(),
      );
    else if (
      partColumns.has("message_id") &&
      messageColumns.has("id") &&
      messageColumns.has("session_id")
    )
      deleted += countChanges(
        database
          .prepare(
            "DELETE FROM part WHERE message_id IN (SELECT id FROM message WHERE session_id IN (SELECT id FROM _pages_expired_sessions));",
          )
          .run(),
      );
  }
  if (messageColumns.has("session_id"))
    deleted += countChanges(
      database
        .prepare(
          "DELETE FROM message WHERE session_id IN (SELECT id FROM _pages_expired_sessions);",
        )
        .run(),
    );
  for (const table of OPENCODE_AUXILIARY_SESSION_TABLES) {
    if (!tables.has(table) || !tableColumns(database, table).has("session_id"))
      continue;
    deleted += countChanges(
      database
        .prepare(
          `DELETE FROM ${table} WHERE session_id IN (SELECT id FROM _pages_expired_sessions);`,
        )
        .run(),
    );
  }
  return deleted;
}

function pruneOpenCodeRows(database: DatabaseSync, cutoffMs: number): number {
  const tables = listTables(database);
  if (!tables.has("session")) return 0;
  const sessionColumns = tableColumns(database, "session");
  if (!sessionColumns.has("id")) return 0;
  database.exec("DROP TABLE IF EXISTS _pages_expired_sessions;");
  database.exec(
    "CREATE TEMP TABLE _pages_expired_sessions (id TEXT PRIMARY KEY);",
  );
  try {
    const expired = selectExpiredOpenCodeSessions(
      database,
      tables,
      sessionColumns,
      cutoffMs,
    );
    if (expired === 0) return 0;
    let deleted = deleteOpenCodeSessionDependents(database, tables);
    if (sessionColumns.has("parent_id"))
      database
        .prepare(
          "UPDATE session SET parent_id = NULL WHERE id IN (SELECT id FROM _pages_expired_sessions);",
        )
        .run();
    deleted += countChanges(
      database
        .prepare(
          "DELETE FROM session WHERE id IN (SELECT id FROM _pages_expired_sessions);",
        )
        .run(),
    );
    return deleted;
  } finally {
    database.exec("DROP TABLE IF EXISTS _pages_expired_sessions;");
  }
}

function codexActivityQueries(
  database: DatabaseSync,
  tables: ReadonlySet<string>,
): readonly string[] {
  const sources: {
    readonly table: string;
    readonly keyCandidates: readonly string[];
    readonly timeColumns: readonly string[];
  }[] = [
    {
      table: "thread_turns",
      keyCandidates: ["thread_id"],
      timeColumns: CODEX_TURN_TIME_COLUMNS,
    },
    {
      table: "thread_items",
      keyCandidates: ["thread_id"],
      timeColumns: CODEX_ITEM_TIME_COLUMNS,
    },
    {
      table: "thread_history_projection_state",
      keyCandidates: ["thread_id"],
      timeColumns: CODEX_ITEM_TIME_COLUMNS,
    },
    {
      table: "threads",
      keyCandidates: ["id", "thread_id"],
      timeColumns: CODEX_ITEM_TIME_COLUMNS,
    },
  ];
  const queries: string[] = [];
  for (const source of sources) {
    if (!tables.has(source.table)) continue;
    const columns = tableColumns(database, source.table);
    const key = source.keyCandidates.find((candidate) =>
      columns.has(candidate),
    );
    const timestamps = source.timeColumns.filter((column) =>
      columns.has(column),
    );
    if (!key || timestamps.length === 0) continue;
    queries.push(
      `SELECT ${source.table}.${key} AS thread_id, ${coalesceTimestampExpression(source.table, timestamps)} AS activity_ms FROM ${source.table} WHERE ${source.table}.${key} IS NOT NULL`,
    );
  }
  return queries;
}

function pruneCodexThreadHistoryRows(
  database: DatabaseSync,
  cutoffMs: number,
): number {
  const tables = listTables(database);
  const activityQueries = codexActivityQueries(database, tables);
  if (activityQueries.length === 0) return 0;
  database.exec("DROP TABLE IF EXISTS _pages_expired_threads;");
  database.exec(
    "CREATE TEMP TABLE _pages_expired_threads (thread_id TEXT PRIMARY KEY);",
  );
  try {
    const expired = countChanges(
      database
        .prepare(
          `WITH activity (thread_id, activity_ms) AS (
            ${activityQueries.join(" UNION ALL ")}
          )
          INSERT INTO _pages_expired_threads (thread_id)
          SELECT thread_id
          FROM activity
          GROUP BY thread_id
          HAVING MAX(activity_ms) IS NOT NULL
            AND MAX(activity_ms) < ?
            AND SUM(CASE WHEN activity_ms IS NULL THEN 1 ELSE 0 END) = 0;`,
        )
        .run(cutoffMs),
    );
    if (expired === 0) return 0;
    let deleted = 0;
    for (const table of [
      "thread_items",
      "thread_turns",
      "thread_history_projection_state",
    ] as const) {
      if (!tables.has(table) || !tableColumns(database, table).has("thread_id"))
        continue;
      deleted += countChanges(
        database
          .prepare(
            `DELETE FROM ${table} WHERE thread_id IN (SELECT thread_id FROM _pages_expired_threads);`,
          )
          .run(),
      );
    }
    if (tables.has("threads")) {
      const columns = tableColumns(database, "threads");
      const key = ["id", "thread_id"].find((candidate) =>
        columns.has(candidate),
      );
      if (key)
        deleted += countChanges(
          database
            .prepare(
              `DELETE FROM threads WHERE ${key} IN (SELECT thread_id FROM _pages_expired_threads);`,
            )
            .run(),
        );
    }
    return deleted;
  } finally {
    database.exec("DROP TABLE IF EXISTS _pages_expired_threads;");
  }
}

function runExclusiveSqliteMaintenance(
  databasePath: string,
  prune: (database: DatabaseSync) => number,
): boolean {
  const database = new DatabaseSync(databasePath, { timeout: 0 });
  let inTransaction = false;
  try {
    database.exec("PRAGMA busy_timeout = 0;");
    database.exec("PRAGMA locking_mode = EXCLUSIVE;");
    database.exec("PRAGMA foreign_keys = ON;");
    database.exec("BEGIN EXCLUSIVE;");
    inTransaction = true;
    const deleted = prune(database);
    database.exec("COMMIT;");
    inTransaction = false;
    if (deleted > 0 || readFreelistCount(database) > 0)
      database.exec("VACUUM;");
    return true;
  } catch (error: unknown) {
    if (inTransaction) {
      try {
        database.exec("ROLLBACK;");
      } catch (rollbackError: unknown) {
        logCaughtError("ProviderSessionMaintenance", rollbackError);
      }
    }
    if (isSqliteBusyError(error)) return false;
    throw error;
  } finally {
    database.close();
  }
}

/**
 * Prunes expired sessions and messages from an OpenCode SQLite database and compacts it when idle.
 * @param databasePath - Physical path to `opencode.db`.
 * @param cutoffMs - Retention cutoff in epoch milliseconds; newer sessions stay.
 * @returns `true` when maintenance completed; `false` when the file is missing or currently locked by a provider.
 */
export async function maintainOpenCodeDatabase(
  databasePath: string,
  cutoffMs: number,
): Promise<boolean> {
  const metadata = await storageMetadata(databasePath);
  if (!metadata?.isFile() || metadata.isSymbolicLink()) return false;
  return runExclusiveSqliteMaintenance(databasePath, (database) =>
    pruneOpenCodeRows(database, cutoffMs),
  );
}

/**
 * Prunes expired threads from a Codex thread-history SQLite database and compacts it when idle.
 * @param databasePath - Physical path to `thread_history_1.sqlite`.
 * @param cutoffMs - Retention cutoff in epoch milliseconds; newer threads stay.
 * @returns `true` when maintenance completed; `false` when the file is missing or currently locked by a provider.
 */
export async function maintainCodexThreadHistoryDatabase(
  databasePath: string,
  cutoffMs: number,
): Promise<boolean> {
  const metadata = await storageMetadata(databasePath);
  if (!metadata?.isFile() || metadata.isSymbolicLink()) return false;
  return runExclusiveSqliteMaintenance(databasePath, (database) =>
    pruneCodexThreadHistoryRows(database, cutoffMs),
  );
}

async function attemptDatabaseMaintenance(
  work: () => Promise<boolean>,
): Promise<void> {
  try {
    await work();
  } catch (error: unknown) {
    logCaughtError("ProviderSessionMaintenance", error);
  }
}

async function maintainConnectionDatabases(
  directory: string,
  cutoff: number,
): Promise<void> {
  for (const relative of OPENCODE_DATABASE_PATHS) {
    const databasePath = await physicalStorageFile(directory, relative);
    if (databasePath)
      await attemptDatabaseMaintenance(() =>
        maintainOpenCodeDatabase(databasePath, cutoff),
      );
  }
  const codexHistory = await physicalStorageFile(
    directory,
    CODEX_THREAD_HISTORY_DATABASE,
  );
  if (codexHistory)
    await attemptDatabaseMaintenance(() =>
      maintainCodexThreadHistoryDatabase(codexHistory, cutoff),
    );
}

async function antigravityHistory(
  directory: string,
  cutoff: number,
): Promise<void> {
  for (const entry of await storageEntries(directory)) {
    if (isProtectedProviderEntry(entry.name)) continue;
    const location = path.join(directory, entry.name);
    const metadata = await storageMetadata(location);
    if (!metadata || metadata.isSymbolicLink()) continue;
    if (metadata.isDirectory()) {
      if (ANTIGRAVITY_HISTORY.test(entry.name))
        await expireProviderFiles(location, cutoff);
      else await antigravityHistory(location, cutoff);
    } else if (
      metadata.isFile() &&
      ANTIGRAVITY_HISTORY.test(entry.name) &&
      metadata.mtimeMs < cutoff
    ) {
      await rm(location, { force: true });
    }
  }
}

/** Sweeps provider transcript paths, obsolete OpenCode pnpm stores and aged provider SQLite rows while idle. */
export async function maintainProviderSessions(
  root: string,
  cutoff: number,
): Promise<void> {
  const agents = await physicalStorageDirectory(root, "agents");
  if (!agents) return;
  for (const connection of await storageEntries(agents)) {
    if (!connection.isDirectory() || connection.isSymbolicLink()) continue;
    const directory = path.join(agents, connection.name);
    for (const relative of TRANSCRIPT_DIRECTORIES) {
      const transcripts = await physicalStorageDirectory(directory, relative);
      if (transcripts) await expireProviderFiles(transcripts, cutoff);
    }
    const antigravity = await physicalStorageDirectory(
      directory,
      "antigravity/antigravity-acp",
    );
    if (antigravity) await antigravityHistory(antigravity, cutoff);
    const legacyStore = await physicalStorageDirectory(
      directory,
      "opencode/pnpm",
    );
    if (legacyStore) await rm(legacyStore, { recursive: true, force: true });
    await maintainConnectionDatabases(directory, cutoff);
  }
}
