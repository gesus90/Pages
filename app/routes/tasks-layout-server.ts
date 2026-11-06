import { authenticatedUserContext } from "@/app/lib/auth.server";
import { readLocalStateAudience } from "@/app/lib/local-state/local-state-audience.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { TicketLayoutData } from "./tasks-layout";
import type { Route } from "./+types/tasks-layout-server";

/** Loads the ticket tree for the sidebar of every ticket page (A8.2-E08). */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<TicketLayoutData> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();
  const { ticketTreeService } = services;

  return {
    entries: await ticketTreeService.findEntries(actor),
    expandedKeys: await ticketTreeService.findExpandedKeys(actor),
    audience: await readLocalStateAudience(services, actor),
  };
}
