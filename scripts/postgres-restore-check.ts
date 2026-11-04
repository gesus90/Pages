/**
 * The check of the running backup, `pnpm run postgres:restore-check`.
 *
 * It restores the newest base backup into a throwaway instance on a free port,
 * replays the WAL archive up to a point in time and compares tables and row counts
 * with the source at that point. It writes the result as a log event and is no part
 * of `test:backend` or CI. See `docs/PostgresMigration.md`.
 */
import { runRestoreCheckCommand } from "./postgres-restore-check/restore-check-command";

process.exitCode = await runRestoreCheckCommand(process.argv.slice(2));
