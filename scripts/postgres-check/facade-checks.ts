import { strict as assert } from "node:assert";

import { Database, isUniqueViolationOn } from "@/backend/database/Database";
import { sqlForDialect } from "@/backend/database/DatabaseDialect";
import { AbortedTransactionError } from "@/backend/database/postgres/PostgresConnection";
import { bindStatement } from "@/backend/database/postgres/PostgresStatement";
import {
  DatabaseOutcomeUnknownError,
  DatabaseUnavailableError,
} from "@/backend/database/executor/DatabaseExecutorErrors";

/** A named check of the facade against a running server. */
export interface FacadeCheck {
  readonly name: string;
  readonly run: (database: Database) => Promise<void>;
}

const CREATE_TABLES = `
  CREATE TABLE check_items (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      amount BIGINT,
      is_active BOOLEAN,
      content BYTEA
  );
  CREATE TABLE check_notes (
      note TEXT NOT NULL
  );
`;

const SELECT_ITEM_COUNT = "SELECT COUNT(id) FROM check_items;";

async function itemCount(database: Database): Promise<unknown> {
  const rows = await database.query(SELECT_ITEM_COUNT);
  return rows[0]?.[0];
}

async function checkExecute(database: Database): Promise<void> {
  await database.execute(CREATE_TABLES);
  await database.execute(
    `
      INSERT INTO check_items (
          id,
          name,
          amount,
          is_active,
          content
      )
      VALUES (
          $id,
          $name,
          $amount,
          $is_active,
          $content
      );
    `,
    {
      id: 1,
      name: "first",
      amount: 9_007_199_254_740_993n,
      is_active: true,
      content: Buffer.from([0, 1, 255]),
    },
  );
}

async function checkQueryValues(database: Database): Promise<void> {
  const rows = await database.query(
    `
      SELECT
          id,
          name,
          amount,
          is_active,
          content,
          COUNT(id) OVER () AS item_count,
          SUM(id) OVER () AS id_sum,
          1.5::NUMERIC AS fraction,
          0.25::DOUBLE PRECISION AS share,
          NULL::TEXT AS nothing,
          '2026-11-04 01:02:03'::TIMESTAMP AS stamped_at,
          '{"key": 1}'::JSONB AS document
      FROM check_items
      WHERE id = $id;
    `,
    { id: 1 },
  );
  assert.deepEqual(rows, [
    [
      1,
      "first",
      9_007_199_254_740_993n,
      1,
      Buffer.from([0, 1, 255]),
      1,
      1,
      1.5,
      0.25,
      null,
      "2026-11-04 01:02:03",
      '{"key": 1}',
    ],
  ]);
}

async function checkPlaceholders(database: Database): Promise<void> {
  const rows = await database.query(
    `
      -- $comment_name is no placeholder
      SELECT
          $first::TEXT AS first_value,
          $second::TEXT AS second_value,
          $first::TEXT AS first_again,
          '$literal' AS literal_text,
          E'it\\'s $escaped' AS escaped_text,
          $$ $quoted $$ AS quoted_text,
          $tag$ $tagged $tag$ AS tagged_text,
          1 AS "$column" /* $block */;
    `,
    { first: "a", second: "b" },
  );
  assert.deepEqual(rows, [
    ["a", "b", "a", "$literal", "it's $escaped", " $quoted ", " $tagged ", 1],
  ]);
  await assert.rejects(
    database.query("SELECT $missing::TEXT;"),
    /needs a value for "missing"/u,
  );
  await assert.rejects(
    database.query("SELECT 1;", { unused: 1 }),
    /has no parameter "unused"/u,
  );
}

async function checkCommit(database: Database): Promise<void> {
  const effects: string[] = [];
  const answer = await database.transaction(async (transaction) => {
    transaction.onCommit?.(() => {
      effects.push("commit");
      return Promise.resolve();
    });
    await transaction.execute(
      "INSERT INTO check_items (id, name) VALUES ($id, $name);",
      { id: 2, name: "second" },
    );
    return transaction.query("SELECT name FROM check_items WHERE id = $id;", {
      id: 2,
    });
  });
  assert.deepEqual(answer, [["second"]]);
  assert.deepEqual(effects, ["commit"]);
  assert.equal(await itemCount(database), 2);
}

async function checkRollback(database: Database): Promise<void> {
  const effects: string[] = [];
  await assert.rejects(
    database.transaction(async (transaction) => {
      transaction.onRollback?.(() => {
        effects.push("rollback");
        return Promise.resolve();
      });
      await transaction.execute(
        "INSERT INTO check_items (id, name) VALUES ($id, $name);",
        { id: 3, name: "third" },
      );
      throw new Error("planned failure");
    }),
    /planned failure/u,
  );
  assert.deepEqual(effects, ["rollback"]);
  assert.equal(await itemCount(database), 2);
}

