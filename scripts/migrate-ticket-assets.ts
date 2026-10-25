import { lstat } from "node:fs/promises";
import path from "node:path";

import { Database } from "../backend/database/Database";
import { TicketAssetMigrationRepository } from "../backend/database/repositories/task/TicketAssetMigrationRepository";
import { TicketAssetMigrationService } from "../backend/service/task/TicketAssetMigrationService";

/** Explicit offline operator command: never guesses a database or opens the default live instance. */
async function main(): Promise<void> {
  const [databasePath, backupDirectory, ...extra] = process.argv.slice(2);
  if (
    !databasePath ||
    !backupDirectory ||
    extra.length > 0 ||
    !path.isAbsolute(databasePath) ||
    !path.isAbsolute(backupDirectory)
  )
    throw new Error(
      "Usage: pnpm exec tsx scripts/migrate-ticket-assets.ts /absolute/data/pages.duckdb /absolute/new-backup-directory (Pages must be stopped)",
    );
  if (!(await lstat(databasePath)).isFile())
    throw new Error(
      "The explicit database path must be an existing regular file.",
    );
  const database = await Database.create(databasePath);
  try {
    const service = new TicketAssetMigrationService(
      new TicketAssetMigrationRepository(database),
      path.dirname(databasePath),
      backupDirectory,
    );
    console.info(JSON.stringify(await service.migrate(), null, 2));
  } finally {
    await database.close();
  }
}

await main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
