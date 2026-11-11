/** How long a one-time plan stays after a run ended as `succeeded` (PAGE-309). */
export const ONE_SHOT_DELETION_DELAY_MS = 5 * 60 * 1000;

/** What a plan list, a plan read and the control state say about a one-time plan. */
export interface AgentPlanOneShotState {
  /** Whether Pages deletes the plan after a run that ends as `succeeded`. */
  readonly oneShot: boolean;
  /** When Pages deletes the plan, an ISO 8601 UTC time; absent while nothing is scheduled. */
  readonly scheduledDeletionAt?: string;
}

/** The longest name a plan can have; a suggested copy name is cut to fit. */
const MAXIMUM_PLAN_NAME_LENGTH = 120;

/**
 * Suggests the name of a one-time copy: `<Name> · <label> · <date>`.
 *
 * @param name - The name of the source plan.
 * @param label - The localized word for "one-time".
 * @param date - The day of the copy, shown as `YYYY-MM-DD`.
 * @returns A name within the length limit of plan names; the source name is
 * shortened first.
 */
export function suggestOneShotCopyName(
  name: string,
  label: string,
  date: Date,
): string {
  const suffix = ` · ${label} · ${date.toISOString().slice(0, 10)}`;
  const room = Math.max(1, MAXIMUM_PLAN_NAME_LENGTH - suffix.length);
  return `${name.trim().slice(0, room).trimEnd()}${suffix}`;
}
