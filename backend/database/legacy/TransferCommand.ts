import path from "node:path";
import { fileURLToPath } from "node:url";

import { readMigrationFiles } from "@/backend/database/MigrationFiles";

import { transferSqliteToDuckDb, TransferError } from "./SqliteTransfer";

/** Where the command writes its report. */
export interface CommandOutput {
  log(message: string): void;
  error(message: string): void;
}

/** Exit codes of the transfer command. */
export const TRANSFER_EXIT_CODE = {
  FAILED: 1,
  SUCCESS: 0,
  USAGE: 2,
} as const;

const USAGE = [
  "Usage: pnpm db:transfer --source <pages.db> --target <pages.duckdb>",
  "",
  "Copies a SQLite Pages database into a new DuckDB file. The source is read",
  "only. Stop Pages first and work on a copy of the source file.",
].join("\n");

interface TransferArguments {
  readonly sourcePath: string;
  readonly targetPath: string;
}

function parseArguments(argv: readonly string[]): TransferArguments | null {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];

    if (
      (option !== "--source" && option !== "--target") ||
      value === undefined
    ) {
      return null;
    }

    values.set(option, value);
  }

  const sourcePath = values.get("--source");
  const targetPath = values.get("--target");

  if (!sourcePath || !targetPath) {
    return null;
  }

  return {
    sourcePath: path.resolve(sourcePath),
    targetPath: path.resolve(targetPath),
  };
}

/**
 * Runs the SQLite to DuckDB transfer for command-line arguments.
 *
 * @param argv - Arguments after the script name.
 * @param output - Receives the report lines.
 * @returns The process exit code, see {@link TRANSFER_EXIT_CODE}.
 */
export async function runTransferCommand(
  argv: readonly string[],
  output: CommandOutput,
): Promise<number> {
  const parsed = parseArguments(argv);

  if (!parsed || parsed.sourcePath === parsed.targetPath) {
    output.error(USAGE);

    return TRANSFER_EXIT_CODE.USAGE;
  }

  try {
    const migrations = await readMigrationFiles(
      fileURLToPath(new URL("../migrations-duckdb", import.meta.url)),
    );
    const legacyMigrations = await readMigrationFiles(
      fileURLToPath(new URL("../migrations", import.meta.url)),
    );
    const result = await transferSqliteToDuckDb({
      ...parsed,
      legacyMigrationNames: legacyMigrations.map((migration) => migration.name),
      migrations,
    });

    for (const table of result.tables) {
      output.log(
        `${table.table.padEnd(28)} ${String(table.sourceRows).padStart(8)} -> ${String(table.targetRows).padStart(8)}`,
      );
    }

    output.log(
      result.status === "copied"
        ? "Transfer finished: every row count matches."
        : "Nothing to do: the target already holds the rows of the source.",
    );

    return TRANSFER_EXIT_CODE.SUCCESS;
  } catch (error: unknown) {
    output.error(
      error instanceof TransferError
        ? error.message
        : `The transfer failed: ${String(error)}`,
    );

    return TRANSFER_EXIT_CODE.FAILED;
  }
}
