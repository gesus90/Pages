import assert from "node:assert/strict";

import { Database } from "../../backend/database/Database";
import {
  LIVE_CHANGE_CHANNEL,
  LiveChangeNotificationRepository,
} from "../../backend/database/repositories/LiveChangeNotificationRepository";
import { PostgresNotificationListener } from "../../backend/database/postgres/PostgresNotificationListener";

import { runCheck, singleNumber } from "./check-support";

import type { CheckResult, IntegrationContext } from "./check-support";

const CREATE_VALUES_TABLE = `
  CREATE TABLE integration_values (
      id TEXT PRIMARY KEY,
      body TEXT,
      amount BIGINT,
      is_done INTEGER,
      payload BYTEA
  );
`;

const INSERT_VALUE = `
  INSERT INTO integration_values (
      id,
      body,
      amount,
      is_done,
      payload
  )
  VALUES (
      $id,
      $body,
      $amount,
      $is_done,
      $payload
  );
`;

const COUNT_VALUES = "SELECT count(*) FROM integration_values;";

const NOTIFICATION_TIMEOUT_MS = 15_000;

const NOTIFICATION_POLL_MS = 20;

/** The text of an injection attempt; bound as a value, it must stay plain text. */
const HOSTILE_TEXT =
  'x\'); DROP TABLE integration_values; -- $id "quoted" $1 \\ ünïcödé 日本語';

/** Opens a database with a scratch table, runs the work and always closes it. */
async function withValuesTable<Result>(
  url: string,
  work: (database: Database) => Promise<Result>,
): Promise<Result> {
  const database = await Database.connect(url);
  try {
    await database.execute(CREATE_VALUES_TABLE);
    return await work(database);
  } finally {
    await database.close();
  }
}

async function countValues(database: Database): Promise<number> {
  return singleNumber(await database.query(COUNT_VALUES));
}

async function checkCommit(context: IntegrationContext): Promise<string> {
  const url = await context.createDatabase("commit");
  return withValuesTable(url, async (database) => {
    const result = await database.transaction(async (transaction) => {
      await transaction.execute(INSERT_VALUE, {
        id: "a",
        body: "first",
        amount: 1,
        is_done: 0,
        payload: null,
      });
      await transaction.execute(INSERT_VALUE, {
        id: "b",
        body: "second",
        amount: 2,
        is_done: 0,
        payload: null,
      });
      return "returned";
    });
    assert.equal(result, "returned");
    assert.equal(await countValues(database), 2);
    return "both statements of a transaction are visible after its commit";
  });
}

async function checkRollback(context: IntegrationContext): Promise<string> {
  const url = await context.createDatabase("rollback");
  return withValuesTable(url, async (database) => {
    await assert.rejects(
      database.transaction(async (transaction) => {
        await transaction.execute(INSERT_VALUE, {
          id: "a",
          body: "lost",
          amount: 1,
          is_done: 0,
          payload: null,
        });
        throw new Error("integration failure");
      }),
      /integration failure/u,
    );
    assert.equal(await countValues(database), 0, "A thrown error kept a row.");

    // A rejected statement ends the whole transaction, the earlier statement included.
    await assert.rejects(
      database.transaction(async (transaction) => {
        await transaction.execute(INSERT_VALUE, {
          id: "b",
          body: "lost",
          amount: 1,
          is_done: 0,
          payload: null,
        });
        await transaction.execute(INSERT_VALUE, {
          id: "b",
          body: "duplicate",
          amount: 1,
          is_done: 0,
          payload: null,
        });
      }),
    );
    assert.equal(
      await countValues(database),
      0,
      "A rejected statement kept a row.",
    );

    // The database still works after both rollbacks.
    await database.execute(INSERT_VALUE, {
      id: "c",
      body: "kept",
      amount: 1,
      is_done: 0,
      payload: null,
    });
    assert.equal(await countValues(database), 1);
    return "a thrown error and a rejected statement each roll the whole transaction back; the database stays usable";
  });
}

