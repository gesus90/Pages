import { checkHealth } from "@/app/lib/health.server";

/**
 * Reports whether Pages works, for reverse proxies and uptime monitors.
 *
 * @remarks
 * Open without a session. It answers `200` while Pages runs, also while the
 * setup is pending, and `503` when the database does not answer. It names no
 * version and no path.
 */
export async function loader(): Promise<Response> {
  const status = await checkHealth();

  return Response.json(
    { status },
    {
      headers: { "Cache-Control": "no-store" },
      status: status === "unavailable" ? 503 : 200,
    },
  );
}
