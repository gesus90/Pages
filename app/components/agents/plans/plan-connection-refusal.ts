import { PLAN_PORT } from "@/definition/AgentPlanBranching";

import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";

/**
 * The translation key of the sentence that tells why an IN refused a connection.
 *
 * @param issue - The finding that refused the connection.
 * @returns For a source of the wrong type at the condition, the event input or
 * a flow IN, the sentence about what that IN takes; for every other finding the
 * sentence of the finding itself.
 *
 * @remarks
 * The general sentence of a type mismatch names only the parameter IN of an
 * agent. A boolean result dropped on a flow IN, or a branch dropped on an event
 * input, needs to hear what that IN does take instead.
 */
export function planRefusalKey(issue: AgentPlanIssue): string {
  if (issue.reason === "type") {
    if (issue.port === PLAN_PORT.conditionIn)
      return "plans.validation.decisionCondition";
    if (issue.port === PLAN_PORT.eventIn) return "plans.validation.typeEvent";
    if (issue.port === PLAN_PORT.flowIn) return "plans.validation.typeFlow";
  }
  return `plans.validation.${issue.reason}`;
}
