import { AgentError } from "./AgentErrors";

/** A call has to wait: the runs that hold its target plan or a resource it needs are named for the wait check. */
export class AgentPlanCallBlockedError extends AgentError {
  public readonly ownerRunIds: readonly string[];

  public constructor(ownerRunIds: readonly string[]) {
    super("plan_jump_start_blocked");
    this.name = "AgentPlanCallBlockedError";
    this.ownerRunIds = ownerRunIds;
  }
}
