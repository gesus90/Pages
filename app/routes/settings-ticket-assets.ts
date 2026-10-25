import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { resolveSystemSettingsAccess } from "@/app/lib/settings-actions/settings-system-access.server";

import type { Route } from "./+types/settings-ticket-assets";

/** Runs an administrator-only, read-only inventory; remote image addresses are never requested. */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  const services = await getApplicationServices();
  if ((await resolveSystemSettingsAccess(services, actor)) !== "granted")
    throw new Response("Forbidden", { status: 403 });
  const report = await services.ticketAssetAuditService.inspect();
  return Response.json(report, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
