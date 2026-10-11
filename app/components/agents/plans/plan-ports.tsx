import { useTranslation } from "react-i18next";

import type { AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentParameter } from "@/definition/AgentParameters";
import type { PlanGraphActions } from "./use-plan-graph";

/** Accepts task/variable drops directly on a compatible input port, as well as button connections. */
export function PlanPorts(props: {
  readonly node: AgentPlanStep;
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
    event.preventDefault();
    event.stopPropagation();
    if (!props.canEdit) return;
    const [kind, reference] = event.dataTransfer
      .getData("application/x-pages-plan")
      .split(":");
    if (!reference) return;
    let id: string | null = null;
    if (kind === "node") id = reference;
    if (kind === "task" || kind === "variable")
      id = props.graph.add(kind, reference, {
        x: Math.max(0, props.node.x - 320),
        y: props.node.y + 240,
      });
    if (id) props.graph.bindSource(id, props.node.id, parameter);
  }
  return (
    <>
      {props.parameters.map((parameter) => (
        <button
          type="button"
          key={parameter.name}
          className="flex h-8 w-full items-center gap-2 text-left text-xs hover:underline disabled:opacity-60"
          aria-label={t("plans.bindPort", {
            parameter: parameter.name,
            name: props.label,
          })}
          disabled={!props.canEdit || parameter.type !== "text"}
          onDragOver={(event) => {
            if (props.canEdit && parameter.type === "text")
              event.preventDefault();
          }}
          onDrop={(event) => {
            if (parameter.type === "text") drop(event, parameter.name);
          }}
          onClick={() => {
            if (props.canEdit && parameter.type === "text")
              props.graph.connect(props.node.id, parameter.name);
          }}
        >
          <span
            className="size-2 shrink-0 rounded-sm border border-current"
            aria-hidden="true"
          />
          {parameter.name} ({parameter.type})
        </button>
      ))}
    </>
  );
}
