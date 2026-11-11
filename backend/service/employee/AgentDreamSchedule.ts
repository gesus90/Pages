import {
  AGENT_DREAM_DEFAULT_TIME,
  AGENT_DREAM_TIME_PATTERN,
} from "@/definition/AgentMemory";

import { addHours } from "./AgentEmployeeText";

import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";

const DAY_MILLISECONDS = 24 * 60 * 60_000;

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
 * The newest moment of the daily dream time that is not after `now`, in
 * the time zone of the server (PAGE-305).
 */
export function latestDreamSlot(now: Date, time: string): Date {
  const { hours, minutes } = readTime(time);
  const slot = new Date(now);
  slot.setHours(hours, minutes, 0, 0);
  return slot.getTime() > now.getTime()
    ? new Date(slot.getTime() - DAY_MILLISECONDS)
    : slot;
}

/** The next moment of the daily dream time after `now`. */
export function nextDreamSlot(now: Date, time: string): Date {
  return new Date(latestDreamSlot(now, time).getTime() + DAY_MILLISECONDS);
}

/**
 * Whether the dream run of an agent is due: once per day at the dream time,
 * when its last run, or its creation, lies before the newest slot.
 */
export function isDreamDue(
  agent: StoredAgentEmployee,
  now: Date,
  time: string,
): boolean {
  if (!agent.isLearningEnabled) return false;
  const last = addHours(agent.lastLearningAt ?? agent.createdAt, 0);
  return last.getTime() < latestDreamSlot(now, time).getTime();
}
