import type { TFunction } from "i18next";

const MINUTE_MILLISECONDS = 60_000;
const HOUR_MINUTES = 60;
const DAY_MINUTES = 24 * HOUR_MINUTES;

function timeFormat(language: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(language, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function isSameLocalDay(first: Date, second: Date): boolean {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

function isYesterday(moment: Date, now: Date): boolean {
  const yesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
  );
  return isSameLocalDay(moment, yesterday);
}

/** The Monday, 00:00 local time, of the calendar week of a moment. */
function startOfWeek(moment: Date): Date {
  const daysSinceMonday = (moment.getDay() + 6) % 7;
  return new Date(
    moment.getFullYear(),
    moment.getMonth(),
    moment.getDate() - daysSinceMonday,
  );
}

function dateFormat(language: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(language, {
    day: "2-digit",
    month: "2-digit",
  });
}

/**
 * A clock time in the reader's language, such as `22:30`.
 * @param time - The moment.
 * @param language - The language of the interface.
 */
export function formatQuotaClock(time: Date, language: string): string {
  return timeFormat(language).format(time);
}

/**
 * A moment of a card, such as a reset or the last answer: the time today,
 * otherwise the weekday and the time.
 * @param moment - The moment.
 * @param now - The moment of display.
 * @param context - Translation and language of the interface.
 * @returns For example `23:40` or `Do 09:00`.
 */
export function formatQuotaMoment(
  moment: Date,
  now: Date,
  context: { readonly t: TFunction; readonly language: string },
): string {
  const clock = formatQuotaClock(moment, context.language);
  if (isSameLocalDay(moment, now)) return clock;
  const weekday = context.t(`agentsPage.weekday.${moment.getDay()}`);
  return `${weekday} ${clock}`;
}

/**
 * The time of Claude's last answer, by its age: the time today, `gestern`
 * and the time yesterday, the weekday and the time within this calendar
 * week, the date and the time before.
 * @param moment - The moment of the answer.
 * @param now - The moment of display.
 * @param context - Translation and language of the interface.
 * @returns For example `14:12`, `gestern 21:40`, `Mi 21:40` or `11.11. 21:40`.
 */
export function formatQuotaStand(
  moment: Date,
  now: Date,
  context: { readonly t: TFunction; readonly language: string },
): string {
  const { t, language } = context;
  const clock = formatQuotaClock(moment, language);
  if (isSameLocalDay(moment, now)) return clock;
  if (isYesterday(moment, now))
    return t("agentsPage.moment.yesterday", { time: clock });
  const isThisWeek =
    moment.getTime() >= startOfWeek(now).getTime() &&
    moment.getTime() < now.getTime();
  if (isThisWeek) {
    const weekday = t(`agentsPage.weekday.${moment.getDay()}`);
    return `${weekday} ${clock}`;
  }
  return `${dateFormat(language).format(moment)} ${clock}`;
}

/**
 * How long until a window resets, in its two largest units.
 * @param milliseconds - The time left.
 * @param t - Translation of the interface.
 * @returns For example `in 2 Tagen 9 Std.`, `in 2 Std. 7 Min.` or `in 1 Min.`.
 */
export function formatQuotaCountdown(
  milliseconds: number,
  t: TFunction,
): string {
  const minutes = Math.max(1, Math.ceil(milliseconds / MINUTE_MILLISECONDS));
  const days = Math.floor(minutes / DAY_MINUTES);
  const hours = Math.floor((minutes % DAY_MINUTES) / HOUR_MINUTES);
  const restMinutes = minutes % HOUR_MINUTES;
  const parts: string[] = [];
  if (days > 0) {
    parts.push(t("agentsPage.duration.days", { count: days }));
    if (hours > 0) parts.push(t("agentsPage.duration.hours", { count: hours }));
  } else if (hours > 0) {
    parts.push(t("agentsPage.duration.hours", { count: hours }));
    if (restMinutes > 0)
      parts.push(t("agentsPage.duration.minutes", { count: restMinutes }));
  } else {
    parts.push(t("agentsPage.duration.minutes", { count: restMinutes }));
  }
  return t("agentsPage.quota.countdown", { duration: parts.join(" ") });
}
