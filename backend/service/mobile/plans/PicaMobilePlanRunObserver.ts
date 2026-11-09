import { logCaughtError } from "@/backend/logging/Logger";
import { planRunVisibleState } from "@/backend/service/agents/AgentPlanRunFingerprint";

import type { AgentPlanRunObserver } from "@/backend/service/agents/AgentPlanRunObservers";
import type { AgentPlanRun } from "@/definition/AgentPlan";

const COMPONENT = "PicaMobilePlanRunObserver";

/**
 * Tells the Pica Mobile connections of an account that a run of it changed.
 *
 * @remarks
 * It compares only the two views it is given and never reads the database,
 * because it runs while the write that just committed still holds it. It
 * compares everything a plan row or the flow of `plans.flow.v1` shows: the
 * state of the run, of every step, of every loop and of each of its
 * iterations and their nodes, the failure and the end. A change only inside
 * a running loop therefore tells the listeners as well; a progress record
 * that changes none of it tells nobody. A failing listener is logged and
 * never changes the run.
 */
export class PicaMobilePlanRunObserver implements AgentPlanRunObserver {
  private readonly listeners = new Map<string, Set<() => void>>();

  /**
   * Tells the listeners of the run's account when the visible state of the run changes.
   *
   * @param previous - The view before the write.
   * @param next - The view after the write.
   */
  public runChanged(previous: AgentPlanRun, next: AgentPlanRun): void {
    const listeners = this.listeners.get(next.userId);

    if (
      listeners === undefined ||
      planRunVisibleState(previous) === planRunVisibleState(next)
    ) {
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
