import { planJumpMinutes } from "@/definition/AgentPlanJump";

import type { TFunction } from "i18next";
import type { AgentPlanJumpOut } from "@/definition/AgentPlanJump";

/**
 * The first of the texts that is not empty after trimming, or an empty text.
 * @param texts - The candidates in the order of preference.
 */
export function firstFilledText(
  ...texts: readonly (string | undefined)[]
): string {
  for (const text of texts) {
    const trimmed = text?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;

/**
 * A wait in days, hours and minutes, such as `1 d 2 h 5 min`.
 * @param minutes - The length of the wait.
 * @param translate - The translation function.
 */
export function planJumpDuration(
  minutes: number,
  translate: TFunction,
): string {
  const days = Math.floor(minutes / MINUTES_PER_DAY);
  const hours = Math.floor((minutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  const parts = [
    ...(days > 0
      ? [translate("plans.jump.duration.days", { count: days })]
      : []),
    ...(hours > 0
      ? [translate("plans.jump.duration.hours", { count: hours })]
      : []),
    ...(rest > 0 || minutes === 0
      ? [translate("plans.jump.duration.minutes", { count: rest })]
      : []),
  ];
  return parts.join(" ");
}

/** How long a calling Jump waits at most: the finite wait, or `Unbegrenzt`; empty for a Jump that does not wait. */
export function planJumpTimeoutText(
  node: AgentPlanJumpOut,
  translate: TFunction,
): string {
  if (node.wait === "continue") return "";
  const minutes = planJumpMinutes(node);
  return minutes === null
    ? translate("plans.jump.unlimited")
    : planJumpDuration(minutes, translate);
}

/**
 * The remaining time until a deadline, rounded up to whole minutes.
 * @param deadlineAt - The deadline as an ISO time, or `null` for a wait without limit.
 * @param now - The current time in milliseconds.
 * @param translate - The translation function.
 */
export function planJumpRemaining(
  deadlineAt: string | null,
  now: number,
  translate: TFunction,
): string {
  if (deadlineAt === null) return translate("plans.jump.unlimited");
  const minutes = Math.ceil((Date.parse(deadlineAt) - now) / 60_000);
  if (!Number.isFinite(minutes)) return translate("plans.jump.unlimited");
  if (minutes <= 0) return translate("plans.jump.run.overdue");
  return translate("plans.jump.run.remaining", {
    duration: planJumpDuration(minutes, translate),
  });
}
