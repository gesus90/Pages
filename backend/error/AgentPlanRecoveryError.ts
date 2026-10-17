import type { AgentPlanRecoveryErrorCode } from "@/definition/AgentPlanRecovery";

/** Fixed recovery failures never disclose native provider or private snapshot text. */
export class AgentPlanRecoveryError extends Error {
  public readonly code: AgentPlanRecoveryErrorCode;

  public constructor(code: AgentPlanRecoveryErrorCode) {
    super(`Agent plan recovery: ${code}`);
    this.name = "AgentPlanRecoveryError";
    this.code = code;
  }
}
