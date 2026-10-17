import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { planInTargetClass } from "./plan-flow-ports";

import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentParameter } from "@/definition/AgentParameters";
import type { PlanGraphActions } from "./use-plan-graph";

/** Every named data IN validates the source type; a dragged OUT ends on its row, and disconnecting is an explicit operation. */
export function PlanPorts(props: {
  readonly node: AgentPlanStep | AgentPlanGroup;
  readonly label: string;
  readonly parameters: readonly AgentParameter[];
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  function disconnect(name: string): void {
    const { graph, node } = props;
    graph.replaceNode({
      ...node,
      bindings: Object.fromEntries(
        Object.entries(node.bindings).filter(([key]) => key !== name),
      ),
    });
    const link = graph.selectedLink;
    if (link?.kind === "data" && link.to === node.id && link.parameter === name)
      graph.selectLink(null);
  }
  return (
    <>
      {props.parameters.map((parameter) => {
        const hasIssue = props.graph.issues.some(
          (issue) =>
            issue.nodeId === props.node.id && issue.port === parameter.name,
        );
        return (
          <div key={parameter.name} className="flex h-8 items-center gap-1">
            <button
              type="button"
              data-plan-in={props.node.id}
              data-plan-parameter={parameter.name}
              className={cn(
                "flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md border border-transparent px-1 text-left text-xs hover:underline disabled:opacity-60",
                hasIssue && "text-destructive",
                planInTargetClass(props.graph, props.node.id, parameter.name),
              )}
              aria-label={t("plans.bindPort", {
                parameter: parameter.name,
                name: props.label,
              })}
              disabled={!props.canEdit}
              onClick={() => props.graph.connect(props.node.id, parameter.name)}
            >
              <span
                className="size-2 shrink-0 rounded-sm border border-current"
                aria-hidden="true"
              />
              <span className="truncate">
                {t("plans.dataIn")} · {parameter.name} ({parameter.type})
                {parameter.isRequired ? " *" : ""}
              </span>
            </button>
            {props.node.bindings[parameter.name] ? (
              <button
                type="button"
                className="px-1 text-xs hover:underline"
                disabled={!props.canEdit}
                aria-label={t("plans.disconnect", { name: parameter.name })}
                onClick={() => disconnect(parameter.name)}
              >
                ×
              </button>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
