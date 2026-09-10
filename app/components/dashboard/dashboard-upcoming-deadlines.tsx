import { useTranslation } from "react-i18next";

/** A single row shown in the upcoming deadlines panel. */
export interface DashboardDeadline {
  readonly id: string;
  readonly title: string;
  readonly projectName: string;
  readonly dueAt: string;
  readonly daysLeft: number;
}

interface DashboardUpcomingDeadlinesProps {
  readonly deadlines: readonly DashboardDeadline[];
}

/**
 * Renders the upcoming deadlines list with date badges.
 *
 * @param props - Deadlines to display, already sorted by the route loader.
 * @returns The deadlines list element.
 */
export function DashboardUpcomingDeadlines({
  deadlines,
}: DashboardUpcomingDeadlinesProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en-GB" : "de-DE";

  function formatDay(dueAt: string): string {
    return new Intl.DateTimeFormat(locale, { day: "2-digit" }).format(
      new Date(dueAt),
    );
  }

  function formatMonth(dueAt: string): string {
    return new Intl.DateTimeFormat(locale, { month: "short" })
      .format(new Date(dueAt))
      .replace(".", "")
      .toLocaleUpperCase(locale);
  }

  function formatIn(deadline: DashboardDeadline): string {
    if (deadline.daysLeft <= 0) {
      return t("dashboard.deadlines.today");
    }

    return t("dashboard.deadlines.inDays", { count: deadline.daysLeft });
  }

  if (deadlines.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t("dashboard.deadlines.empty")}
      </p>
    );
  }

  return (
    <div>
      <div
        className="grid grid-cols-[52px_minmax(0,1fr)_120px_110px] items-center gap-3 border-b border-border/60 pb-2 text-xs font-medium text-muted-foreground"
        aria-hidden="true"
      >
        <span>{t("dashboard.deadlines.columns.date")}</span>
        <span>{t("dashboard.deadlines.columns.task")}</span>
        <span>{t("dashboard.deadlines.columns.project")}</span>
        <span>{t("dashboard.deadlines.columns.in")}</span>
      </div>
      <ul className="divide-y divide-border/60">
        {deadlines.map((deadline) => (
          <li
            key={deadline.id}
            className="grid grid-cols-[52px_minmax(0,1fr)_120px_110px] items-center gap-3 py-3"
          >
            <span className="inline-flex w-11 shrink-0 select-none flex-col items-center rounded-lg bg-muted px-1 py-1.5 leading-none">
              <span className="text-sm font-bold text-foreground tabular-nums">
                {formatDay(deadline.dueAt)}
              </span>
              <span className="mt-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
                {formatMonth(deadline.dueAt)}
              </span>
            </span>
            <span className="truncate text-sm font-medium text-foreground">
              {deadline.title}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {deadline.projectName}
            </span>
            <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span
                className="size-2.5 shrink-0 rounded-full bg-primary"
                aria-hidden="true"
              />
              <span className="truncate tabular-nums">
                {formatIn(deadline)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
