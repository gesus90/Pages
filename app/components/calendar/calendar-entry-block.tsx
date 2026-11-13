import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { useCalendarContext } from "./calendar-context";

import type { TFunction } from "i18next";
import type { CSSProperties } from "react";
import type { CalendarInvitee, CalendarViewEntry } from "@/definition/Calendar";
import type { CalendarColor } from "./calendar-colors";
import type { CalendarFormatter } from "./calendar-format";

interface CalendarEntryProps {
  readonly entry: CalendarViewEntry;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * The look of an entry: the muted fill of its calendar, a dashed outline
 * while the account has not answered, faded when it declined.
 *
 * @param entry - The entry.
 * @param color - The color of its calendar.
 */
export function entryClassName(
  entry: CalendarViewEntry,
  color: CalendarColor,
): string {
  return cn(
    "rounded-md text-left text-foreground transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-primary",
    color.fill,
    entry.myResponse === "open" &&
      "outline-1 -outline-offset-1 outline-dashed outline-calendar-open",
    entry.myResponse === "declined" && "opacity-50",
  );
}

/**
 * Names an invitee in the line below a title, such as „Gruppe Team Pages“.
 *
 * @param invitee - The invitee.
 * @param t - The translation function.
 */
export function inviteeLabel(invitee: CalendarInvitee, t: TFunction): string {
  return t(`calendar.invitee.${invitee.kind}`, { name: invitee.name });
}

/**
 * Names an invitee in a list or a chip, such as „Ed · Agent“.
 *
 * @param invitee - The invitee.
 * @param t - The translation function.
 */
export function inviteeName(
  invitee: Pick<CalendarInvitee, "kind" | "name">,
  t: TFunction,
): string {
  return t(`calendar.inviteeName.${invitee.kind}`, { name: invitee.name });
}

/**
 * The line below the title of an entry: its time and where it comes from,
 * such as „09:00–10:00 · Gruppe Team Pages“.
 *
 * @param entry - The entry.
 * @param t - The translation function.
 * @param format - The calendar formatter.
 */
export function entrySubtitle(
  entry: CalendarViewEntry,
  t: TFunction,
  format: CalendarFormatter,
): string {
  const parts = [format.timeRange(entry)];
  const [first, ...others] = entry.invitees;
  if (first)
    parts.push(
      others.length === 0
        ? inviteeLabel(first, t)
        : t("calendar.entry.inviteesMore", {
            first: inviteeLabel(first, t),
            count: others.length,
          }),
    );
  else if (entry.source.ticketKey !== null) parts.push(entry.source.ticketKey);
  else if (!entry.details.createdByMe && entry.createdBy)
    parts.push(t("calendar.entry.from", { name: entry.createdBy.name }));
  return parts.join(" · ");
}

/** An entry as a block with its title and the line below; the grid and the list. */
export function CalendarEntryCard({
  entry,
  className,
  style,
}: CalendarEntryProps): React.ReactElement {
  const { t } = useTranslation();
  const { colorOf, openEntry, format } = useCalendarContext();

  function handleClick(event: React.MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    openEntry(entry);
  }

  return (
    <button
      type="button"
      className={cn(
        entryClassName(entry, colorOf(entry)),
        "flex min-w-0 flex-col overflow-hidden px-2 py-1",
        className,
      )}
      style={style}
      onClick={handleClick}
    >
      <span className="truncate text-xs font-semibold">{entry.title}</span>
      <span className="line-clamp-2 text-[0.6875rem] text-muted-foreground">
        {entrySubtitle(entry, t, format)}
      </span>
    </button>
  );
}

/** An entry in one line; the all-day row and the month. */
export function CalendarEntryChip({
  entry,
  className,
}: CalendarEntryProps): React.ReactElement {
  const { colorOf, openEntry, format } = useCalendarContext();

  function handleClick(event: React.MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    openEntry(entry);
  }

  return (
    <button
      type="button"
      className={cn(
        entryClassName(entry, colorOf(entry)),
        "block w-full truncate px-2 py-0.5 text-xs",
        className,
      )}
      title={`${entry.title} · ${format.timeRange(entry)}`}
      onClick={handleClick}
    >
      {entry.title}
    </button>
  );
}
