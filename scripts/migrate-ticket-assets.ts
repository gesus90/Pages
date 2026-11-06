import { spawn } from "node:child_process";
import path from "node:path";

import { Client } from "pg";

import { ConfigFile } from "../backend/config/ConfigFile";
import { Database } from "../backend/database/Database";
import { TicketAssetMigrationRepository } from "../backend/database/repositories/task/TicketAssetMigrationRepository";
import { TicketAssetMigrationService } from "../backend/service/task/TicketAssetMigrationService";

/** Runs an operator tool without exposing its environment or output. */
async function runTool(
  program: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(program, args, { env: environment, stdio: "ignore" });
    child.once("error", () => reject(new Error(`${program} could not start.`)));
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${program} did not complete successfully.`));
    });
  });
}

async function requireNoOtherClients(databaseUrl: string): Promise<void> {
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const result = await client.query<{ count: string }>(
      "SELECT count(*)::TEXT AS count FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();",
    );
    if (result.rows[0]?.count !== "0")
      throw new Error(
        "Other database connections exist. Stop all database writers before migration.",
      );
  } finally {
    await client.end();
  }
}

/** Explicit offline command; never guesses a configuration or accesses a live instance implicitly. */
async function main(): Promise<void> {
  process.umask(0o077);
  const [configPath, backupDirectory, ...options] = process.argv.slice(2);
  const isDryRun = options.length === 1 && options[0] === "--dry-run";
  if (
    !configPath ||
    !backupDirectory ||
    !path.isAbsolute(configPath) ||
    !path.isAbsolute(backupDirectory) ||
    (options.length !== 0 && !isDryRun)
  )
    throw new Error(
      "Usage: pnpm exec tsx scripts/migrate-ticket-assets.ts /absolute/config.toml /absolute/new-backup-directory [--dry-run]",
    );
  const config = await new ConfigFile(configPath).read();
  if (!config || config.firstRun || !config.databaseUrl)
    throw new Error("A completed PostgreSQL configuration is required.");
  await requireNoOtherClients(config.databaseUrl);
  const database = await Database.connect(config.databaseUrl);
  try {
    const environment: NodeJS.ProcessEnv = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith("PG")),
    );
    environment.PGDATABASE = config.databaseUrl;
    const backupDatabase = async (directory: string): Promise<void> => {
      const archive = path.join(directory, "postgres.dump");
      await runTool(
        "pg_dump",
        ["--format=custom", "--no-password", "--file", archive],
        environment,
      );
      await runTool(
        "pg_restore",
        ["--no-owner", "--no-privileges", archive],
        environment,
      );
    };
    const service = new TicketAssetMigrationService(
      new TicketAssetMigrationRepository(database),
      path.dirname(config.databasePath),
      backupDirectory,
      backupDatabase,
    );
    if (isDryRun) {
      const entries = await service.inspect();
      console.info(
        JSON.stringify(
          { dryRun: true, attachmentCount: entries.length, entries },
          null,
          2,
        ),
      );
    } else {
      console.info(JSON.stringify(await service.migrate(), null, 2));
    }
  } finally {
    await database.close();
  }
}

await main().catch(() => {
  console.error(
    "The asset migration failed. No connection details are reported.",
  );
  process.exitCode = 1;
});
