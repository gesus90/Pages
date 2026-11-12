import { AgentPlanOneShotRepository } from "@/backend/database/repositories/agent/AgentPlanOneShotRepository";
import { purgeAllPlanRuns } from "@/backend/database/repositories/agent/AgentPlanRunPurge";
import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
import { AgentPlanOneShotScheduler } from "@/backend/service/agents/AgentPlanOneShotScheduler";
import { AgentPlanOneShotService } from "@/backend/service/agents/AgentPlanOneShotService";
import { sharedAgentPlanRunObservers } from "@/backend/service/agents/AgentPlanRunObservers";

import type { Database } from "@/backend/database/Database";

declare global {
  var pagesOneShotPlanDeletion: (() => void) | undefined;
}

/**
 * Starts the deletion of one-time plans where plans run (PAGE-309).
 *
 * @param database - The shared database.
 *
 * @remarks
 * The scheduler listens for runs that end as `succeeded` and checks the stored
 * deadlines from the start on, so a deletion that fell due during a restart
 * is carried out afterwards. A second call replaces the first.
 */
export function startOneShotPlanDeletion(database: Database): void {
  globalThis.pagesOneShotPlanDeletion?.();
  const scheduler = new AgentPlanOneShotScheduler({
    service: new AgentPlanOneShotService({
      repository: new AgentPlanOneShotRepository(database),
      purgeRuns: (planId) => purgeAllPlanRuns(database, planId),
      now: () => new Date(),
    }),
  });
  const detach = sharedAgentPlanRunObservers().add(scheduler);
  scheduler.start();
  const stop = (): void => {
    detach();
    scheduler.stop();
  };
  globalThis.pagesOneShotPlanDeletion = stop;
  registerShutdownTask(
    () => {
      stop();
      return Promise.resolve();
    },
    { step: "one_shot_plans" },
  );
}