async function checkBinding(context: IntegrationContext): Promise<string> {
  const url = await context.createDatabase("binding");
  return withValuesTable(url, async (database) => {
    const payload = Buffer.from([0, 1, 2, 253, 254, 255]);
    const largeNumber = 9007199254740993n;
    await database.execute(INSERT_VALUE, {
      id: "hostile",
      body: HOSTILE_TEXT,
      amount: largeNumber,
      is_done: true,
      payload,
    });
    await database.execute(INSERT_VALUE, {
      id: "empty",
      body: null,
      amount: null,
      is_done: false,
      payload: null,
    });
    const rows = await database.query(
      "SELECT id, body, amount, is_done, payload FROM integration_values ORDER BY id;",
    );
    assert.deepEqual(rows, [
      ["empty", null, null, 0, null],
      ["hostile", HOSTILE_TEXT, largeNumber, 1, payload],
    ]);

    // The same name twice is one value; the value is compared, never read as SQL.
    const matches = await database.query(
      "SELECT id FROM integration_values WHERE body = $body OR id = $body;",
      { body: HOSTILE_TEXT },
    );
    assert.deepEqual(matches, [["hostile"]]);

    // U+0000 cannot be stored: it is removed on write and finds nothing when compared.
    await database.execute(INSERT_VALUE, {
      id: "nul",
      body: "a\u0000b",
      amount: 0,
      is_done: 0,
      payload: null,
    });
    assert.deepEqual(
      await database.query(
        "SELECT body FROM integration_values WHERE id = $id;",
        {
          id: "nul",
        },
      ),
      [["ab"]],
    );
    assert.deepEqual(
      await database.query(
        "SELECT id FROM integration_values WHERE body = $body;",
        { body: "a\u0000b" },
      ),
      [],
    );

    await assert.rejects(
      database.query("SELECT id FROM integration_values WHERE id = $id;", {}),
      /needs a value for "id"/u,
    );
    await assert.rejects(
      database.query("SELECT id FROM integration_values;", { unused: "x" }),
      /has no parameter "unused"/u,
    );
    assert.equal(
      await countValues(database),
      3,
      "A statement ran as SQL text.",
    );
    return "text with quotes, placeholders and an injection attempt, a bigint beyond 2^53, bytes, null and booleans round-trip as values; U+0000 and a missing or unknown parameter are handled";
  });
}

/** Collects the notifications of one listening session. */
class NotificationInbox {
  private readonly payloads: string[] = [];
  private isListening = false;

  /**
   * Receives one payload.
   * @param payload - The payload of the notification.
   */
  public receive(payload: string): void {
    this.payloads.push(payload);
  }

  /** Notes that the session listens. */
  public markListening(): void {
    this.isListening = true;
  }

  /**
   * Tells whether the session reported that it listens.
   * @returns Whether `markListening` was called.
   */
  public hasListening(): boolean {
    return this.isListening;
  }

  /**
   * Lists every payload received so far.
   * @returns The payloads in the order they arrived.
   */
  public received(): readonly string[] {
    return [...this.payloads];
  }

  /**
   * Waits until the condition holds.
   * @param condition - What to wait for.
   * @param description - What a timeout reports as missing.
   * @throws When the condition does not hold in time.
   */
  public async waitFor(
    condition: () => boolean,
    description: string,
  ): Promise<void> {
    const deadline = Date.now() + NOTIFICATION_TIMEOUT_MS;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(`Missing: ${description}.`);
      await new Promise((resolve) => setTimeout(resolve, NOTIFICATION_POLL_MS));
    }
  }
}

async function checkNotifications(
  context: IntegrationContext,
): Promise<string> {
  const url = await context.createDatabase("notifications");
  const database = await Database.connect(url);
  const inbox = new NotificationInbox();
  const listener = new PostgresNotificationListener(url, LIVE_CHANGE_CHANNEL, {
    onMessage: (payload) => inbox.receive(payload),
    onListening: () => inbox.markListening(),
  });
  try {
    listener.start();
    await inbox.waitFor(() => inbox.hasListening(), "the LISTEN session");

    // A notification belongs to its transaction: a rollback sends nothing.
    await assert.rejects(
      database.transaction(async (transaction) => {
        await transaction.execute("SELECT pg_notify($channel, $payload);", {
          channel: LIVE_CHANGE_CHANNEL,
          payload: "rolled-back",
        });
        throw new Error("integration failure");
      }),
      /integration failure/u,
    );
    await database.transaction(async (transaction) => {
      await transaction.execute("SELECT pg_notify($channel, $payload);", {
        channel: LIVE_CHANGE_CHANNEL,
        payload: "committed",
      });
    });
    await new LiveChangeNotificationRepository(database).notify("direct");

    await inbox.waitFor(
      () => inbox.received().length >= 2,
      "the notifications of a commit and of a direct send",
    );
    // Notifications arrive in send order, so nothing of the rollback is still on its way.
    assert.deepEqual(inbox.received(), ["committed", "direct"]);
    return "committed and direct notifications reach a listening session in order; a rolled-back one is never delivered";
  } finally {
    await listener.stop();
    await database.close();
  }
}

/**
 * Runs the checks of commit, rollback, parameter binding and notifications
 * against the real server.
 * @param context - The run.
 * @returns One result per check.
 */
export async function runDatabaseChecks(
  context: IntegrationContext,
): Promise<readonly CheckResult[]> {
  return [
    await runCheck("commit", () => checkCommit(context)),
    await runCheck("rollback", () => checkRollback(context)),
    await runCheck("parameter binding", () => checkBinding(context)),
    await runCheck("notifications", () => checkNotifications(context)),
  ];
}
