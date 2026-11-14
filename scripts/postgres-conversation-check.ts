/**
 * The real-database check of PAGE-349, `pnpm run postgres:conversation-check`.
 *
 * It starts a PostgreSQL server of its own in a temporary directory, migrates
 * an empty database to stand 056, seeds a round in the old shape, runs
 * migration 057 and checks the atomic double protection of hand-overs between
 * agents with concurrent connections. Like `postgres:check` it touches no
 * other instance and is no part of `test:backend`.
 */
import path from "node:path";

import { Database } from "@/backend/database/Database";
import { closeLogging, initializeLogging } from "@/backend/logging/Logger";

import { runConversationHandoffChecks } from "./postgres-check/conversation-handoff-checks";
import {
  PostgresProgramsMissingError,
  requirePostgresPrograms,
  TemporaryPostgres,
} from "./postgres-check/temporary-instance";
import { readMigrations } from "./read-database-migrations";

async function main(): Promise<void> {
  await requirePostgresPrograms();
  const instance = await TemporaryPostgres.prepare();
  try {
    await initializeLogging(path.join(instance.directory, "config.toml"));
    await instance.start();
    const database = await Database.connect(instance.url);
    try {
      const migrations = await readMigrations("postgres/migrations");
      for (const name of await runConversationHandoffChecks(
        database,
        migrations,
      ))
        console.info(`ok   ${name}`);
    } finally {
      await database.close();
    }
  } finally {
    await closeLogging();
    await instance.remove();
  }
  console.info("postgres:conversation-check passed");
}

try {
  await main();
} catch (error: unknown) {
  console.error(
    error instanceof PostgresProgramsMissingError ? error.message : error,
  );
  process.exitCode = 1;
}
