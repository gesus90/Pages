import {
  wallClockOf,
  zonedInstant,
} from "@/backend/service/automation/AutomationSchedule";
import { AGENT_CHAT_TASK_MINIMUM_INTERVAL_MINUTES } from "@/definition/AgentChatTask";

import type { AutomationTrigger } from "@/definition/Automation";
import type { AgentChatTaskSchedule } from "@/definition/AgentChatTask";

/** The languages the confirmation of a task is written in. */
export type AgentChatTaskLanguage = "de" | "en";

/** Why a schedule cannot become a trigger. */
export class AgentChatTaskScheduleError extends Error {
  public readonly code: "invalid" | "time_in_past";

  public constructor(code: AgentChatTaskScheduleError["code"]) {
    super(code);
    this.name = "AgentChatTaskScheduleError";
    this.code = code;
  }
}

const UNIT_MINUTES = { minute: 1, hour: 60, day: 1_440 } as const;

const DAY_MILLISECONDS = 86_400_000;

const TEXTS = {
  de: {
    weekdays: [
      "Montag",
      "Dienstag",
      "Mittwoch",
      "Donnerstag",
      "Freitag",
      "Samstag",
      "Sonntag",
    ],
    relative: ["Heute", "Morgen", "Übermorgen"],
    and: "und",
    clock: (hour: number, minute: string) => `${String(hour)}:${minute} Uhr`,
    clocks: (times: readonly string[]) => `${joinList(times, "und")} Uhr`,
    date: (day: number, month: number, year: number | null) =>
      `${String(day)}.${String(month)}.${year === null ? "" : String(year)}`,
    once: (label: string, date: string, clock: string) =>
      `${label}, ${date}, ${clock}`,
    every: {
      minute: (count: number) =>
        count === 1 ? "Jede Minute" : `Alle ${String(count)} Minuten`,
      hour: (count: number) =>
        count === 1 ? "Jede Stunde" : `Alle ${String(count)} Stunden`,
      day: (count: number) =>
        count === 1 ? "Jeden Tag" : `Alle ${String(count)} Tage`,
    },
    weekly: (days: string, times: string) => `${days} um ${times}`,
    everyDay: "Jeden Tag",
    workdays: "Werktags (Mo–Fr)",
    everyWeekday: (days: string) => `Jeden ${days}`,
    done: "Erledigt",
  },
  en: {
    weekdays: [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ],
    relative: ["Today", "Tomorrow", "The day after tomorrow"],
    and: "and",
    clock: (hour: number, minute: string) =>
      `${String(hour).padStart(2, "0")}:${minute}`,
    clocks: (times: readonly string[]) => joinList(times, "and"),
    date: (day: number, month: number, year: number | null) =>
      `${String(month)}/${String(day)}${year === null ? "" : `/${String(year)}`}`,
    once: (label: string, date: string, clock: string) =>
      `${label}, ${date}, ${clock}`,
    every: {
      minute: (count: number) =>
        count === 1 ? "Every minute" : `Every ${String(count)} minutes`,
      hour: (count: number) =>
        count === 1 ? "Every hour" : `Every ${String(count)} hours`,
      day: (count: number) =>
        count === 1 ? "Every day" : `Every ${String(count)} days`,
    },
    weekly: (days: string, times: string) => `${days} at ${times}`,
    everyDay: "Every day",
    workdays: "Every weekday (Mon–Fri)",
    everyWeekday: (days: string) => `Every ${days}`,
    done: "Done",
  },
} as const;

