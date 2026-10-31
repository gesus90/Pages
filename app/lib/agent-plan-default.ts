import type { AgentPlanSummary } from "@/definition/AgentPlan";

/**
 * The name of the plan the editor opens when the address names no plan.
 *
 * @remarks
 * A provisional default (PAGE-102): the plan is looked up by name among the
 * plans the person may read and never created, copied or stored as a default.
 */
export const DEFAULT_PLAN_NAME = "Task2";

/**
 * How the editor came to the plan it shows.
 *
 * @remarks
 * `requested` and `default` show a plan; `requestedMissing` and
 * `defaultMissing` leave the canvas empty because the plan named in the
 * address, or the default plan, is missing or not readable. Neither falls
 * back to another plan.
 */
export type AgentPlanOpening =
  "requested" | "default" | "requestedMissing" | "defaultMissing";

/**
 * Returns the default plan among the plans a person may read.
 *
 * @param plans - The plans the person may read now.
 * @param userId - The person, whose own plan wins over a shared one of the same name.
 * @returns The plan identifier, or `null` when no readable plan carries the default name.
 */
export function defaultPlanId(
  plans: readonly Pick<AgentPlanSummary, "id" | "name" | "ownerId">[],
  userId: string,
): string | null {
  const candidates = plans.filter(
    (plan) => plan.name.trim() === DEFAULT_PLAN_NAME,
  );
  const own = candidates.find((plan) => plan.ownerId === userId);
  return (own ?? candidates[0])?.id ?? null;
}
