import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { logCaughtError } from "@/backend/logging/Logger";
import { detectPlanRunTransitions } from "@/backend/service/agents/AgentPlanRunTransitions";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanSwarmMemoryRepository } from "@/backend/database/repositories/agent/AgentPlanSwarmMemoryRepository";
import type { AgentPlanRunObserver } from "../AgentPlanRunObservers";

/** The endings after which no resume follows, so a memory that is not kept goes. */
const FINAL_ENDINGS: readonly string[] = ["succeeded", "cancelled"];

/**
 * Deletes the shared memory of swarm nodes that should not outlive their run.
 * @remarks
 * Only a run that ended for good, as succeeded or cancelled, loses the memory
 * of its nodes whose setting does not keep it. A failed run or one with an
 * open closeout can still be resumed, so its memory stays for the resume.
 * Deleting the run deletes every memory row anyway.
 */
export class SwarmMemoryRunEnd implements AgentPlanRunObserver {
  private readonly memories: Pick<
    AgentPlanSwarmMemoryRepository,
    "discardUnkept"
  >;

  public constructor(
    memories: Pick<AgentPlanSwarmMemoryRepository, "discardUnkept">,
  ) {
    this.memories = memories;
  }

  /** Queues the deletion when a write ends the run as succeeded or cancelled. */
  public runChanged(previous: AgentPlanRun, next: AgentPlanRun): void {
    const isFinal = detectPlanRunTransitions(previous, next).some(
      (transition) =>
        transition.kind === "run_ended" &&
        FINAL_ENDINGS.includes(transition.ending),
    );
    if (!isFinal) return;
    void withBackgroundDatabaseWork("swarm_memory_run_end", () =>
      this.memories.discardUnkept(next.id),
    ).catch((error: unknown) => {
      logCaughtError("SwarmMemoryRunEnd", error);
    });
  }
}
