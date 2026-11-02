import { checkHealth } from "@/app/lib/health.server";

/**
 * Reports whether Pages works, for reverse proxies and uptime monitors.
 *
 * @remarks
 * Open without a session. It answers `200` while Pages runs, also while the
 * setup is pending, and `503` when the database worker is not ready or the
 * database does not answer within 3 seconds. Besides `status` it names the
 * state of the database worker, but no version, path or query. The process
 * alone is checked by `/health/live`.
 */
export async function loader(): Promise<Response> {
  const report = await checkHealth();

  return Response.json(report, {
    headers: { "Cache-Control": "no-store" },
    status: report.status === "unavailable" ? 503 : 200,
  });
}
