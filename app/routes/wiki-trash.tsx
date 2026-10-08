import { useLoaderData } from "react-router";

import { WikiTrashView } from "@/app/components/wiki/wiki-trash-view";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { parseInstant } from "@/app/lib/region-format";
import { getApplicationServices } from "@/app/lib/services.server";

import type { WikiTrashItem } from "@/app/components/wiki/wiki-trash-view";
import type { Route } from "./+types/wiki-trash";

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

/** Loads the deleted pages the account may restore, with their remaining time. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<{ readonly entries: readonly WikiTrashItem[] }> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const { wikiService } = await getApplicationServices();
  const [entries, settings] = await Promise.all([
    wikiService.listTrash(actor),
    wikiService.getSettings(),
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
  };
}

/** Renders the wiki trash. */
export default function WikiTrashRoute(): React.ReactElement {
  const { entries } = useLoaderData<typeof loader>();

  return <WikiTrashView entries={entries} />;
}
