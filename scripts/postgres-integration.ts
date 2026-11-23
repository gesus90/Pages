/**
 * The integration suite of PostgreSQL and the SQL migrations,
 * `pnpm run test:integration`. It starts a throwaway PostgreSQL 18 server on a
 * free loopback port, runs the migration chain on an empty database and as an
 * upgrade of a documented earlier schema with fixtures, checks commit,
 * rollback, parameter binding and notifications against the real server,
 * removes the server and writes a report. The exit code is 0 only when every
 * check passed. See `docs/PostgresIntegration.md`.
 */
import { runIntegrationCommand } from "./postgres-integration/integration-command";

process.exitCode = await runIntegrationCommand(process.argv.slice(2));
