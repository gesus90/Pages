import { authenticatedUserContext } from "@/app/lib/auth.server";
import { readLocalStateAudience } from "@/app/lib/local-state/local-state-audience.server";
import { parseInstant } from "@/app/lib/region-format";
import { getApplicationServices } from "@/app/lib/services.server";

import type { WikiTrashLoaderData } from "./wiki-trash";
import type { Route } from "./+types/wiki-trash-server";

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

/** Loads the deleted pages the account may restore, with their remaining time. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<WikiTrashLoaderData> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();
  const { wikiService } = services;
  const [entries, settings, audience] = await Promise.all([
    wikiService.listTrash(actor),
    wikiService.getSettings(),
    readLocalStateAudience(services, actor),
  ]);
  const now = Date.now();

  return {
    entries: entries.map((entry) => {
      const deletedAt = parseInstant(entry.deletedAt)?.getTime() ?? now;
      const elapsed = Math.floor((now - deletedAt) / DAY_MILLISECONDS);

      return {
        ...entry,
        daysLeft: Math.max(0, settings.trashRetentionDays - elapsed),
      };
    }),
    audience,
  };
}
