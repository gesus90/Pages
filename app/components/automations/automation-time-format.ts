import {
  formatZonedClock,
  readZonedParts,
  zonedDayNumber,
} from "./automation-zoned-time";

import type { Automation } from "@/definition/Automation";
import type { TFunction } from "i18next";

/** What every label of the page needs: texts, language, zone, clock and names. */
export interface LabelContext {
  readonly t: TFunction;
  readonly language: string;
  /** The time zone of the signed-in person. */
  readonly timeZone: string;
  readonly now: Date;
  /** Display names of agents, plans, projects, statuses and more by ID. */
  readonly names: Readonly<Record<string, string>>;
}

/** The placeholder of an empty cell. */
export const EMPTY_CELL = "—";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const SAME_WEEK_DAYS = 6;

function readInstant(iso: string | null): Date | null {
  if (!iso) return null;
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** The short name of an ISO weekday, such as `Mo`. */
export function weekdayShort(t: TFunction, weekday: number): string {
  return t(`automations.weekdays.short.${weekday}`);
}

/**
 * Formats an instant relative to the day of the clock: "heute 22:00",
 * "morgen 08:00", "gestern 22:00", "Fr 16:00" within a week, else
 * "Fr 14.11. 16:00".
 *
 * @param instant - The moment to show.
 * @param context - Texts, language, zone and clock.
 * @param timeZone - The zone to read the instant in; the person's by default.
 */
export function formatDayTime(
  instant: Date,
  context: LabelContext,
  timeZone: string = context.timeZone,
): string {
  const { t } = context;
  const time = formatZonedClock(instant, timeZone);
  const dayDifference =
    zonedDayNumber(instant, timeZone) - zonedDayNumber(context.now, timeZone);
  if (dayDifference === 0) return t("automations.time.today", { time });
  if (dayDifference === 1) return t("automations.time.tomorrow", { time });
  if (dayDifference === -1) return t("automations.time.yesterday", { time });
  const weekday = weekdayShort(t, readZonedParts(instant, timeZone).weekday);
  if (dayDifference > 1 && dayDifference <= SAME_WEEK_DAYS)
    return `${weekday} ${time}`;
  return `${weekday} ${formatDayMonth(instant, context.language, timeZone)} ${time}`;
}

/** Formats day and month in the language, such as `14.11.` or `11/14`. */
export function formatDayMonth(
  instant: Date,
  language: string,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat(language, {
    day: "2-digit",
    month: "2-digit",
    timeZone,
  }).format(instant);
}

/**
 * Formats a past moment: "vor 9 Min." within the hour, else as
 * {@link formatDayTime}.
 */
export function formatPastMoment(
  iso: string | null,
  context: LabelContext,
): string {
  const instant = readInstant(iso);
  if (!instant) return EMPTY_CELL;
  const elapsed = context.now.getTime() - instant.getTime();
  if (elapsed >= 0 && elapsed < MINUTE_MS)
    return context.t("automations.time.justNow");
  if (elapsed >= 0 && elapsed < HOUR_MS)
    return context.t("automations.time.minutesAgo", {
      count: Math.floor(elapsed / MINUTE_MS),
    });
  return formatDayTime(instant, context);
}

/** Formats a moment of the history list as {@link formatDayTime}. */
export function formatRunMoment(
  iso: string | null,
  context: LabelContext,
): string {
  const instant = readInstant(iso);
  return instant ? formatDayTime(instant, context) : EMPTY_CELL;
}

/**
 * The next run of an automation for the table: "in 6 Min.", "heute
 * 22:00", "bei Ereignis", "manuell", "pausiert" or "—".
 */
export function formatNextRun(
  automation: Automation,
  context: LabelContext,
): string {
  const { t } = context;
  if (!automation.isActive) return t("automations.next.paused");
  if (automation.trigger.type === "manual") return t("automations.next.manual");
  if (automation.trigger.type === "event") return t("automations.next.event");
  const instant = readInstant(automation.nextRunAt);
  if (!instant) return EMPTY_CELL;
  const remaining = instant.getTime() - context.now.getTime();
  if (remaining < MINUTE_MS) return t("automations.time.soon");
  if (remaining < HOUR_MS)
    return t("automations.time.inMinutes", {
      count: Math.round(remaining / MINUTE_MS),
    });
  return formatDayTime(instant, context);
}

/**
 * Formats a duration: "2 s", "9 Min.", "3 Std. 12 Min." or "—".
 *
 * @param milliseconds - The duration, `null` while unknown.
 */
export function formatDuration(
  milliseconds: number | null,
  t: TFunction,
): string {
  if (milliseconds === null) return EMPTY_CELL;
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60)
    return t("automations.duration.seconds", { count: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60)
    return t("automations.duration.minutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return t("automations.duration.hours", { count: hours });
  return t("automations.duration.hoursMinutes", { hours, minutes: rest });
}
