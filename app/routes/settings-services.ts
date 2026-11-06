import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { createServerSettingsService } from "@/app/lib/settings-actions/settings-system-actions.server";
import { resolveSystemSettingsAccess } from "@/app/lib/settings-actions/settings-system-access.server";

import type { LoaderFunctionArgs } from "react-router";

/** Returns administrator-only restart warnings without contacting a monitored service. */
export async function loader({
  context,
}: LoaderFunctionArgs): Promise<Response> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) throw new Response("Forbidden", { status: 403 });
  const services = await getApplicationServices();
  if ((await resolveSystemSettingsAccess(services, actor)) !== "granted")
    throw new Response("Forbidden", { status: 403 });
  const settings = await createServerSettingsService({ services });
  return Response.json(await settings.readServiceMonitor(actor), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
