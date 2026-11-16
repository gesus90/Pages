import { isAgentParameterName } from "@/definition/AgentParameters";

import type { TFunction } from "i18next";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";

function issuePort(issue: AgentPlanIssue): string {
  return issue.port && isAgentParameterName(issue.port) ? issue.port : "";
}

/** Explains a stable finding and names a missing input in the user's language. */
export function planIssueCause(
  issue: AgentPlanIssue,
  translate: TFunction,
): string {
  const port = issuePort(issue);
  const keys = [`plans.validation.${issue.reason}`];
  // A node-bound finding gets the sentence about that node, not the plan-wide one.
  if (issue.nodeId !== null)
    keys.unshift(`plans.panel.issueCause.${issue.reason}`);
  if (issue.nodeId !== null && port && issue.reason === "required")
    keys.unshift("plans.panel.issueCause.requiredPort");
  const cause = translate(keys, { port });
  return issue.asset
    ? `${cause} · ${translate("plans.remoteAccess.assetFailure", { ...issue.asset, cause: translate(`settings.agents.error.${issue.asset.cause}`) })}`
    : cause;
}
