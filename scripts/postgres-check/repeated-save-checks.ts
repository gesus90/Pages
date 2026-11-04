import { strict as assert } from "node:assert";

import { Database } from "@/backend/database/Database";
import { WorkItemWriteRepository } from "@/backend/database/repositories/task/WorkItemWriteRepository";

import { readMigrations } from "./schema-checks";

import type { SqlParameters } from "@/backend/database/Database";
import type { WorkItemUpdate } from "@/backend/database/repositories/task/WorkItemWriteRepository";
import type { TemporaryPostgres } from "./temporary-instance";

const DATABASE_NAME = "pages_repeated_save_check";
const ID = "repeat";
const OLD_TIME = "2020-01-01 00:00:00";
const OTHER_TIME = "2021-01-01 00:00:00";
const TEXT_WITH_NUL = "mit\u0000Zeichen";
const STORED_TEXT = "mitZeichen";
const STALE_BASE = "veraltet";
const LOCK_POLLS = 200;
const LOCK_POLL_MS = 25;

const UPDATE: WorkItemUpdate = {
  title: "Titel",
  description: TEXT_WITH_NUL,
  baseDescription: STALE_BASE,
  statusId: "status-todo",
  priority: "normal",
  assigneeId: null,
  assigneeGroupId: null,
  reporterId: "user",
  parentId: null,
  milestoneId: null,
  dueAt: null,
  startAt: null,
};

/** The two connections that interleave, and one that watches them. */
interface Connections {
  readonly saving: Database;
  readonly other: Database;
  readonly observer: Database;
}

/** The row as a concurrent reader finds it. */
interface StoredRow {
  readonly description: unknown;
  readonly title: unknown;
  readonly updatedAt: unknown;
  readonly isArchived: boolean;
  /** Changes with every version of the row, also when all its values stay. */
  readonly rowVersion: unknown;
}

/** What the other connection does to the row while the save runs. */
interface OtherChange {
  readonly statement: string;
  readonly parameters: SqlParameters;
}

/** Ends the transaction of the other connection without storing its change. */
class RolledBackByCheck extends Error {}

async function readRow({ observer }: Connections): Promise<StoredRow> {
  const [row] = await observer.query(
    `
      SELECT
          description,
          title,
          updated_at,
          archived_at IS NOT NULL,
          CAST(xmin AS TEXT)
      FROM work_items
      WHERE id = $id;
    `,
    { id: ID },
  );
  assert.ok(row);
  return {
    description: row[0],
    title: row[1],
    updatedAt: row[2],
    isArchived: row[3] === 1,
    rowVersion: row[4],
  };
}

async function resetRow(
  { observer }: Connections,
  description: string,
): Promise<void> {
  await observer.execute(
    `
      UPDATE work_items
      SET
          description = $description,
          title = 'Titel',
          archived_at = NULL,
          updated_at = $time
      WHERE id = $id;
    `,
    { description, id: ID, time: OLD_TIME },
  );
}

