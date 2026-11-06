import { redirect } from "react-router";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { readLocalStateAudience } from "@/app/lib/local-state/local-state-audience.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readWikiRequest } from "@/app/lib/wiki-actions/wiki-action-support.server";
import { handleWikiPageAction } from "@/app/lib/wiki-actions/wiki-page-actions.server";
import { slugifyTitle, wikiPagePath } from "@/app/lib/wiki-tree";
import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { WikiActionOutcome } from "@/app/lib/wiki-actions/wiki-action-support.server";
import type { WikiPageLoaderData } from "./wiki-page";
import type { Route } from "./+types/wiki-page-server";

/**
 * Loads a page by its identifier.
 *
 * @remarks
 * A missing page and a page the account may not see answer alike. A slug in
 * the address that no longer fits the title is replaced by the current one.
 */
export async function loader({
  context,
  params,
}: Route.LoaderArgs): Promise<WikiPageLoaderData> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();
  const { wikiService } = services;
  const audience = await readLocalStateAudience(services, actor);

  try {
    const result = await wikiService.read(actor, params.pageId);

    if (result.kind === "placeholder") {
      return { kind: "placeholder", placeholder: result.placeholder, audience };
    }

    const { page } = result.view;

    if (params.slug !== undefined && params.slug !== slugifyTitle(page.title)) {
      throw redirect(wikiPagePath(page.id, page.title));
    }

    const [versions, anchorChoices, backlinks, attachments, comments] =
      await Promise.all([
        wikiService.listVersions(actor, page.id),
        wikiService.anchorChoices(actor, page.id),
        wikiService.backlinks(actor, page.id),
        wikiService.listAttachments(actor, page.id),
        wikiService.listComments(actor, page.id),
      ]);

    return {
      anchorChoices,
      attachments: attachments.map((attachment) => ({
        ...attachment,
        canRemove:
          attachment.uploadedBy === actor.id ||
          result.view.permissions.canManage,
      })),
      backlinks,
      comments,
      kind: "page",
      versions,
      view: result.view,
      audience,
    };
  } catch (error: unknown) {
    logCaughtError("wiki_page", error);

    if (error instanceof WikiPageNotFoundError) {
      return { kind: "notFound", audience };
    }

    throw error;
  }
}

/** Changes one page: save, versions, anchors, owner and the review date. */
export async function action(
  args: Route.ActionArgs,
): Promise<WikiActionOutcome> {
  return handleWikiPageAction(await readWikiRequest(args, args.params.pageId));
}
