import type { AgentPlanRecoveryResult } from "@/definition/AgentPlanRecovery";

/** Rolls back a losing admission transaction before returning an earlier linked run. */
export class AgentPlanRecoveryReplayed extends Error {
  public readonly result: AgentPlanRecoveryResult;

  public constructor(result: AgentPlanRecoveryResult) {
    super("Recovery request already answered");
    this.result = result;
  }
}
