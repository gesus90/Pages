import {
  AGENT_DREAM_DEFAULT_TIME,
  AGENT_DREAM_TIME_PATTERN,
} from "@/definition/AgentMemory";
import {
  AGENT_DREAM_INTERVAL_RANGE,
  AGENT_DREAM_WEEKDAY_RANGE,
  AGENT_DREAM_WEEKLY_DAYS,
} from "@/definition/AgentDreaming";

import { addHours } from "./AgentEmployeeText";

import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { AgentDreamSchedule } from "@/definition/AgentDreaming";

const HOUR_MILLISECONDS = 3_600_000;

/** What decides when the dream run of an agent is next due. */
export type AgentDreamScheduleSource = Pick<
  StoredAgentEmployee,
  "dreamSchedule" | "lastLearningAt" | "createdAt" | "dreamRequest"
>;

/** The hours and minutes of a dream time; an unreadable one counts as the default. */
function readTime(time: string): {
  readonly hours: number;
  readonly minutes: number;
} {
  const valid = AGENT_DREAM_TIME_PATTERN.test(time)
    ? time
    : AGENT_DREAM_DEFAULT_TIME;
  const [hours, minutes] = valid.split(":").map(Number);
  return { hours: hours ?? 3, minutes: minutes ?? 0 };
}

/**
 * The first moment of the time of day that lies after `from`, in the time
 * zone of the server; with a weekday, the first one on that weekday.
 */
function firstSlotAfter(
  from: Date,
  time: string,
  weekday: number | null,
): Date {
  const { hours, minutes } = readTime(time);
  const slot = new Date(from);
  slot.setHours(hours, minutes, 0, 0);
  // Calendar days, not 24 hours, so a change of the clock keeps the time of day.
  while (
    slot.getTime() <= from.getTime() ||
    (weekday !== null && slot.getDay() !== weekday % 7)
  )
    slot.setDate(slot.getDate() + 1);
  return slot;
}

/**
 * Whether a schedule is one the dream run accepts: an interval within the
 * range of its unit, a time of day only for days, a weekday only at an
 * interval of 7 days.
 *
 * @param schedule - The schedule to check.
 */
export function isValidDreamSchedule(schedule: AgentDreamSchedule): boolean {
  const range = AGENT_DREAM_INTERVAL_RANGE[schedule.unit];
  if (
    !Number.isInteger(schedule.interval) ||
    schedule.interval < range.minimum ||
    schedule.interval > range.maximum
  )
    return false;
  if (schedule.time !== null && !AGENT_DREAM_TIME_PATTERN.test(schedule.time))
    return false;
  if (schedule.unit === "hours" && schedule.time !== null) return false;
  if (schedule.weekday === null) return true;
  return (
    schedule.unit === "days" &&
    schedule.interval === AGENT_DREAM_WEEKLY_DAYS &&
    Number.isInteger(schedule.weekday) &&
    schedule.weekday >= AGENT_DREAM_WEEKDAY_RANGE.minimum &&
    schedule.weekday <= AGENT_DREAM_WEEKDAY_RANGE.maximum
  );
}

/**
 * The next scheduled run of an agent, counted from its last run or, without
 * one, from its creation (PAGE-378).
 *
 * @remarks
 * Hours count from the last run. Days run at the time of day, in the time
 * zone of the server: every day, every n-th day after the last run, or at an
 * interval of 7 days on the chosen weekday. A run that was late, such as one
 * that waited for the agent to leave its chats, moves the following ones.
 *
 * @param agent - The schedule and the last run of the agent.
 * @param instanceTime - The time of day of the instance, `HH:MM`, for a schedule without a time.
 * @returns The moment, which may lie in the past for a run that is overdue; `null` while the dream run is off.
 */
export function nextDreamRun(
  agent: AgentDreamScheduleSource,
  instanceTime: string,
): Date | null {
  const { dreamSchedule: schedule } = agent;
  if (!schedule.isEnabled) return null;
  const base = addHours(agent.lastLearningAt ?? agent.createdAt, 0);
  if (schedule.unit === "hours")
    return new Date(
      base.getTime() + schedule.interval * HOUR_MILLISECONDS,
    );
  const time = schedule.time ?? instanceTime;
  if (schedule.weekday !== null)
    return firstSlotAfter(base, time, schedule.weekday);
  // Every n-th day: the slot after the day before the n-th one.
  const from = new Date(base);
  from.setDate(from.getDate() + schedule.interval - 1);
  return firstSlotAfter(from, time, null);
}

/**
 * Whether the dream run of an agent is due: somebody asked for a run that has
 * not happened yet, or it is on and the next scheduled run has come.
 *
 * @param agent - The schedule and the last run of the agent.
 * @param now - The moment to judge.
 * @param instanceTime - The time of day of the instance, `HH:MM`.
 */
export function isDreamDue(
  agent: AgentDreamScheduleSource,
  now: Date,
  instanceTime: string,
): boolean {
  // A run somebody asked for is due whatever the switch says.
  if (agent.dreamRequest !== null) return true;
  const next = nextDreamRun(agent, instanceTime);
  return next !== null && next.getTime() <= now.getTime();
}
