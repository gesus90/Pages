import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { useCalendarContext } from "./calendar-context";
import { inviteeName } from "./calendar-entry-block";
import { wallDateOf } from "./calendar-layout";
import { describeRecurrence } from "./calendar-recurrence";

import type {
  CalendarPersonResponse,
  CalendarViewEntry,
} from "@/definition/Calendar";

interface EntryFactsProps {
  readonly entry: CalendarViewEntry;
}

function countResponses(
  responses: readonly CalendarPersonResponse[],
): Readonly<Record<CalendarPersonResponse["response"], number>> {
  return {
    accepted: responses.filter((person) => person.response === "accepted")
      .length,
    declined: responses.filter((person) => person.response === "declined")
      .length,
    open: responses.filter((person) => person.response === "open").length,
  };
}

/** „3 Zusagen · 1 Absage · 1 offen“, expandable to the answer of every person. */
function ResponseSummary({
  entry,
}: EntryFactsProps): React.ReactElement | null {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  if (entry.responses.length === 0) return null;
  const counts = countResponses(entry.responses);

  return (
    <div>
      <button
        type="button"
        aria-expanded={isExpanded}
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {[
          t("calendar.detail.accepted", { count: counts.accepted }),
          t("calendar.detail.declined", { count: counts.declined }),
          t("calendar.detail.open", { count: counts.open }),
        ].join(" · ")}
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform",
            isExpanded && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      {isExpanded ? (
        <ul className="mt-1 flex flex-col gap-0.5 pl-2">
          {entry.responses.map((person) => (
            <li key={person.userId} className="flex justify-between gap-3">
              <span className="truncate text-foreground">{person.name}</span>
              <span>{t(`calendar.response.${person.response}`)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The facts of an entry in its detail: time, rule, calendar and creator,
 * invitees, answers and description.
 */
export function CalendarEntryFacts({
  entry,
}: EntryFactsProps): React.ReactElement {
  const { t } = useTranslation();
  const { format } = useCalendarContext();
  const startDate = wallDateOf(entry.start);
  const isSingleDay = !entry.allDay || startDate === wallDateOf(entry.end);
  const when = isSingleDay
    ? `${format.longDate(startDate)} · ${format.timeRange(entry)}`
    : format.timeRange(entry);
  const origin = [entry.calendar.name];
  if (entry.createdBy)
    origin.push(t("calendar.detail.createdBy", { name: entry.createdBy.name }));

  return (
    <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
      <p>{when}</p>
      {entry.recurrence ? (
        <p>{describeRecurrence(entry.recurrence, startDate, t, format)}</p>
      ) : null}
      <p>{origin.join(" · ")}</p>
      {entry.invitees.length > 0 ? (
        <p>
          {t("calendar.detail.invited", {
            names: entry.invitees
              .map((invitee) => inviteeName(invitee, t))
              .join(", "),
          })}
        </p>
      ) : null}
      <ResponseSummary entry={entry} />
      {entry.description.trim() === "" ? null : (
        <p className="mt-2 rounded-lg border border-border px-3 py-2 whitespace-pre-wrap text-foreground">
          {entry.description}
        </p>
      )}
    </div>
  );
}