/** "A, B und C". */
function joinList(items: readonly string[], conjunction: string): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1) ?? ""}`;
}

/**
 * Turns the schedule the agent planned into the trigger of an automation.
 *
 * @param schedule - The schedule in wall-clock times of the person.
 * @param context - The time zone of the person who asked and the clock.
 * @throws {AgentChatTaskScheduleError} `invalid` for a time that does not
 * exist or an interval below the minimum, `time_in_past` for a once time
 * that has passed.
 */
export function chatTaskTrigger(
  schedule: AgentChatTaskSchedule,
  context: { readonly timeZone: string; readonly now: Date },
): AutomationTrigger {
  const { timeZone, now } = context;
  switch (schedule.type) {
    case "once": {
      const at = zonedInstant(schedule.at, timeZone);
      if (at === null) throw new AgentChatTaskScheduleError("invalid");
      if (Date.parse(at) <= now.getTime())
        throw new AgentChatTaskScheduleError("time_in_past");
      return { type: "once", at, timeZone };
    }
    case "interval":
      if (
        schedule.every * UNIT_MINUTES[schedule.unit] <
        AGENT_CHAT_TASK_MINIMUM_INTERVAL_MINUTES
      )
        throw new AgentChatTaskScheduleError("invalid");
      return {
        type: "interval",
        every: schedule.every,
        unit: schedule.unit,
        timeZone,
      };
    case "weekly":
      return {
        type: "weekly",
        weekdays: [...new Set(schedule.weekdays)].sort((a, b) => a - b),
        times: [...new Set(schedule.times)].sort(),
        timeZone,
      };
  }
}

/** The days between two calendar dates. */
function dayDistance(
  from: { readonly year: number; readonly month: number; readonly day: number },
  to: { readonly year: number; readonly month: number; readonly day: number },
): number {
  return Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) -
      Date.UTC(from.year, from.month - 1, from.day)) /
      DAY_MILLISECONDS,
  );
}

function describeOnce(
  at: string,
  context: {
    readonly timeZone: string;
    readonly now: Date;
    readonly language: AgentChatTaskLanguage;
  },
): string {
  const texts = TEXTS[context.language];
  const target = wallClockOf(Date.parse(at), context.timeZone);
  const today = wallClockOf(context.now.getTime(), context.timeZone);
  const distance = dayDistance(today, target);
  const label =
    texts.relative[distance] ?? texts.weekdays[target.weekday - 1] ?? "";
  const minute = String(target.minute).padStart(2, "0");
  return texts.once(
    label,
    texts.date(
      target.day,
      target.month,
      target.year === today.year ? null : target.year,
    ),
    texts.clock(target.hour, minute),
  );
}

function describeDays(
  weekdays: readonly number[],
  language: AgentChatTaskLanguage,
): string {
  const texts = TEXTS[language];
  const days = [...weekdays].sort((a, b) => a - b);
  if (days.length === 7) return texts.everyDay;
  if (days.join(",") === "1,2,3,4,5") return texts.workdays;
  return texts.everyWeekday(
    joinList(
      days.map((day) => texts.weekdays[day - 1] ?? ""),
      texts.and,
    ),
  );
}

/**
 * Names when a task runs in plain language: "Morgen, 16.11., 9:00 Uhr",
 * "Alle 2 Stunden" or "Jeden Montag um 9:00 Uhr" (PAGE-392).
 *
 * @param trigger - The trigger of the task.
 * @param context - The clock and the language of the person who asked;
 * times count in the time zone of the trigger.
 */
export function describeChatTaskTrigger(
  trigger: AutomationTrigger,
  context: { readonly now: Date; readonly language: AgentChatTaskLanguage },
): string {
  const texts = TEXTS[context.language];
  switch (trigger.type) {
    case "once":
      return trigger.at === null
        ? texts.done
        : describeOnce(trigger.at, { ...context, timeZone: trigger.timeZone });
    case "interval":
      return trigger.unit === "second"
        ? texts.every.minute(Math.max(1, Math.round(trigger.every / 60)))
        : texts.every[trigger.unit](trigger.every);
    case "weekly":
      return texts.weekly(
        describeDays(trigger.weekdays, context.language),
        context.language === "de"
          ? texts.clocks(
              trigger.times.map((time) => time.replace(/^0(?=\d:)/u, "")),
            )
          : texts.clocks(trigger.times),
      );
    case "manual":
    case "event":
      return "";
  }
}
