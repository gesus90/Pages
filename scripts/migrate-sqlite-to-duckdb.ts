/**
 * One-time transfer of a SQLite Pages database into DuckDB.
 *
 * Run `pnpm db:transfer --source <pages.db> --target <pages.duckdb>` after
 * stopping Pages, on a copy of the source file. The logic and the checks live
 * in `backend/database/legacy/`.
 */
import { runTransferCommand } from "@/backend/database/legacy/TransferCommand";

process.exitCode = await runTransferCommand(process.argv.slice(2), console);
