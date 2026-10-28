import { AgentError } from "./AgentErrors";

import type { AgentPlanWorkspaceConflict } from "@/definition/AgentPlanWorkspaceConflict";

/** A safe workspace refusal with the current plan's own affected nodes and targets. */
export class AgentPlanWorkspaceConflictError extends AgentError {
  public readonly conflict: AgentPlanWorkspaceConflict;

  public constructor(conflict: AgentPlanWorkspaceConflict) {
    super("plan_workspace_conflict");
    this.conflict = conflict;
  }
}