async function checkFailedStatementRollsBack(
  database: Database,
): Promise<void> {
  let caught: unknown = null;
  try {
    await database.transaction(async (transaction) => {
      await transaction.execute(
        "INSERT INTO check_items (id, name) VALUES ($id, $name);",
        { id: 4, name: "fourth" },
      );
      await transaction.execute(
        "INSERT INTO check_items (id, name) VALUES ($id, $name);",
        { id: 5, name: "first" },
      );
    });
  } catch (error: unknown) {
    caught = error;
  }
  assert.equal(isUniqueViolationOn(caught, "name"), true);
  assert.equal(isUniqueViolationOn(caught, "id"), false);
  assert.equal(await itemCount(database), 2);
}

/** PostgreSQL answers this COMMIT without an error, but rolls back. */
async function checkSwallowedFailureIsNoCommit(
  database: Database,
): Promise<void> {
  const effects: string[] = [];
  await assert.rejects(
    database.transaction(async (transaction) => {
      transaction.onCommit?.(() => {
        effects.push("commit");
        return Promise.resolve();
      });
      transaction.onRollback?.(() => {
        effects.push("rollback");
        return Promise.resolve();
      });
      await transaction.execute(
        "INSERT INTO check_items (id, name) VALUES ($id, $name);",
        { id: 8, name: "eighth" },
      );
      await transaction
        .execute("INSERT INTO check_items (id, name) VALUES ($id, $name);", {
          id: 9,
          name: "first",
        })
        .catch((error: unknown) => {
          assert.equal(isUniqueViolationOn(error, "name"), true);
        });
    }),
    AbortedTransactionError,
  );
  assert.deepEqual(effects, ["rollback"]);
  assert.equal(await itemCount(database), 2);
}

async function checkReadTransaction(database: Database): Promise<void> {
  await database.readTransaction(async (transaction) => {
    const before = await transaction.query(SELECT_ITEM_COUNT);
    // Holds no writer here, so a change may finish while the snapshot stays open.
    await database.execute(
      "INSERT INTO check_items (id, name) VALUES ($id, $name);",
      { id: 6, name: "sixth" },
    );
    assert.deepEqual(await transaction.query(SELECT_ITEM_COUNT), before);
    await assert.rejects(
      transaction.execute("DELETE FROM check_items;"),
      /cannot change data/u,
    );
    await assert.rejects(
      transaction.query("DELETE FROM check_items RETURNING id;"),
      /cannot change data/u,
    );
  });
  assert.equal(await itemCount(database), 3);
}

async function checkSynchronousCommit(database: Database): Promise<void> {
  assert.deepEqual(
    await database.query("SELECT current_setting('synchronous_commit');"),
    [["on"]],
  );
}

async function checkDialect(database: Database): Promise<void> {
  assert.equal(database.dialect, "postgres");
  const statement = sqlForDialect(database.dialect, {
    duckdb: "SELECT 'duckdb';",
    postgres: "SELECT 'postgres';",
  });
  assert.deepEqual(await database.query(statement), [["postgres"]]);
}

async function checkPool(database: Database): Promise<void> {
  const status = database.executorStatus();
  assert.equal(status.readerConnections + 1, 10);
  const reads = Array.from({ length: 18 }, () =>
    database.query("SELECT pg_sleep(0.3)::TEXT, pg_backend_pid();"),
  );
  // All reader connections are busy now; the writer has its own.
  await database.execute("INSERT INTO check_notes (note) VALUES ($note);", {
    note: "beside the readers",
  });
  const running = database.executorStatus().readers;
  assert.equal(running.running, status.readerConnections);
  const rows = await Promise.all(reads);
  const connections = new Set(rows.map((row) => row[0]?.[1]));
  assert.ok(connections.size <= status.readerConnections);
  assert.ok(connections.size > 1);
}

async function otherConnections(database: Database): Promise<unknown> {
  const rows = await database.query(
    `
      SELECT COUNT(pg_terminate_backend(pid))
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
          AND datname = current_database();
    `,
  );
  return rows[0]?.[0];
}

async function checkLostIdleConnections(database: Database): Promise<void> {
  assert.ok(Number(await otherConnections(database)) > 0);
  // The pool notices on the next turn of the event loop.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await itemCount(database), 3);
}

