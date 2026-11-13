import { weekdayKeyOf } from "./calendar-dates";

import type { TFunction } from "i18next";
import type {
  CalendarFrequency,
  CalendarRecurrence,
  CalendarWeekday,
} from "@/definition/Calendar";
import type { CalendarFormatter } from "./calendar-format";

/** The choices of „Wiederholen“. */
export const REPEAT_PRESETS = [
  "never",
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "yearly",
  "custom",
] as const;

/** One choice of {@link REPEAT_PRESETS}. */
export type RepeatPreset = (typeof REPEAT_PRESETS)[number];

/** How a series ends. */
export type RepeatEnd = "never" | "until" | "count";

/** The fields of the form that make up a rule. */
export interface RepeatFields {
  readonly preset: RepeatPreset;
  readonly frequency: CalendarFrequency;
  readonly interval: number;
  readonly weekdays: readonly CalendarWeekday[];
  readonly end: RepeatEnd;
  /** Last day `YYYY-MM-DD` of an `until` end. */
  readonly until: string;
  readonly count: number;
}

const WORKDAYS: readonly CalendarWeekday[] = ["mo", "tu", "we", "th", "fr"];
const WEEK_ORDER: readonly CalendarWeekday[] = [...WORKDAYS, "sa", "su"];

function sameWeekdays(
  left: readonly CalendarWeekday[],
  right: readonly CalendarWeekday[],
): boolean {
  return (
    left.length === right.length && left.every((day) => right.includes(day))
  );
}

function sortWeekdays(days: readonly CalendarWeekday[]): CalendarWeekday[] {
  return WEEK_ORDER.filter((day) => days.includes(day));
}

function baseOf(
  fields: RepeatFields,
  startDate: string,
): Pick<CalendarRecurrence, "frequency" | "interval" | "weekdays"> {
  switch (fields.preset) {
    case "daily":
      return { frequency: "daily", interval: 1, weekdays: [] };
    case "weekdays":
      return { frequency: "weekly", interval: 1, weekdays: WORKDAYS };
    case "weekly":
      return {
        frequency: "weekly",
        interval: 1,
        weekdays: [weekdayKeyOf(startDate)],
      };
    case "monthly":
    case "yearly":
      return { frequency: fields.preset, interval: 1, weekdays: [] };
    default:
      return {
        frequency: fields.frequency,
        interval: fields.interval,
        weekdays:
          fields.frequency === "weekly"
            ? sortWeekdays(
                fields.weekdays.length > 0
                  ? fields.weekdays
                  : [weekdayKeyOf(startDate)],
              )
            : [],
      };
  }
}

/**
 * Builds the rule of a series from the form.
 *
 * @param fields - The repeat fields.
 * @param startDate - The first day of the event; weekly rules default to its weekday.
 * @returns The rule, or `null` for „Nie“.
 */
export function recurrenceOf(
  fields: RepeatFields,
  startDate: string,
): CalendarRecurrence | null {
  if (fields.preset === "never") return null;
  return {
    ...baseOf(fields, startDate),
    until: fields.end === "until" && fields.until !== "" ? fields.until : null,
    count: fields.end === "count" ? fields.count : null,
  };
}

function presetOf(rule: CalendarRecurrence, startDate: string): RepeatPreset {
  if (rule.interval !== 1) return "custom";
  if (rule.frequency === "daily" || rule.frequency === "monthly")
    return rule.frequency;
  if (rule.frequency === "yearly") return "yearly";
  if (sameWeekdays(rule.weekdays, WORKDAYS)) return "weekdays";
  return sameWeekdays(rule.weekdays, [weekdayKeyOf(startDate)])
    ? "weekly"
    : "custom";
}

/**
 * Reads a rule into the fields of the form.
 *
 * @param rule - The rule of an entry, or `null`.
 * @param startDate - The first day of the event.
 */
export function repeatFieldsOf(
  rule: CalendarRecurrence | null,
  startDate: string,
): RepeatFields {
  if (rule === null)
    return {
      preset: "never",
      frequency: "weekly",
      interval: 1,
      weekdays: [weekdayKeyOf(startDate)],
      end: "never",
      until: "",
      count: 10,
    };
  return {
    preset: presetOf(rule, startDate),
    frequency: rule.frequency,
    interval: rule.interval,
    weekdays: rule.weekdays,
    end: endOf(rule),
    until: rule.until ?? "",
    count: rule.count ?? 10,
  };
}

function endOf(rule: CalendarRecurrence): RepeatEnd {
  if (rule.until !== null) return "until";
  return rule.count !== null ? "count" : "never";
}

function describeBase(
  rule: CalendarRecurrence,
  startDate: string,
  t: TFunction,
  format: CalendarFormatter,
): string {
  const count = rule.interval;
  switch (rule.frequency) {
    case "daily":
      return t("calendar.recurrence.daily", { count });
    case "weekly": {
      if (count === 1 && sameWeekdays(rule.weekdays, WORKDAYS))
        return t("calendar.recurrence.workdays");
      const days = sortWeekdays(rule.weekdays).map(format.weekdayName);
      return t("calendar.recurrence.weekly", { count, days: days.join(", ") });
    }
    case "monthly":
      return t("calendar.recurrence.monthly", {
        count,
        day: Number(startDate.slice(8, 10)),
      });
    case "yearly":
      return t("calendar.recurrence.yearly", {
        count,
        date: format.dayMonth(startDate),
      });
  }
}

/**
 * Describes a rule, such as „Jede Woche am Donnerstag · bis 31.03.2027“.
 *
 * @param rule - The rule of an entry.
 * @param startDate - The first day of the event, for the day of a monthly or yearly rule.
 * @param t - The translation function.
 * @param format - The calendar formatter.
 */
export function describeRecurrence(
  rule: CalendarRecurrence,
  startDate: string,
  t: TFunction,
  format: CalendarFormatter,
): string {
  const base = describeBase(rule, startDate, t, format);
  if (rule.until !== null)
    return `${base} · ${t("calendar.recurrence.until", { date: format.shortDate(rule.until) })}`;
  if (rule.count !== null)
    return `${base} · ${t("calendar.recurrence.times", { count: rule.count })}`;
  return base;
}
