import { AgentError } from "./AgentErrors";

import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";

function refusalCode(
  issues: readonly AgentPlanIssue[],
):
  | "plan_start_end_disconnected"
  | "plan_manual_start_unavailable"
  | "plan_jump_cycle"
  | "plan_invalid" {
  if (issues.some((issue) => issue.reason === "startEndDisconnected"))
    return "plan_start_end_disconnected";
  if (issues.some((issue) => issue.reason === "jumpCycle"))
    return "plan_jump_cycle";
  return issues.some((issue) => issue.reason === "manualStart")
    ? "plan_manual_start_unavailable"
    : "plan_invalid";
}

/** Safe node and port diagnostics, with no resource contents or provider messages. */
export class AgentPlanValidationError extends AgentError {
  public readonly issues: readonly AgentPlanIssue[];

  public constructor(issues: readonly AgentPlanIssue[]) {
    super(refusalCode(issues));
    this.issues = issues;
  }
}