async function checkLostConnectionInTransaction(
  database: Database,
): Promise<void> {
  await assert.rejects(
    database.transaction(async (transaction) => {
      await transaction.execute(
        "INSERT INTO check_items (id, name) VALUES ($id, $name);",
        { id: 7, name: "seventh" },
      );
      const rows = await transaction.query("SELECT pg_backend_pid();");
      await database.query("SELECT pg_terminate_backend($pid);", {
        pid: Number(rows[0]?.[0]),
      });
      await transaction.execute("DELETE FROM check_notes;");
    }),
    DatabaseOutcomeUnknownError,
  );
  assert.equal(await itemCount(database), 3);
  await database.execute("DELETE FROM check_notes WHERE note = $note;", {
    note: "absent",
  });
}

/**
 * Proves that a closed facade refuses work without touching the server.
 *
 * @param database - The facade after its `close`.
 */
export async function checkClosed(database: Database): Promise<void> {
  assert.equal(database.executorStatus().worker.state, "closed");
  await assert.rejects(database.query("SELECT 1;"), DatabaseUnavailableError);
  await assert.rejects(
    database.execute("DELETE FROM check_notes;"),
    DatabaseUnavailableError,
  );
}

/** A text the log of the run must not hold, because it stands beside a removed U+0000. */
export const NUL_CHECK_TEXT = "text-beside-a-nul-of-the-check";

async function storedNote(database: Database, note: string): Promise<unknown> {
  await database.execute("DELETE FROM check_notes;");
  await database.execute("INSERT INTO check_notes (note) VALUES ($note);", {
    note,
  });
  const rows = await database.query("SELECT note FROM check_notes;");
  return rows[0]?.[0];
}

/** Only the character goes: its JSON escapes, other control characters and bytes stay. */
async function checkNulInText(database: Database): Promise<void> {
  const document = JSON.stringify({ note: `a\u0000b\\u0000` });
  assert.equal(document.includes("\u0000"), false);
  for (const unchanged of [
    document,
    "\\u0000",
    "\\\\u0000",
    "\u0001\u001f\t\n ü🦊",
    "",
  ])
    assert.equal(await storedNote(database, unchanged), unchanged);
  assert.deepEqual(JSON.parse(String(await storedNote(database, document))), {
    note: `a\u0000b\\u0000`,
  });
  assert.equal(
    await storedNote(database, `\u0000${NUL_CHECK_TEXT}\u0000\u0000ä`),
    `${NUL_CHECK_TEXT}ä`,
  );
  assert.equal(await storedNote(database, "\u0000"), "");

  // What was stored without the character is found by the text it was stored with.
  await storedNote(database, "a\u0000b");
  const found = await database.query(
    "SELECT note FROM check_notes WHERE note = $note;",
    { note: "a\u0000b" },
  );
  assert.deepEqual(found, [["ab"]]);

  const bytes = Buffer.from([0, 65, 0]);
  await database.execute(
    "INSERT INTO check_items (id, name, content) VALUES (90, 'nul-bytes', $content);",
    { content: bytes },
  );
  const [row] = await database.query(
    "SELECT content FROM check_items WHERE id = 90;",
  );
  assert.deepEqual(row?.[0], bytes);
  await database.execute("DELETE FROM check_items WHERE id = 90;");
  await database.execute("DELETE FROM check_notes;");

  const counted = { first: "\u0000a\u0000", second: "\\u0000", third: 1 };
  assert.equal(
    bindStatement("SELECT $first, $second, $first, $third;", counted)
      .removedNulCharacters,
    2,
  );
}

/** Every check of the open facade, in the order they build on each other. */
export const FACADE_CHECKS: readonly FacadeCheck[] = [
  { name: "execute: several statements, then bound values", run: checkExecute },
  { name: "query: results map to the row values", run: checkQueryValues },
  { name: "query: named placeholders are translated", run: checkPlaceholders },
  { name: "transaction: commit", run: checkCommit },
  { name: "transaction: rollback when the work fails", run: checkRollback },
  {
    name: "transaction: rollback after a refused statement",
    run: checkFailedStatementRollsBack,
  },
  {
    name: "transaction: a swallowed failure never counts as committed",
    run: checkSwallowedFailureIsNoCommit,
  },
  {
    name: "readTransaction: one snapshot, no changes",
    run: checkReadTransaction,
  },
  { name: "synchronous_commit stays on", run: checkSynchronousCommit },
  { name: "dialect choice", run: checkDialect },
  {
    name: "U+0000 leaves a bound text, nothing else does",
    run: checkNulInText,
  },
  { name: "pool of 10: readers beside the writer", run: checkPool },
  { name: "lost idle connections are replaced", run: checkLostIdleConnections },
  {
    name: "lost connection during a transaction",
    run: checkLostConnectionInTransaction,
  },
];
