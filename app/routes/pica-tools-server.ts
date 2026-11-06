import { authenticatedUserContext } from "@/app/lib/auth.server";
import { readLocalStateAudience } from "@/app/lib/local-state/local-state-audience.server";
import { getApplicationServices } from "@/app/lib/services.server";

import type { PicaToolsData } from "./pica-tools";
import type { Route } from "./+types/pica-tools-server";

/** Offers an explicit task surface; eligibility is resolved from current persisted rights on every load. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<PicaToolsData> {
  const actor = context.get(authenticatedUserContext);
  if (!actor) return { isAllowed: false };
  try {
    const services = await getApplicationServices();
    await services.picaAdminService.requireAdministrator(actor.id);
    return {
      isAllowed: true,
      audience: await readLocalStateAudience(services, actor),
    };
  } catch {
    return { isAllowed: false };
  }
}
