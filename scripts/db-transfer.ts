/**
 * The transfer of a DuckDB file into PostgreSQL, `pnpm run db:transfer`.
 *
 * It opens the file read-only, fills a PostgreSQL database without business data
 * table by table and compares row count and checksum of every table. It prints
 * table names and numbers only. See `docs/PostgresMigration.md`.
 */

// The message of a refused statement can quote a value, and the facade logs it
// to the error stream as long as logging has no directory. Set before the import,
// because the logger reads its level once.
process.env.PAGES_LOG_LEVEL = "fatal";

const { runTransferCommand } = await import("./db-transfer/transfer-command");

process.exitCode = await runTransferCommand(process.argv.slice(2));

// Top-level await needs a module, and a dynamic import does not make one.
export {};
