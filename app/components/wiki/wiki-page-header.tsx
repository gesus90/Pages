import { Clock, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import { cn } from "@/app/lib/cn";
import { wikiPagePath } from "@/app/lib/wiki-tree";

import type { WikiPage } from "@/definition/Wiki";

/** The pages above a page, each a link, as in the Notion top bar. */
export function WikiBreadcrumb({
  page,
}: {
  readonly page: WikiPage;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <nav aria-label={t("wiki.page.breadcrumb")} className="min-w-0 flex-1">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {page.breadcrumb.map((link) => (
          <li key={link.id} className="flex min-w-0 items-center gap-1">
            <Link
              className="truncate hover:text-foreground hover:underline"
              to={wikiPagePath(link.id, link.title)}
            >
              {link.icon ? `${link.icon} ` : ""}
              {link.title}
            </Link>
            <span aria-hidden="true">/</span>
          </li>
        ))}
        <li aria-current="page" className="truncate text-foreground">
          {page.icon ? `${page.icon} ` : ""}
          {page.title}
        </li>
      </ol>
    </nav>
  );
}

interface WikiPageMetaProps {
  readonly page: WikiPage;
  /** Today as `YYYY-MM-DD` on the server. */
  readonly today: string;
}

/** Owner, last edit and the marks of a page below its title. */
export function WikiPageMeta({
  page,
  today,
}: WikiPageMetaProps): React.ReactElement {
  const { t } = useTranslation();
  const { formatDate, formatDateTime } = useRegionFormatter();
  const isExpired = page.currentUntil !== null && page.currentUntil < today;

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {t("wiki.page.owner", { name: page.ownerName })}
        {" · "}
        {t("wiki.page.lastEdited", {
          date: formatDateTime(page.updatedAt),
          name: page.updatedByName ?? page.ownerName,
        })}
      </p>
      <ul className="flex flex-wrap items-center gap-2 text-xs">
        {page.scope === "private" ? (
          <li className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
            <Lock aria-hidden="true" className="size-3" />
            {t("wiki.page.private")}
          </li>
        ) : null}
        {page.projectName ? (
          <li className="rounded-full bg-muted px-2.5 py-1">
            {page.projectName}
          </li>
        ) : null}
        {page.currentUntil ? (
          <li
            className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-1",
              isExpired ? "bg-warning-subtle text-warning" : "bg-muted",
            )}
          >
            <Clock aria-hidden="true" className="size-3" />
            {t(isExpired ? "wiki.page.expiredOn" : "wiki.page.currentUntil", {
              date: formatDate(page.currentUntil),
            })}
          </li>
        ) : null}
        {page.anchors.map((anchor) => (
          <li
            key={`${anchor.kind}:${anchor.targetId}`}
            className="rounded-full bg-muted px-2.5 py-1"
          >
            {t(`wiki.page.anchor.${anchor.kind}`)}:{" "}
            {anchor.label ?? t("wiki.page.anchorGone")}
          </li>
        ))}
      </ul>
    </div>
  );
}
