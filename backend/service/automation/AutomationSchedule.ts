import { AUTOMATION_UNIT_SECONDS } from "@/definition/Automation";

import type {
  AutomationIntervalTrigger,
  AutomationTrigger,
  AutomationWeeklyTrigger,
  AutomationWindow,
} from "@/definition/Automation";

/** Days the search for the next allowed time looks ahead at most. */
const SEARCH_DAYS = 400;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const WEEKDAYS: Readonly<Record<string, number>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** A wall-clock time in a time zone. */
interface ZonedTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** ISO weekday, 1 Monday to 7 Sunday. */
  readonly weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterOf(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Reads the wall-clock time of an instant in a time zone. */
function zonedTime(instant: number, timeZone: string): ZonedTime {
  const parts = new Map<string, string>(
    formatterOf(timeZone)
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  const read = (type: string): number => Number(parts.get(type) ?? "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
    weekday: WEEKDAYS[parts.get("weekday") ?? "Mon"] ?? 1,
  };
}

/** Milliseconds the time zone is ahead of UTC at an instant. */
function offsetAt(instant: number, timeZone: string): number {
  const local = zonedTime(instant, timeZone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant of a wall-clock time in a time zone.
 *
 * @remarks
 * Day and month overflow roll over like `Date.UTC`. A time that does not
 * exist because the clocks jump forward runs at the same distance after the
 * jump; a time that exists twice runs at its first occurrence.
 */
function instantOf(
  civil: Omit<ZonedTime, "weekday" | "second"> & { readonly second?: number },
  timeZone: string,
): number {
  const guess = Date.UTC(
    civil.year,
    civil.month - 1,
    civil.day,
    civil.hour,
    civil.minute,
    civil.second ?? 0,
  );
  const wanted = zonedTime(guess, "UTC");
  const before = guess - offsetAt(guess - DAY_MILLISECONDS, timeZone);
  const after = guess - offsetAt(guess + DAY_MILLISECONDS, timeZone);
  const matches = [before, after].filter((candidate) => {
    const local = zonedTime(candidate, timeZone);
    return (
      local.day === wanted.day &&
      local.hour === wanted.hour &&
      local.minute === wanted.minute
    );
  });
  // Without a match the clocks jumped over the time; the offset before the
  // jump places it as far after the jump as it lay after the last valid minute.
  return matches.length > 0 ? Math.min(...matches) : before;
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/**
 * Tells whether a minute of the day lies in a window.
 *
 * @remarks
 * The end is exclusive; an end before the start crosses midnight, an equal
 * start and end means the whole day.
 */
export function isInWindow(
  minuteOfDay: number,
  window: AutomationWindow | undefined,
): boolean {
  if (!window) return true;
  const start = minutesOf(window.start);
  const end = minutesOf(window.end);
  if (start === end) return true;
  if (start < end) return minuteOfDay >= start && minuteOfDay < end;
  return minuteOfDay >= start || minuteOfDay < end;
}

function isAllowed(
  local: ZonedTime,
  trigger: Pick<AutomationIntervalTrigger, "weekdays" | "window">,
): boolean {
  const isDayAllowed =
    !trigger.weekdays || trigger.weekdays.includes(local.weekday);
  return (
    isDayAllowed && isInWindow(local.hour * 60 + local.minute, trigger.window)
  );
}

/** The next start of the window, or the next midnight without a window. */
function nextAllowedStart(
  instant: number,
  trigger: Pick<AutomationIntervalTrigger, "timeZone" | "window">,
): number {
  const local = zonedTime(instant, trigger.timeZone);
  const start = trigger.window ? minutesOf(trigger.window.start) : 0;
  const current = local.hour * 60 + local.minute;
  const dayOffset = current < start ? 0 : 1;
  return instantOf(
    {
      year: local.year,
      month: local.month,
      day: local.day + dayOffset,
      hour: Math.floor(start / 60),
      minute: start % 60,
    },
    trigger.timeZone,
  );
}

/** Moves an instant forward to the first moment the weekdays and the window allow. */
function constrain(
  instant: number,
  trigger: AutomationIntervalTrigger,
): number | null {
  let candidate = instant;
  for (let step = 0; step < SEARCH_DAYS * 2; step += 1) {
    if (isAllowed(zonedTime(candidate, trigger.timeZone), trigger))
      return candidate;
    candidate = nextAllowedStart(candidate, trigger);
  }
  return null;
}

/** Adds the interval to an instant; days are calendar days of the time zone. */
function addInterval(
  instant: number,
  trigger: AutomationIntervalTrigger,
): number {
  if (trigger.unit !== "day")
    return (
      instant + trigger.every * AUTOMATION_UNIT_SECONDS[trigger.unit] * 1000
    );
  const local = zonedTime(instant, trigger.timeZone);
  return instantOf(
    {
      year: local.year,
      month: local.month,
      day: local.day + trigger.every,
      hour: local.hour,
      minute: local.minute,
      second: local.second,
    },
    trigger.timeZone,
  );
}

/** The first weekly time strictly after an instant. */
function nextWeekly(
  trigger: AutomationWeeklyTrigger,
  after: number,
): number | null {
  const times = [...trigger.times]
    .filter((time) => isInWindow(minutesOf(time), trigger.window))
    .sort();
  if (times.length === 0) return null;
  const today = zonedTime(after, trigger.timeZone);
  for (let offset = 0; offset <= 8; offset += 1) {
    const dayStart = instantOf(
      {
        year: today.year,
        month: today.month,
        day: today.day + offset,
        hour: 12,
        minute: 0,
      },
      trigger.timeZone,
    );
    const day = zonedTime(dayStart, trigger.timeZone);
    if (!trigger.weekdays.includes(day.weekday)) continue;
    for (const time of times) {
      const minutes = minutesOf(time);
      const instant = instantOf(
        {
          year: day.year,
          month: day.month,
          day: day.day,
          hour: Math.floor(minutes / 60),
          minute: minutes % 60,
        },
        trigger.timeZone,
      );
      if (instant > after) return instant;
    }
  }
  return null;
}

function iso(instant: number | null): string | null {
  return instant === null ? null : new Date(instant).toISOString();
}

/**
 * The first due time of a trigger that is switched on now.
 *
 * @param trigger - The trigger of an active automation.
 * @param now - The current time.
 * @returns The ISO time, or `null` for triggers without a time and a once
 * trigger without one.
 *
 * @remarks
 * An interval starts one interval after switching on, within its weekdays
 * and window; a once trigger keeps its time.
 */
export function firstRunAt(
  trigger: AutomationTrigger,
  now: Date,
): string | null {
  const instant = now.getTime();
  switch (trigger.type) {
    case "once":
      return trigger.at === null ? null : new Date(trigger.at).toISOString();
    case "interval":
      return iso(constrain(addInterval(instant, trigger), trigger));
    case "weekly":
      return iso(nextWeekly(trigger, instant));
    case "manual":
    case "event":
      return null;
  }
}

/**
 * The due time after a run that was due at a time.
 *
 * @param trigger - The trigger of the automation.
 * @param dueAt - When the run that just started was due.
 * @param now - The current time.
 * @returns The next ISO time; `null` once a once trigger ran.
 *
 * @remarks
 * Missed times are not repeated: a run that was due long ago starts once and
 * the next one is planned from now, keeping the rhythm while nothing was missed.
 */
export function nextRunAfter(
  trigger: AutomationTrigger,
  dueAt: Date,
  now: Date,
): string | null {
  switch (trigger.type) {
    case "interval": {
      let next = addInterval(dueAt.getTime(), trigger);
      if (next <= now.getTime()) next = addInterval(now.getTime(), trigger);
      return iso(constrain(next, trigger));
    }
    case "weekly":
      return iso(nextWeekly(trigger, Math.max(dueAt.getTime(), now.getTime())));
    case "manual":
    case "once":
    case "event":
      return null;
  }
}
