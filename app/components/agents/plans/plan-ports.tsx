import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { planInTargetClass } from "./plan-flow-ports";
import { PlanFlowHandle } from "./plan-flow-handle";

import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentParameter } from "@/definition/AgentParameters";
import type { PlanGraphActions } from "./use-plan-graph";

/**
 * Removes the binding of one data IN; a selected connection to it is no longer selected.
 *
 * @param graph - The editor actions of the plan.
 * @param node - The agent node or frame that owns the IN.
 * @param name - The parameter of the IN.
 */
export function disconnectPlanInput(
  graph: PlanGraphActions,
  node: AgentPlanStep | AgentPlanGroup,
  name: string,
): void {
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
    disconnectPlanInput(props.graph, props.node, name);
  }
  return (
    <>
      {props.parameters.map((parameter) => {
        const hasIssue = props.graph.issues.some(
          (issue) =>
            issue.nodeId === props.node.id && issue.port === parameter.name,
        );
        return (
          <div
            key={parameter.name}
            className="relative flex h-8 items-center gap-1"
          >
            <PlanFlowHandle
              id={`input:${parameter.name}`}
              type="target"
              kind="data"
              hasIssue={hasIssue}
            />
            <button
              type="button"
              data-plan-in={props.node.id}
              data-plan-parameter={parameter.name}
              className={cn(
                "nodrag nopan flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md border border-transparent px-1 text-left text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60",
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
                className="nodrag nopan rounded px-1 text-xs hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                disabled={!props.canEdit}
                aria-label={t("plans.disconnect", { name: parameter.name })}
                onClick={() => disconnect(parameter.name)}
              >
                ×
              </button>
            ) : null}
            {props.node.type === "group" ? (
              <BoundaryOutput
                group={props.node}
                name={parameter.name}
                graph={props.graph}
                canEdit={props.canEdit}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function BoundaryOutput(props: {
  readonly group: AgentPlanGroup;
  readonly name: string;
  readonly graph: PlanGraphActions;
  readonly canEdit: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const port = props.group.parameters.find(
    (entry) => entry.name === props.name,
  );
  if (!port) return null;
  return (
    <div className="absolute -right-10 flex h-7 w-7 items-center justify-center">
      <button
        type="button"
        className="nodrag nopan rounded text-plan-group focus-visible:ring-2 focus-visible:ring-ring"
        disabled={!props.canEdit}
        aria-label={t("plans.groups.portToMember", { name: port.name })}
        title={t("plans.groups.portToMember", { name: port.name })}
        onClick={() => props.graph.begin({ kind: "source", nodeId: port.id })}
      >
        →
      </button>
      <PlanFlowHandle
        id={`boundary:${port.id}`}
        type="source"
        kind="data"
        style={{ right: -8 }}
      />
    </div>
  );
}
