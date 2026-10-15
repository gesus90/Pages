import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentParameter } from "@/definition/AgentParameters";
import type { PlanGraphActions } from "./use-plan-graph";

/** Every named data IN validates the source type; disconnecting is an explicit operation. */
export function PlanPorts(props: {
  readonly node: AgentPlanStep | AgentPlanGroup;
  readonly label: string;
  readonly parameters: readonly AgentParameter[];
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  function drop(
    event: React.DragEvent<HTMLButtonElement>,
    parameter: string,
  ): void {
    const [kind, reference] = event.dataTransfer
      .getData("application/x-pages-plan")
      .split(":");
    if (kind !== "node" || !reference || !props.canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    props.graph.bindSource(reference, props.node.id, parameter);
  }
  function disconnect(name: string): void {
    props.graph.replaceNode({
      ...props.node,
      bindings: Object.fromEntries(
        Object.entries(props.node.bindings).filter(([key]) => key !== name),
      ),
    });
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
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1 text-left text-xs hover:underline disabled:opacity-60",
                hasIssue && "text-destructive",
              )}
              aria-label={t("plans.bindPort", {
                parameter: parameter.name,
                name: props.label,
              })}
              disabled={!props.canEdit}
              onDragOver={(event) => {
                if (props.canEdit) event.preventDefault();
              }}
              onDrop={(event) => drop(event, parameter.name)}
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
