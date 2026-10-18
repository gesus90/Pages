/** A queued step yielded before dispatch; no provider work has started. */
export class AgentPlanPausedError extends Error {
  public constructor() {
    super("Plan dispatch paused");
    this.name = "AgentPlanPausedError";
  }
}
