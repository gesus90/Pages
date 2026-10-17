import { AgentError } from "@/backend/error/AgentErrors";

import type {
  AgentToolDiagnostic,
  AgentToolId,
  AgentToolStatus,
} from "@/definition/AgentTools";

/** Safe concrete refusal persisted in the plan's event journal and shown to administrators. */
export class AgentToolReadinessError extends AgentError {
  public readonly tool: AgentToolId | "workspace";
  public readonly status: AgentToolStatus;
  public readonly diagnostic: AgentToolDiagnostic;

  public constructor(
    tool: AgentToolId | "workspace",
    status: AgentToolStatus,
    diagnostic: AgentToolDiagnostic,
  ) {
    super("agent_tool_not_ready");
    this.name = "AgentToolReadinessError";
    this.tool = tool;
    this.status = status;
    this.diagnostic = diagnostic;
  }
}
