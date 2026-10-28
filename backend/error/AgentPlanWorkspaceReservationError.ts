import { AgentError } from "./AgentErrors";

/** The requested workspace was already reserved in the start transaction. */
export class AgentPlanWorkspaceReservationError extends AgentError {
  public readonly workspaceId: string;

  public constructor(workspaceId: string) {
    super("plan_workspace_conflict");
    this.workspaceId = workspaceId;
  }
}
