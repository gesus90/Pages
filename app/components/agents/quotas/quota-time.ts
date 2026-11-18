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
