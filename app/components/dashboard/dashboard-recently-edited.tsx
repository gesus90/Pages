import { useTranslation } from "react-i18next";

import { DashboardDocumentIcon } from "@/app/components/dashboard/dashboard-icons";

/** A single row shown in the "Recently edited" panel. */
export interface DashboardRecentItem {
  readonly id: string;
  readonly title: string;
  readonly projectName: string;
  readonly updatedAt: string;
}

interface DashboardRecentlyEditedProps {
  readonly items: readonly DashboardRecentItem[];
}

/**
 * Renders the recently edited tickets list.
 *
 * @param props - Items to display, already sorted by the route loader.
 * @returns The recently edited list element.
 */
export function DashboardRecentlyEdited({
  items,
}: DashboardRecentlyEditedProps): React.ReactElement {
  const { t, i18n } = useTranslation();

  function formatRelative(updatedAt: string): string {
    const updatedTime = Date.parse(updatedAt);

    if (Number.isNaN(updatedTime)) {
      return "";
    }

    const locale = i18n.language === "en" ? "en" : "de";
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    const diffMinutes = Math.round((updatedTime - Date.now()) / 60_000);

    if (Math.abs(diffMinutes) < 60) {
      return formatter.format(diffMinutes, "minute");
    }

    const diffHours = Math.round(diffMinutes / 60);

    if (Math.abs(diffHours) < 24) {
      return formatter.format(diffHours, "hour");
    }

    return formatter.format(Math.round(diffHours / 24), "day");
  }

  function formatSubtitle(updatedAt: string): string {
    const relative = formatRelative(updatedAt);

    if (!relative) {
      return "";
    }

    return t("dashboard.recentlyEdited.editedAgo", { relative });
  }

  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("dashboard.recentlyEdited.empty")}
      </p>
    );
  }

  return (
    <div>
      <div
        className="grid grid-cols-[minmax(0,1fr)_130px_110px_32px] items-center gap-3 border-b border-border/60 pb-2 text-xs font-medium text-muted-foreground"
        aria-hidden="true"
      >
        <span>{t("dashboard.recentlyEdited.columns.title")}</span>
        <span>{t("dashboard.recentlyEdited.columns.project")}</span>
        <span>{t("dashboard.recentlyEdited.columns.edited")}</span>
        <span />
      </div>
      <ul className="divide-y divide-border/60">
        {items.map((item) => (
          <li
            key={item.id}
            className="grid grid-cols-[minmax(0,1fr)_130px_110px_32px] items-center gap-3 py-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex size-9 shrink-0 select-none items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <DashboardDocumentIcon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {item.title}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {formatSubtitle(item.updatedAt)}
                </p>
              </div>
            </div>
            <span className="truncate text-xs text-muted-foreground">
              {item.projectName}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {formatRelative(item.updatedAt)}
            </span>
            <span
              className="select-none text-center text-sm font-bold tracking-widest text-muted-foreground"
              aria-hidden="true"
            >
              •••
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
