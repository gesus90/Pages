import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentPlanRun } from "@/definition/AgentPlan";

/**
 * Learns about committed writes of plan runs.
 *
 * @remarks
 * An observer runs while the database is still busy with the write that just
 * committed. It must therefore only look at the two views and queue its own
 * work; it must not wait for the database, and what it does can never change
 * the run.
 */
export interface AgentPlanRunObserver {
  /** Called once per committed write of a run, with the view before and after. */
  runChanged(previous: AgentPlanRun, next: AgentPlanRun): void;
}

/** The observers of run writes of this process. */
export class AgentPlanRunObservers {
  private readonly observers = new Set<AgentPlanRunObserver>();

  /**
   * Adds an observer.
   *
   * @param observer - Receives every committed write of a run from now on.
   * @returns Removes the observer again.
   */
  public add(observer: AgentPlanRunObserver): () => void {
    this.observers.add(observer);

    return () => {
      this.observers.delete(observer);
    };
  }

  /**
   * Tells every observer about a committed write.
   *
   * @param previous - The view of the run before the write.
   * @param next - The view of the run after the write.
   *
   * @remarks
   * A failing observer is logged and skipped; the write stays committed and
   * the other observers still hear about it.
   */
  public notify(previous: AgentPlanRun, next: AgentPlanRun): void {
    for (const observer of this.observers) {
      try {
        observer.runChanged(previous, next);
      } catch (error: unknown) {
        logCaughtError("AgentPlanRunObservers", error);
      }
    }
  }
}

declare global {
  var pagesAgentPlanRunObservers: AgentPlanRunObservers | undefined;
}

/**
 * Returns the observers shared by every repository of this process.
 *
 * @remarks
 * Run writes happen in several repositories that are built in different
 * places; one shared registry lets a service that is built later subscribe
 * without handing it to each of them.
 */
export function sharedAgentPlanRunObservers(): AgentPlanRunObservers {
  globalThis.pagesAgentPlanRunObservers ??= new AgentPlanRunObservers();

  return globalThis.pagesAgentPlanRunObservers;
}
