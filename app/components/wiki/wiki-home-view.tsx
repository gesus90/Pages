import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { WikiFeedView } from "@/app/components/wiki/wiki-feed-view";
import { WikiPrivateMark } from "@/app/components/wiki/wiki-private-mark";
import { wikiPagePath } from "@/app/lib/wiki-tree";

import type {
  WikiFeedItem,
  WikiHome,
  WikiPageSummary,
} from "@/definition/Wiki";

function PageLink({
  page,
}: {
  readonly page: WikiPageSummary;
}): React.ReactElement {
  return (
    <Link
      className="flex items-center gap-1.5 text-sm text-primary hover:underline"
      to={wikiPagePath(page.id, page.title)}
    >
      {page.icon ? <span aria-hidden="true">{page.icon}</span> : null}
      {page.title}
      {page.scope === "private" ? <WikiPrivateMark /> : null}
    </Link>
  );
}

function PageList({
  title,
  pages,
  emptyLabel,
}: {
  readonly title: string;
  readonly pages: readonly WikiPageSummary[];
  readonly emptyLabel: string;
}): React.ReactElement {
  return (
    <section
      aria-label={title}
      className="space-y-2 rounded-2xl border border-border p-4"
    >
      <h2 className="text-sm font-semibold text-muted-foreground uppercase">
        {title}
      </h2>
      {pages.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="space-y-1.5">
          {pages.map((page) => (
            <li key={page.id}>
              <PageLink page={page} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function locationOf(
  page: WikiPageSummary,
  labels: { private: string; general: string },
): string {
  if (page.scope === "private") {
    return labels.private;
  }

  return page.projectName ?? labels.general;
}

/** The wiki start page: lists of pages and the table of all of them. */
export function WikiHomeView({
  home,
  feed,
}: {
  readonly home: WikiHome;
  readonly feed: readonly WikiFeedItem[];
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  const labels = {
    general: t("wiki.nav.generalArea"),
    private: t("wiki.nav.privateArea"),
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">
        {t("wiki.title")}
      </h1>
      <p className="text-sm text-muted-foreground">{t("wiki.home.subtitle")}</p>
      <WikiFeedView feed={feed} />
      <div className="grid gap-4 lg:grid-cols-3">
        <PageList
          emptyLabel={t("wiki.home.noFavorites")}
          pages={home.favorites}
          title={t("wiki.nav.favorites")}
        />
        <PageList
          emptyLabel={t("wiki.home.noRecent")}
          pages={home.recentlyEdited}
          title={t("wiki.home.recentlyEdited")}
        />
        <PageList
          emptyLabel={t("wiki.home.noMine")}
          pages={home.mine}
          title={t("wiki.home.mine")}
        />
      </div>
      <section aria-label={t("wiki.home.allPages")} className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase">
          {t("wiki.home.allPages")}
        </h2>
        {home.all.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("wiki.home.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="px-3 py-2">{t("wiki.home.columnTitle")}</th>
                  <th className="px-3 py-2">{t("wiki.home.columnLocation")}</th>
                  <th className="px-3 py-2">{t("wiki.home.columnOwner")}</th>
                  <th className="px-3 py-2">{t("wiki.home.columnEdited")}</th>
                </tr>
              </thead>
              <tbody>
                {home.all.map((page) => (
                  <tr key={page.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <PageLink page={page} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {locationOf(page, labels)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {page.ownerName}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatDateTime(page.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
