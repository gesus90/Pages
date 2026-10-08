import { redirect, useLoaderData, useRouteLoaderData } from "react-router";
import { useTranslation } from "react-i18next";

import { WikiPageScreen } from "@/app/components/wiki/wiki-page-screen";
import { WikiPrivatePlaceholderView } from "@/app/components/wiki/wiki-private-placeholder";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { readWikiRequest } from "@/app/lib/wiki-actions/wiki-action-support.server";
import { handleWikiPageAction } from "@/app/lib/wiki-actions/wiki-page-actions.server";
import { slugifyTitle, wikiPagePath } from "@/app/lib/wiki-tree";
import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";

import type { WikiAttachmentEntry } from "@/app/components/wiki/wiki-attachments-view";
import type { WikiActionOutcome } from "@/app/lib/wiki-actions/wiki-action-support.server";
import type {
  WikiAnchorChoices,
  WikiBacklinks,
  WikiCommentThread,
  WikiPageView,
  WikiPrivatePlaceholder,
} from "@/definition/Wiki";
import type { loader as wikiLoader } from "./wiki";
import type { Route } from "./+types/wiki-page";

type WikiPageLoaderData =
  | {
      readonly kind: "page";
      readonly view: WikiPageView;
      readonly versions: readonly {
        readonly id: string;
        readonly revision: number;
        readonly authorName: string;
        readonly createdAt: string;
        readonly updatedAt: string;
      }[];
      readonly anchorChoices: WikiAnchorChoices;
      readonly backlinks: WikiBacklinks;
      readonly attachments: readonly WikiAttachmentEntry[];
      readonly comments: readonly WikiCommentThread[];
    }
  | {
      readonly kind: "placeholder";
      readonly placeholder: WikiPrivatePlaceholder;
    }
  | { readonly kind: "notFound" };

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

  const { wikiService } = await getApplicationServices();

  try {
    const result = await wikiService.read(actor, params.pageId);

    if (result.kind === "placeholder") {
      return { kind: "placeholder", placeholder: result.placeholder };
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
    };
  } catch (error: unknown) {
    if (error instanceof WikiPageNotFoundError) {
      return { kind: "notFound" };
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

/** Keeps the editor's loader data while autosave runs. */
export function shouldRevalidate({
  formData,
  defaultShouldRevalidate,
}: {
  readonly formData?: FormData;
  readonly defaultShouldRevalidate: boolean;
}): boolean {
  return formData?.get("intent") === "save" ? false : defaultShouldRevalidate;
}

/** Renders a page, the placeholder of a private page, or the neutral notice. */
export default function WikiPageRoute(): React.ReactElement {
  const { t } = useTranslation();
  const loaderData = useLoaderData<typeof loader>();
  const shell = useRouteLoaderData<typeof wikiLoader>("routes/wiki");

  if (loaderData.kind === "placeholder") {
    return <WikiPrivatePlaceholderView placeholder={loaderData.placeholder} />;
  }

  if (loaderData.kind === "notFound" || !shell) {
    return (
      <p
        className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground"
        role="status"
      >
        {t("wiki.page.notFound")}
      </p>
    );
  }

  return (
    <WikiPageScreen
      key={loaderData.view.page.id}
      anchorChoices={loaderData.anchorChoices}
      navigation={shell.navigation}
      owners={shell.people}
      attachments={loaderData.attachments}
      comments={loaderData.comments}
      backlinks={loaderData.backlinks}
      templates={shell.templates}
      today={shell.today}
      versions={loaderData.versions}
      view={loaderData.view}
    />
  );
}
