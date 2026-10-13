import { AgentError } from "./AgentErrors";

import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";

/** Safe node and port diagnostics, with no resource contents or provider messages. */
export class AgentPlanValidationError extends AgentError {
  public readonly issues: readonly AgentPlanIssue[];

  public constructor(issues: readonly AgentPlanIssue[]) {
    super("plan_invalid");
    this.issues = issues;
  }
}
