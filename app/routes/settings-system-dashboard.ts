import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { forbidden } from "@/app/lib/settings-actions/settings-action-support.server";
import { listsAdminSettings } from "@/app/lib/settings-actions/settings-system-access.server";

import type { Route } from "./+types/settings-system-dashboard";

/** A measurement is current for a moment only; no cache may keep it. */
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/**
 * Answers the system dashboard only to an administrator in the active admin mode (PAGE-282).
 *
 * @remarks
 * The rights are read anew for every request, as for the other system
 * settings, so leaving the admin mode stops the data with the next poll.
 * Everyone else gets `403`.
 */
export async function loader({ context }: Route.LoaderArgs): Promise<Response> {
  const user = context.get(authenticatedUserContext);
  if (!user) throw forbidden();
  const services = await getApplicationServices();
  const account = await services.administrationService.getContext(user.id);
  if (!listsAdminSettings(account)) throw forbidden();
  const dashboard = await services.systemDashboardService.read(account);
  return Response.json(dashboard, { headers: NO_STORE });
}
