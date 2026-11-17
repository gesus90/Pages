import { AgentError } from "./AgentErrors";

/** Admission found an existing run while holding the plan row lock. */
export class AgentPlanActiveRunError extends AgentError {
  public readonly runId: string;

  public constructor(runId: string) {
    super("plan_run_unavailable");
    this.runId = runId;
  }
}
