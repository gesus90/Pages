import { isPlanHistoryReadFailure } from "./AgentPlanControlAccess";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanService } from "./AgentPlanService";

/**
 * Returns the executor's newest run whose resources remain readable, in full.
 *
 * @remarks
 * Older runs are not read here: the history list names them by start and
 * status, and a run of it is read in full only when the person chooses it.
 */
export async function readPlanHistory(
  plans: Pick<AgentPlanService, "run">,
  runs: Pick<AgentPlanRunRepository, "entries">,
  userId: string,
  planId: string,
): Promise<readonly AgentPlanRun[]> {
  for (const entry of await runs.entries(userId, planId, "newest")) {
    try {
      return [await plans.run(userId, entry.id)];
    } catch (error: unknown) {
      logCaughtError("AgentPlanService", error);

      if (!isPlanHistoryReadFailure(error)) throw error;
    }
  }
  return [];
}