/** Waits until the save stands at the row lock of the other connection. */
async function waitForLock({ observer }: Connections): Promise<void> {
  for (let poll = 0; poll < LOCK_POLLS; poll += 1) {
    const [row] = await observer.query(`
      SELECT COUNT(*)
      FROM pg_stat_activity
      WHERE datname = current_database()
          AND wait_event_type = 'Lock';
    `);
    if (row?.[0] !== 0) return;
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
  assert.fail("The save never waited for the row of the other connection.");
}

/**
 * Lets a save start while the other connection holds an unfinished change of the row.
 *
 * @returns What the save reports once the other transaction ended.
 */
async function saveDuring(
  connections: Connections,
  change: OtherChange,
  ending: "commit" | "rollback",
  save: (writes: WorkItemWriteRepository) => Promise<boolean>,
): Promise<boolean> {
  const writes = new WorkItemWriteRepository(connections.saving);
  let saved: Promise<boolean> | undefined;
  try {
    await connections.other.transaction(async (transaction) => {
      await transaction.execute(change.statement, change.parameters);
      saved = save(writes);
      await waitForLock(connections);
      if (ending === "rollback") throw new RolledBackByCheck();
    });
  } catch (error: unknown) {
    if (!(error instanceof RolledBackByCheck)) throw error;
  }
  assert.ok(saved);
  return saved;
}

const CHANGE_TEXT: OtherChange = {
  statement:
    "UPDATE work_items SET description = 'Fremd', updated_at = $time WHERE id = $id;",
  parameters: { id: ID, time: OTHER_TIME },
};
const SAME_TEXT: OtherChange = {
  statement:
    "UPDATE work_items SET description = $stored, updated_at = $time WHERE id = $id;",
  parameters: { id: ID, stored: STORED_TEXT, time: OTHER_TIME },
};
const CHANGE_TITLE: OtherChange = {
  statement:
    "UPDATE work_items SET title = 'Fremder Titel', updated_at = $time WHERE id = $id;",
  parameters: { id: ID, time: OTHER_TIME },
};
const ARCHIVE: OtherChange = {
  statement:
    "UPDATE work_items SET archived_at = $time, updated_at = $time WHERE id = $id;",
  parameters: { id: ID, time: OTHER_TIME },
};

async function checkConcurrentChanges(connections: Connections): Promise<void> {
  const saveText = (writes: WorkItemWriteRepository): Promise<boolean> =>
    writes.updateDescription(ID, TEXT_WITH_NUL, STALE_BASE);
  const saveAll = (writes: WorkItemWriteRepository): Promise<boolean> =>
    writes.update(ID, UPDATE);

  for (const save of [saveText, saveAll]) {
    await resetRow(connections, STORED_TEXT);
    assert.equal(
      await saveDuring(connections, CHANGE_TEXT, "commit", save),
      false,
    );
    let row = await readRow(connections);
    assert.equal(
      row.description,
      "Fremd",
      "A committed change was overwritten.",
    );
    assert.equal(row.updatedAt, OTHER_TIME);

    await resetRow(connections, STORED_TEXT);
    assert.equal(
      await saveDuring(connections, CHANGE_TEXT, "rollback", save),
      true,
    );
    row = await readRow(connections);
    assert.equal(row.description, STORED_TEXT);
    assert.notEqual(row.updatedAt, OLD_TIME);

    await resetRow(connections, STORED_TEXT);
    assert.equal(
      await saveDuring(connections, SAME_TEXT, "commit", save),
      true,
    );
    assert.equal((await readRow(connections)).description, STORED_TEXT);

    await resetRow(connections, STORED_TEXT);
    assert.equal(await saveDuring(connections, ARCHIVE, "commit", save), false);
    row = await readRow(connections);
    assert.equal(row.isArchived, true);
    assert.equal(row.description, STORED_TEXT);
    assert.equal(row.updatedAt, OTHER_TIME);
  }
}

async function checkConcurrentExpectedField(
  connections: Connections,
): Promise<void> {
  await resetRow(connections, STORED_TEXT);
  const isSaved = await saveDuring(
    connections,
    CHANGE_TITLE,
    "commit",
    (writes) =>
      writes.update(ID, {
        ...UPDATE,
        expected: {
          title: "Titel",
          statusId: "status-todo",
          priority: "normal",
          assigneeId: null,
          assigneeGroupId: null,
          reporterId: "user",
          parentId: null,
          milestoneId: null,
          dueAt: null,
          startAt: null,
        },
      }),
  );
  assert.equal(isSaved, false);
  const row = await readRow(connections);
  assert.equal(row.title, "Fremder Titel");
  assert.equal(row.description, STORED_TEXT);
}

/** A conflict writes nothing at all: not even a new version of the row. */
async function checkConflictWritesNothing(
  connections: Connections,
): Promise<void> {
  const writes = new WorkItemWriteRepository(connections.saving);
  await resetRow(connections, "Fremd");
  const before = await readRow(connections);
  assert.equal(
    await writes.updateDescription(ID, TEXT_WITH_NUL, STALE_BASE),
    false,
  );
  assert.equal(await writes.update(ID, UPDATE), false);
  assert.deepEqual(await readRow(connections), before);

  await resetRow(connections, STORED_TEXT);
  assert.equal(
    await writes.updateDescription(ID, "Neu", TEXT_WITH_NUL),
    false,
    "A base with the character found the text without it.",
  );
  assert.equal((await readRow(connections)).description, STORED_TEXT);
}

async function checkRepeatsAtOnce(connections: Connections): Promise<void> {
  await resetRow(connections, STORED_TEXT);
  const results = await Promise.all(
    [connections.saving, connections.other].map((database) =>
      new WorkItemWriteRepository(database).updateDescription(
        ID,
        TEXT_WITH_NUL,
        STALE_BASE,
      ),
    ),
  );
  assert.deepEqual(results, [true, true]);
  assert.equal((await readRow(connections)).description, STORED_TEXT);
}

/**
 * Interleaves a repeated save with U+0000 and a change on a second connection.
 *
 * @param instance - The running server.
 * @param administration - An open connection to create the database with.
 *
 * @remarks
 * Two flows in sequence cannot show this: the save has to stand at the lock while the
 * other change commits. Only PostgreSQL has several writers, so DuckDB takes no part.
 */
export async function runRepeatedSaveChecks(
  instance: TemporaryPostgres,
  administration: Database,
): Promise<void> {
  await administration.execute(`CREATE DATABASE ${DATABASE_NAME};`);
  const url = instance.urlOfDatabase(DATABASE_NAME);
  const [saving, other, observer] = await Promise.all([
    Database.connect(url),
    Database.connect(url),
    Database.connect(url),
  ]);
  try {
    await observer.migrate(await readMigrations("postgres/migrations"));
    await observer.execute(
      `
        INSERT INTO work_items (id, project_id, key, number, type, title, status_id, created_by)
        VALUES ($id, 'project', 'REPEAT-1', 1, 'task', 'Titel', 'status-todo', 'user');
      `,
      { id: ID },
    );
    const connections = { saving, other, observer };
    await checkConcurrentChanges(connections);
    await checkConcurrentExpectedField(connections);
    await checkConflictWritesNothing(connections);
    await checkRepeatsAtOnce(connections);
  } finally {
    await Promise.all([saving.close(), other.close(), observer.close()]);
  }
}
