import { Lock } from "lucide-react";
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

interface WikiPagePropertiesProps {
  readonly page: WikiPage;
  /** Today as `YYYY-MM-DD` on the server. */
  readonly today: string;
}

/** One line of the property grid: a quiet label and its value. */
function PropertyRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <>
      <dt className="flex min-h-[30px] items-center text-muted-foreground">
        {label}
      </dt>
      <dd className="flex min-h-[30px] min-w-0 flex-wrap items-center gap-1.5 py-1 text-foreground">
        {children}
      </dd>
    </>
  );
}

/** The project and the anchors of a page, each as a small pill. */
function LinkedPills({
  page,
}: {
  readonly page: WikiPage;
}): React.ReactElement {
  const { t } = useTranslation();
  const pills = [
    ...(page.projectName
      ? [
          {
            key: "project",
            text: `${t("wiki.page.anchor.project")} ${page.projectName}`,
          },
        ]
      : []),
    ...page.anchors.map((anchor) => ({
      key: `${anchor.kind}:${anchor.targetId}`,
      text: `${t(`wiki.page.anchor.${anchor.kind}`)} ${anchor.label ?? t("wiki.page.anchorGone")}`,
    })),
  ];

  return (
    <>
      {pills.map((pill) => (
        <span
          key={pill.key}
          className="inline-flex min-h-[22px] max-w-full items-center rounded-[7px] bg-muted px-2 py-0.5 text-xs break-words"
        >
          {pill.text}
        </span>
      ))}
    </>
  );
}

/**
 * The properties of a page below its title, as rows of a grid with a fixed
 * label column: owner, last edit, linked project and anchors, and the date
 * until which the page counts as current. Rows without a value are left out.
 */
export function WikiPageProperties({
  page,
  today,
}: WikiPagePropertiesProps): React.ReactElement {
  const { t } = useTranslation();
  const { formatDate, formatDateTime } = useRegionFormatter();
  const isExpired = page.currentUntil !== null && page.currentUntil < today;
  const hasLinks = page.projectName !== null || page.anchors.length > 0;

  return (
    <dl
      aria-label={t("wiki.page.properties")}
      className="mt-1 grid grid-cols-[110px_minmax(0,1fr)] text-[13px] leading-5"
    >
      {page.ownerName !== "" || page.scope === "private" ? (
        <PropertyRow label={t("wiki.page.property.owner")}>
          {page.ownerName}
          {page.scope === "private" ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Lock aria-hidden="true" className="size-3" />
              {t("wiki.page.private")}
            </span>
          ) : null}
        </PropertyRow>
      ) : null}
      <PropertyRow label={t("wiki.page.property.updated")}>
        <span title={formatDateTime(page.updatedAt)}>
          {t("wiki.page.updatedBy", {
            date: formatDate(page.updatedAt),
            name: page.updatedByName ?? page.ownerName,
          })}
        </span>
      </PropertyRow>
      {hasLinks ? (
        <PropertyRow label={t("wiki.page.property.linked")}>
          <LinkedPills page={page} />
        </PropertyRow>
      ) : null}
      {page.currentUntil ? (
        <PropertyRow label={t("wiki.page.property.currentUntil")}>
          <span className={cn(isExpired && "font-medium text-warning")}>
            {isExpired
              ? t("wiki.page.expiredOn", {
                  date: formatDate(page.currentUntil),
                })
              : formatDate(page.currentUntil)}
          </span>
        </PropertyRow>
      ) : null}
    </dl>
  );
}
