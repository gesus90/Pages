import { useTranslation } from "react-i18next";

import { planNodeLabel } from "./plan-layout";

import type { AgentPlanInput, AgentPlanSources } from "@/definition/AgentPlan";
import type { AgentPlanIssue } from "@/definition/AgentPlanGraph";

/** Local and server diagnostics identify the exact node and port without exposing hidden resources. */
export function PlanValidation(props: {
  readonly issues: readonly AgentPlanIssue[];
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly onSelect: (id: string | null) => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (props.issues.length === 0) return null;
  return (
    <details
      className="rounded-lg border border-destructive/40 p-2 text-sm"
      open
    >
      <summary className="cursor-pointer font-medium text-destructive">
        {t("plans.validationTitle", { count: props.issues.length })}
      </summary>
      <ul
        className="max-h-36 overflow-y-auto text-destructive"
        aria-live="polite"
      >
        {props.issues.map((issue, index) => {
          const node = props.draft.nodes.find(
            (entry) => entry.id === issue.nodeId,
          );
          return (
            <li key={`${issue.nodeId}:${issue.port}:${issue.reason}:${index}`}>
              <button
                type="button"
                className="text-left hover:underline"
                onClick={() => props.onSelect(issue.nodeId)}
              >
                {node ? `${planNodeLabel(node, props.sources)} · ` : ""}
                {issue.port ? `${issue.port}: ` : ""}
                {t(`plans.validation.${issue.reason}`)}
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
