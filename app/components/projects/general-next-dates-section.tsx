import { Calendar } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { formatDate } from "@/app/lib/project-format";

import type { ProjectEvent } from "@/definition/Project";

const MAXIMUM_LISTED_EVENTS = 4;

interface GeneralNextDatesSectionProps {
  readonly events: readonly ProjectEvent[];
}

/** Renders the next few project dates with a link to the planning tab. */
export function GeneralNextDatesSection({
  events,
}: GeneralNextDatesSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const upcomingEvents = events.slice(0, MAXIMUM_LISTED_EVENTS);

  return (
    <section className="rounded-2xl bg-muted/40 p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="flex select-none items-center gap-2 font-semibold text-foreground">
          <Calendar className="size-5 text-primary" aria-hidden="true" />
          {t("projectDetail.general.nextDates")}
        </h2>
        <Link
          to="?tab=planning"
          prefetch="intent"
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {t("projectDetail.general.showAllDates")}
        </Link>
      </div>
      {upcomingEvents.length ? (
        <ul className="mt-3 flex flex-col">
          {upcomingEvents.map((event) => (
            <li
              key={event.id}
              className="flex items-center gap-3 py-2.5 text-sm first:pt-0"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary">
                <Calendar className="size-4" aria-hidden="true" />
              </span>
              <span className="w-24 shrink-0 text-muted-foreground">
                {formatDate(event.eventDate)}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-foreground">
                  {event.title}
                </span>
                {event.eventTime ? (
                  <span className="block text-xs text-muted-foreground">
                    {event.eventTime}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 flex flex-col items-center py-4 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Calendar className="size-5" aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm text-muted-foreground">
            {t("projectDetail.general.noDates")}
          </p>
        </div>
      )}
    </section>
  );
}
