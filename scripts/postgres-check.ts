/**
 * The real check of the PostgreSQL path, `pnpm run postgres:check`.
 *
 * It starts a server of its own in a temporary directory on a free loopback
 * port, runs the checks through the database facade, stops the server and
 * deletes the directory. It touches no other instance, does not use the
 * `postgresql` service, and is no part of `test:backend` or CI: unit tests never
 * start a database server. Later tickets add their checks here.
 */
import path from "node:path";

import { Database } from "@/backend/database/Database";
import { closeLogging, initializeLogging } from "@/backend/logging/Logger";

import { checkClosed, FACADE_CHECKS } from "./postgres-check/facade-checks";
import { runSchemaChecks } from "./postgres-check/schema-checks";
import {
  causeWrongPasswordFailure,
  checkConfiguration,
  checkLogs,
} from "./postgres-check/secrecy-checks";
import {
  PostgresProgramsMissingError,
  requirePostgresPrograms,
  TemporaryPostgres,
} from "./postgres-check/temporary-instance";

const EXIT_AFTER_SIGNAL = 130;

/** Keeps what the process writes, so the search for the URL covers it too. */
function captureConsole(): () => string {
  let captured = "";
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    stream.write = (chunk: string | Uint8Array, ...rest: never[]): boolean => {
      captured +=
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return write(chunk, ...rest);
    };
  }
  return () => captured;
}

async function runChecks(
  instance: TemporaryPostgres,
  readConsole: () => string,
): Promise<void> {
  await initializeLogging(path.join(instance.directory, "config.toml"));
  await instance.start();
  console.info("ok   temporary instance started");

  checkConfiguration();
  console.info("ok   configuration selects PostgreSQL and hides the URL");

  const database = await Database.connect(instance.url);
  try {
    for (const check of FACADE_CHECKS) {
      await check.run(database);
      console.info(`ok   ${check.name}`);
    }
    await runSchemaChecks(instance, database);
  } finally {
    await database.close();
  }
  await checkClosed(database);
  console.info("ok   a closed facade refuses work");

  await causeWrongPasswordFailure(instance);
  await closeLogging();
  const lines = await checkLogs(instance, readConsole());
  console.info(
    `ok   wrong password fails with 28P01; none of ${String(lines)} log lines holds the URL`,
  );
}

async function main(): Promise<void> {
  await requirePostgresPrograms();
  const readConsole = captureConsole();
  const instance = await TemporaryPostgres.prepare();
  const removeAfterSignal = (): void => {
    void instance.remove().finally(() => process.exit(EXIT_AFTER_SIGNAL));
  };
  process.once("SIGINT", removeAfterSignal);
  process.once("SIGTERM", removeAfterSignal);
  try {
    await runChecks(instance, readConsole);
  } finally {
    process.off("SIGINT", removeAfterSignal);
    process.off("SIGTERM", removeAfterSignal);
    await closeLogging();
    await instance.remove();
  }
  console.info("ok   no process and no temporary directory remain");
  console.info("postgres:check passed");
}

try {
  await main();
} catch (error: unknown) {
  console.error(
    error instanceof PostgresProgramsMissingError ? error.message : error,
  );
  process.exitCode = 1;
}
