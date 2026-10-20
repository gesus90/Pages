import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanService } from "./AgentPlanService";

/** Returns only the executor's run history whose resources remain readable. */
export async function readPlanHistory(
  plans: Pick<AgentPlanService, "run">,
  runs: Pick<AgentPlanRunRepository, "list">,
  userId: string,
  planId: string,
): Promise<readonly AgentPlanRun[]> {
  const history: AgentPlanRun[] = [];
  for (const run of await runs.list(userId, planId)) {
    try {
      history.push(await plans.run(userId, run.id));
    } catch (error: unknown) {
      logCaughtError("AgentPlanService", error);

      if (!(error instanceof AgentError)) throw error;
    }
  }
  return history;
}
