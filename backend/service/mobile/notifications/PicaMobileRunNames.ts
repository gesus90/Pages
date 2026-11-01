import type { StoredEventStep } from "@/backend/database/repositories/mobile/PicaMobileNotificationEventRepository";
import type { AgentPlanRun } from "@/definition/AgentPlan";

/**
 * Finds the current name of a step instance in an authorized view of a run.
 *
 * @param run - The view of the run, read with the rights of the account.
 * @param step - The stored identity of the step instance.
 * @returns The name, or `null` when the run no longer shows that instance.
 *
 * @remarks
 * Names are never stored with an event; every use reads them again, so an
 * account that lost the right to the run sees none.
 */
export function findStepName(
  run: AgentPlanRun,
  step: StoredEventStep,
): string | null {
  if (step.loopId === null) {
    return run.steps.find((entry) => entry.id === step.stepId)?.name ?? null;
  }

  return (
    run.loops
      ?.find((loop) => loop.id === step.loopId)
      ?.iterations.find((iteration) => iteration.number === step.iteration)
      ?.nodes.find((node) => node.id === step.stepId)?.name ?? null
  );
}
