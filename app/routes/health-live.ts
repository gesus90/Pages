import { readDatabaseState } from "@/app/lib/database-state.server";

/**
 * Proves only that the Pages process answers HTTP; it says nothing about
 * whether the database works (PAGE-197).
 *
 * @remarks
 * Open without a session and reachable during the setup. It never opens,
 * queries or waits for the database, so it answers `200` with
 * `status: "alive"` even while the database worker restarts or failed. The
 * `database` field only names the worker state, or `not_started` before the
 * database was opened; whether Pages can serve requests is reported by
 * `/health`.
 */
export function loader(): Response {
  return Response.json(
    { status: "alive", database: readDatabaseState() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
