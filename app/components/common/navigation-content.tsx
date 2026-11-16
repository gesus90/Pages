import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useNavigation } from "react-router";

import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";

import { useDraftStores } from "./draft-provider";

const AREA_KEYS: Readonly<Record<string, string>> = {
  dashboard: "dashboard",
  projekte: "projects",
  tasks: "tasks",
  aufgaben: "tasks",
  wiki: "wiki",
  users: "users",
  settings: "settings",
};

function PendingDestination({
  pathname,
}: {
  readonly pathname: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { wiki, descriptions } = useDraftStores();
  const [, area = "", id] = pathname.split("/");
  const cached =
    area === "wiki" ? wiki.list().find((entry) => entry.id === id) : undefined;
  const description = descriptions
    .list()
    .find((entry) => entry.href === pathname);
  const title =
    cached?.draft.title ??
    description?.label ??
    t(`navigation.${AREA_KEYS[area] ?? "label"}`);
  const content = cached?.draft.content ?? description?.draft.description;
  return (
    <section aria-busy="true" className="space-y-5" role="status">
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      <p className="text-sm text-muted-foreground">{t("navigation.loading")}</p>
      {content !== undefined ? (
        <WikiMarkdown source={content} />
      ) : (
        <div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
          <div className="h-9 w-2/3 rounded-lg bg-muted" />
          <div className="h-44 rounded-xl bg-muted" />
        </div>
      )}
    </section>
  );
}

/** The areas whose pages keep edits in the draft stores, so the placeholder shows real content. */
const DRAFT_AREAS: ReadonlySet<string> = new Set(["wiki", "tasks", "aufgaben"]);

function areaOf(pathname: string): string {
  return pathname.split("/")[1] ?? "";
}

/**
 * Whether the destination replaces the page with a placeholder until it is ready.
 * @param destination - The address the router navigates to.
 * @param current - The address that is shown.
 * @returns `false` for the same path with another search part and for another
 * path inside an area without drafts: the shown page stays until the new one is
 * ready. `true` for another area and for any other path inside an area with
 * drafts.
 */
function replacesPage(
  destination: { readonly pathname: string },
  current: { readonly pathname: string },
): boolean {
  if (destination.pathname === current.pathname) return false;

  const area = areaOf(destination.pathname);

  return area !== areaOf(current.pathname) || DRAFT_AREAS.has(area);
}

/**
 * Shows the destination immediately while the router loads its authorized data.
 * @remarks
 * A change of the search part never replaces the page: its panels load their
 * own content. Inside an area without drafts the shown page stays in place
 * until the next one is ready.
 */
export function NavigationContent(): React.ReactElement {
  const navigation = useNavigation();
  const location = useLocation();
  const destination = navigation.location;
  const isChanging =
    destination !== undefined && replacesPage(destination, location);

  return (
    <>
      {isChanging ? (
        <PendingDestination pathname={destination.pathname} />
      ) : null}
      <div hidden={isChanging}>
        <Outlet />
      </div>
    </>
  );
}
