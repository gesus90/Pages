/** Milliseconds in a day; the timeline works with local-midnight instants. */
export const DAY_IN_MS = 86_400_000;

/**
 * Parses a stored `YYYY-MM-DD` date as local midnight.
 *
 * @param value - Stored date or `null`.
 * @returns The instant, or `null` when the value is not written as a date.
 * A day beyond the end of its month rolls over into the next month.
 */
export function parsePlanDate(value: string | null): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");

  if (!match) {
    return null;
  }

  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ).getTime();
}

/** Formats an instant as `YYYY-MM-DD` in local time. */
export function toISODate(time: number): string {
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}

/** Formats an instant as a German date with day, month and year. */
export function formatDayMonth(time: number): string {
  return new Intl.DateTimeFormat("de", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(time));
}

/** Formats a date range, leaving out the first year when both share it. */
export function formatRangeLabel(start: number, end: number): string {
  const first = new Date(start);
  const second = new Date(end);

  if (first.getFullYear() === second.getFullYear()) {
    const dayMonth = new Intl.DateTimeFormat("de", {
      day: "2-digit",
      month: "2-digit",
    }).format(first);

    return `${dayMonth} – ${formatDayMonth(end)}`;
  }

  return `${formatDayMonth(start)} – ${formatDayMonth(end)}`;
}

/** Formats an instant as a short German month with its year. */
export function formatMonthYear(time: number): string {
  return new Intl.DateTimeFormat("de", {
    month: "short",
    year: "numeric",
  }).format(new Date(time));
}

/** Returns the ISO week number of an instant. */
export function getIsoWeek(time: number): number {
  const date = new Date(time);
  const thursday = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() - ((date.getDay() + 6) % 7) + 3,
  );
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const firstMonday = new Date(
    firstThursday.getFullYear(),
    firstThursday.getMonth(),
    firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7),
  );

  return (
    1 +
    Math.round((thursday.getTime() - firstMonday.getTime()) / (7 * DAY_IN_MS))
  );
}

/** Returns local midnight of the Monday of the instant's week. */
export function startOfWeekMonday(time: number): number {
  const date = new Date(time);

  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() - ((date.getDay() + 6) % 7),
  ).getTime();
}

/**
 * Returns the instant `amount` weeks away at the same local time of day.
 *
 * @remarks
 * Steps calendar days rather than a fixed number of milliseconds, so a week
 * boundary stays on local midnight across a change of daylight saving time.
 */
export function addWeeks(time: number, amount: number): number {
  const date = new Date(time);

  date.setDate(date.getDate() + 7 * amount);

  return date.getTime();
}

/** Returns the first day of the instant's month. */
export function startOfMonth(time: number): number {
  const date = new Date(time);

  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

/** Returns the first day of the month `amount` months away. */
export function addMonths(time: number, amount: number): number {
  const date = new Date(time);

  return new Date(date.getFullYear(), date.getMonth() + amount, 1).getTime();
}

/** Returns the first day of the instant's quarter. */
export function startOfQuarter(time: number): number {
  const date = new Date(time);

  return new Date(
    date.getFullYear(),
    Math.floor(date.getMonth() / 3) * 3,
    1,
  ).getTime();
}

/** Returns the first day of the quarter `amount` quarters away. */
export function addQuarters(time: number, amount: number): number {
  const date = new Date(time);

  return new Date(
    date.getFullYear(),
    Math.floor(date.getMonth() / 3) * 3 + amount * 3,
    1,
  ).getTime();
}

/** Labels the quarter of an instant, such as `Q3 2026`. */
export function getQuarterLabel(time: number): string {
  const date = new Date(time);

  return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
}

/** Formats the current time like the server's `YYYY-MM-DD HH:MM:SS` stamps. */
export function serverTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}
