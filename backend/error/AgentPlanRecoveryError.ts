import type { AgentPlanRecoveryErrorCode } from "@/definition/AgentPlanRecovery";
import type { AgentPlanCleanupFailure } from "@/definition/AgentPlanCleanupResource";

/** Fixed recovery failures never disclose native provider or private snapshot text. */
export class AgentPlanRecoveryError extends Error {
  public readonly code: AgentPlanRecoveryErrorCode;
  public readonly cleanupFailure: AgentPlanCleanupFailure | undefined;

  public constructor(
    code: AgentPlanRecoveryErrorCode,
    cleanupFailure?: AgentPlanCleanupFailure,
  ) {
    super(`Agent plan recovery: ${code}`);
    this.name = "AgentPlanRecoveryError";
    this.code = code;
    this.cleanupFailure = cleanupFailure;
  }
}
