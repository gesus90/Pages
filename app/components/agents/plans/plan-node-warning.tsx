import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { planIssueCause } from "./plan-panel-issues";

import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";

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
