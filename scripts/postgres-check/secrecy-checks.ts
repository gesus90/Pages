import { strict as assert } from "node:assert";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { ConfigError, readPagesConfig } from "@/backend/config/PagesConfig";
import { Database } from "@/backend/database/Database";
import { logEvent } from "@/backend/logging/Logger";

import type { TemporaryPostgres } from "./temporary-instance";

const WRONG_PASSWORD = "wrong-password-of-the-check";
const INVALID_PASSWORD_CODE = "28P01";

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/**
 * Opens the database with a wrong password, through the path of a server start.
 *
 * @param instance - The running server.
 */
export async function causeWrongPasswordFailure(
  instance: TemporaryPostgres,
): Promise<void> {
  await assert.rejects(
    Database.connect(instance.urlWith(WRONG_PASSWORD)),
    (error) => hasCode(error, INVALID_PASSWORD_CODE),
  );
  // Whatever a later message may quote, the known secrets do not pass.
  logEvent({
    level: "error",
    event: "postgres_check.quoted_url",
    component: "PostgresCheck",
    message: `A message that quotes ${instance.url} by mistake`,
  });
}

/** The configuration selects PostgreSQL and never quotes the URL when it refuses. */
export function checkConfiguration(): void {
  const secret = "secret-of-the-configuration-check";
  const finished = {
    firstRun: false,
    port: 3999,
    databasePath: "/data/pages.duckdb",
  };
  const databaseUrl = `postgresql://pages:${secret}@127.0.0.1/pages`;

  assert.equal(
    "databaseUrl" in readPagesConfig(finished, "config.toml"),
    false,
  );
  assert.deepEqual(
    readPagesConfig({ ...finished, databaseUrl }, "config.toml"),
    { ...finished, databaseUrl },
  );
  for (const table of [
    { ...finished, databaseUrl: `mysql://pages:${secret}@127.0.0.1/pages` },
    { ...finished, databaseUrl: `postgresql://pages:${secret}@[` },
    { ...finished, databaseUrl: secret },
    {
      ...finished,
      databaseUrl: `postgresql://pages:%zz${secret}@127.0.0.1/pages`,
    },
    { ...finished, firstRun: true, databaseUrl },
  ])
    assert.throws(
      () => readPagesConfig(table, "config.toml"),
      (error) =>
        error instanceof ConfigError &&
        !JSON.stringify(error, Object.getOwnPropertyNames(error)).includes(
          secret,
        ),
    );
}

async function pagesLogText(directory: string): Promise<string> {
  const logDirectory = path.join(directory, "log");
  const files = await readdir(logDirectory);
  const texts = await Promise.all(
    files.map((file) => readFile(path.join(logDirectory, file), "utf8")),
  );
  return texts.join("");
}

/**
 * Searches everything the run logged for the URL and its passwords.
 *
 * @param instance - The server of the run.
 * @param consoleText - What the process wrote to its standard streams.
 * @returns How many lines were searched.
 * @throws When a line holds the URL or a password, or when the failure with the
 * wrong password left no line, which would prove nothing.
 */
export async function checkLogs(
  instance: TemporaryPostgres,
  consoleText: string,
): Promise<number> {
  const pagesLog = await pagesLogText(instance.directory);
  const serverLog = await readFile(instance.serverLog, "utf8");
  const lines = `${pagesLog}\n${consoleText}\n${serverLog}`.split("\n");
  const correctPassword = new URL(instance.url).password;
  for (const line of lines) {
    assert.equal(line.includes("postgresql://pages_check"), false);
    assert.equal(line.includes(correctPassword), false);
    assert.equal(line.includes(WRONG_PASSWORD), false);
  }
  const failure = pagesLog
    .split("\n")
    .find((line) => line.includes('"database.open_failed"'));
  assert.ok(failure?.includes(`"code":"${INVALID_PASSWORD_CODE}"`));
  assert.ok(pagesLog.includes('"postgres_check.quoted_url"'));
  return lines.length;
}
