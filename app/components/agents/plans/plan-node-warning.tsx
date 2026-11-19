import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { isAgentParameterName } from "@/definition/AgentParameters";

import type { TFunction } from "i18next";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";

function issuePort(issue: AgentPlanIssue): string {
  return issue.port && isAgentParameterName(issue.port) ? issue.port : "";
}

function planIssueCause(issue: AgentPlanIssue, translate: TFunction): string {
  const port = issuePort(issue);
  const keys = [`plans.validation.${issue.reason}`];
  if (issue.nodeId !== null)
    keys.unshift(`plans.panel.issueCause.${issue.reason}`);
  if (issue.nodeId !== null && port && issue.reason === "required")
    keys.unshift("plans.panel.issueCause.requiredPort");
  const cause = translate(keys, { port });
  return issue.asset
    ? `${cause} · ${translate("plans.remoteAccess.assetFailure", { ...issue.asset, cause: translate(`settings.agents.error.${issue.asset.cause}`) })}`
    : cause;
}

/** A quiet, keyboard-readable warning whose tooltip names each affected field. */
export function PlanNodeWarning(props: {
  readonly nodeId: string;
  readonly issues: readonly AgentPlanIssue[];
}): React.ReactElement | null {
  const { t } = useTranslation();
  const issues = props.issues.filter((issue) => issue.nodeId === props.nodeId);
  if (issues.length === 0) return null;
  const description = issues
    .map(
      (issue) =>
        `${issue.port ? `${issue.port}: ` : ""}${planIssueCause(issue, t)}`,
    )
    .join("\n");
  return (
    <span
      tabIndex={0}
      role="img"
      aria-label={description}
      title={description}
      className="shrink-0 text-muted-foreground"
    >
      <TriangleAlert className="size-3.5" aria-hidden="true" />
    </span>
  );
}
