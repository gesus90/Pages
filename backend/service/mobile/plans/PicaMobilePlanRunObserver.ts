import { logCaughtError } from "@/backend/logging/Logger";
import { failureReason } from "@/backend/service/agents/AgentPlanRunTransitions";

import type { AgentPlanRunObserver } from "@/backend/service/agents/AgentPlanRunObservers";
import type { AgentPlanRun } from "@/definition/AgentPlan";

const COMPONENT = "PicaMobilePlanRunObserver";

/** What a plan row shows of a run; a write that keeps it changes no row. */
function signature(run: AgentPlanRun): string {
  return JSON.stringify([
    run.status,
    run.steps.map((step) => [step.id, step.status]),
    run.controlError ?? null,
    failureReason(run),
    run.steps.find((step) => step.status === "failed")?.name ?? null,
  ]);
}

/**
 * Tells the Pica Mobile connections of an account that a run of it changed.
 *
 * @remarks
 * It compares only the two views it is given and never reads the database,
 * because it runs while the write that just committed still holds it. A
 * progress record that changes neither the state of the run or a step nor
 * its failure tells nobody. A failing listener is logged and never changes
 * the run.
 */
export class PicaMobilePlanRunObserver implements AgentPlanRunObserver {
  private readonly listeners = new Map<string, Set<() => void>>();

  /**
   * Tells the listeners of the run's account when the row of the run changes.
   *
   * @param previous - The view before the write.
   * @param next - The view after the write.
   */
  public runChanged(previous: AgentPlanRun, next: AgentPlanRun): void {
    const listeners = this.listeners.get(next.userId);

    if (listeners === undefined || signature(previous) === signature(next)) {
      return;
    }

    for (const listener of listeners) {
      try {
        listener();
      } catch (error: unknown) {
        logCaughtError(COMPONENT, error);
      }
    }
  }

  /**
   * Adds a listener for the runs of one account.
   *
   * @param userId - The account whose runs the listener follows.
   * @param listener - Called after every write that changes a row.
   * @returns Removes the listener again.
   */
  public watch(userId: string, listener: () => void): () => void {
    const listeners = this.listeners.get(userId) ?? new Set<() => void>();

    listeners.add(listener);
    this.listeners.set(userId, listeners);

    return () => {
      listeners.delete(listener);

      if (listeners.size === 0 && this.listeners.get(userId) === listeners) {
        this.listeners.delete(userId);
      }
    };
  }
}
