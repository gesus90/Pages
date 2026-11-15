import type { TFunction } from "i18next";
import type { AutomationTrigger } from "@/definition/Automation";

/** A Monday, from which the names of the weekdays are read. */
const MONDAY = Date.UTC(2024, 0, 1, 12);

const DAY_MILLISECONDS = 86_400_000;

/** The name of an ISO weekday in the language of the page. */
function weekdayName(weekday: number, language: string): string {
  return new Intl.DateTimeFormat(language, {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(MONDAY + (weekday - 1) * DAY_MILLISECONDS));
}

/**
 * A moment as the dialog "Geplante Aufgaben" names it: weekday, date and
 * time in the time zone the task counts in.
 *
 * @param moment - The ISO moment.
 * @param language - The language of the page.
 * @param timeZone - The time zone of the task.
 */
export function formatTaskMoment(
  moment: string,
  language: string,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat(language, {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(moment));
}

/** The time zone a trigger counts in; the page's own for one without. */
export function triggerTimeZone(trigger: AutomationTrigger): string | undefined {
  return "timeZone" in trigger ? trigger.timeZone : undefined;
}

/**
 * Names the rhythm of a scheduled task (PAGE-392): once at a time, every N
 * minutes, hours or days, or on weekdays at times.
 *
 * @param trigger - The trigger of the task.
 * @param t - The translation of the page.
 * @param language - The language of the page.
 */
export function describeTaskSchedule(
  trigger: AutomationTrigger,
  t: TFunction,
  language: string,
): string {
  switch (trigger.type) {
    case "once":
      return trigger.at === null
        ? t("chatPage.tasks.schedule.done")
        : t("chatPage.tasks.schedule.once", {
            moment: formatTaskMoment(trigger.at, language, trigger.timeZone),
          });
    case "interval":
      return t(`chatPage.tasks.schedule.every.${trigger.unit}`, {
        count: trigger.every,
      });
    case "weekly":
      return t("chatPage.tasks.schedule.weekly", {
        days: new Intl.ListFormat(language, { type: "conjunction" }).format(
          trigger.weekdays.map((day) => weekdayName(day, language)),
        ),
        times: new Intl.ListFormat(language, { type: "conjunction" }).format(
          trigger.times,
        ),
      });
    case "manual":
    case "event":
      return "";
  }
}
