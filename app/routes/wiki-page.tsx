import { useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";

import { useLocalStateRoute } from "@/app/components/common/use-local-state-route";
import { useWikiShell } from "@/app/components/wiki/use-wiki-shell";
import { WikiPageScreen } from "@/app/components/wiki/wiki-page-screen";
import { WikiPrivatePlaceholderView } from "@/app/components/wiki/wiki-private-placeholder";
import {
  isCurrentLocalStateAudience,
  isLocalStateAudience,
} from "@/app/lib/local-state/local-state-audience";
import {
  loadLocalFirst,
  localStateRoute,
} from "@/app/lib/local-state/local-state-loader";
import { readRouteData } from "@/app/lib/local-state/route-data";
import { sendToBackend } from "@/app/lib/backend-request";

import type { LocalStateRouteKind } from "@/app/components/common/use-local-state-route";
import type { WikiAttachmentEntry } from "@/app/components/wiki/wiki-attachments-view";
import type { LocalStateAudience } from "@/app/lib/local-state/local-state-audience";
import type { WithLocalState } from "@/app/lib/local-state/local-state-loader";
import type {
  WikiAnchorChoices,
  WikiBacklinks,
  WikiCommentThread,
  WikiPageView,
  WikiPrivatePlaceholder,
} from "@/definition/Wiki";
import type { Route } from "./+types/wiki-page";

type WikiPageAnswer =
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

/** A wiki page as its endpoint answers it. */
export type WikiPageLoaderData = WikiPageAnswer & {
  readonly audience: LocalStateAudience;
};

function isWikiPageAnswer(value: object): boolean {
  if (!("kind" in value)) return false;
  if (value.kind === "notFound") return true;
  if (value.kind === "placeholder")
    return "placeholder" in value && typeof value.placeholder === "object";
  return (
    value.kind === "page" &&
    "view" in value &&
    typeof value.view === "object" &&
    "versions" in value &&
    Array.isArray(value.versions) &&
    "attachments" in value &&
    Array.isArray(value.attachments) &&
    "comments" in value &&
    Array.isArray(value.comments)
  );
}

function isWikiPageLoaderData(value: unknown): value is WikiPageLoaderData {
  return (
    typeof value === "object" &&
    value !== null &&
    isWikiPageAnswer(value) &&
    "audience" in value &&
    isLocalStateAudience(value.audience)
  );
}

/** A wiki page, kept per account, rights and address; a page the account may not see is not kept. */
const WIKI_PAGE_STATE: LocalStateRouteKind<WikiPageLoaderData> = {
  schemaVersion: 1,
  isPayload: isWikiPageLoaderData,
  isCurrent: (page) => isCurrentLocalStateAudience(page.audience),
  ownerOf: (page) => page.audience.userId,
  isRefused: (page) => page.kind === "notFound",
};

/**
 * Opens a page from the account's kept answer at once and asks the endpoint behind it.
 *
 * @remarks
 * The endpoint runs the server loader with its permission checks; the
 * address's page, slug and query reach it unchanged.
 */
export async function clientLoader({
  request,
}: Route.ClientLoaderArgs): Promise<WithLocalState<WikiPageLoaderData>> {
  const url = new URL(request.url);
  return loadLocalFirst(localStateRoute(url), WIKI_PAGE_STATE, () =>
    readRouteData({
      endpoint: `/wiki-api/pages${url.pathname.slice("/wiki".length)}${url.search}`,
      signal: request.signal,
      isPayload: isWikiPageLoaderData,
    }),
  );
}

/** Sends a change of the page to the API, which runs the page's action. */
export async function clientAction({
  request,
}: Route.ClientActionArgs): Promise<unknown> {
  return sendToBackend(request);
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
  const loaderData = useLocalStateRoute(
    useLoaderData<typeof clientLoader>(),
    WIKI_PAGE_STATE,
  );
  const shell = useWikiShell();

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
