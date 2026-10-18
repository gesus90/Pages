import { Link2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanFlowHandle } from "../plan-flow-handle";
import { planInTargetClass } from "../plan-flow-ports";
import { disconnectPlanInput } from "../plan-ports";
import { PlanValueInput } from "./plan-value-input";
import {
  isEmptyPlanValue,
  planBindingPreview,
  planValuePreview,
} from "./plan-value-preview";

import type { AgentParameter } from "@/definition/AgentParameters";
import type { AgentPlanBinding, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentParameterValue } from "@/definition/AgentParameters";
import type { PlanValueContext } from "./plan-value-preview";

interface PlanAgentInputProps {
  readonly step: AgentPlanStep;
  /** The agent's name, which the controls of the row name. */
  readonly label: string;
  readonly parameter: AgentParameter;
}

function usePlanValueContext(): PlanValueContext {
  const { t } = useTranslation();
  const { draft, sources, workspaces = [] } = usePlanFlowContext();
  return { draft, sources, workspaces, translate: t };
}

/**
 * One input of an agent: its violet data IN, its name and its value.
 *
 * @remarks
 * An input holds one binding. A connection shows its source read only and
 * is released with the X; without one, the field takes a manual value,
 * and emptying it restores the agent's default. A connection is refused
 * while a manual value is set, as before.
 */
export function PlanAgentInput(props: PlanAgentInputProps): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const { step, parameter } = props;
  const binding = step.bindings[parameter.name];
  const hasIssue = graph.issues.some(
    (issue) => issue.nodeId === step.id && issue.port === parameter.name,
  );
  return (
    <div className="relative grid h-8 grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-center gap-2">
      <PlanFlowHandle
        id={`input:${parameter.name}`}
        type="target"
        kind="data"
        hasIssue={hasIssue}
      />
      <button
        type="button"
        data-plan-in={step.id}
        data-plan-parameter={parameter.name}
        className={cn(
          "nodrag nopan flex h-7 min-w-0 items-center rounded-md border border-transparent px-1 text-left text-xs font-medium hover:bg-surface/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default",
          hasIssue && "text-destructive",
          planInTargetClass(graph, step.id, parameter.name),
        )}
        aria-label={t("plans.bindPort", {
          parameter: parameter.name,
          name: props.label,
        })}
        title={parameter.description || parameter.name}
        disabled={!canEdit}
        onClick={() => graph.connect(step.id, parameter.name)}
      >
        <span className="truncate">{parameter.name}</span>
        {parameter.isRequired ? (
          <span aria-hidden="true" className="shrink-0 pl-0.5">
            *
          </span>
        ) : null}
      </button>
      {binding && binding.kind !== "literal" ? (
        <BoundValue {...props} binding={binding} />
      ) : (
        <ManualValue {...props} hasIssue={hasIssue} />
      )}
    </div>
  );
}

/** A connected source, read only, distinct from a typed value. */
function BoundValue(
  props: PlanAgentInputProps & { readonly binding: AgentPlanBinding },
): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const preview = planBindingPreview(props.binding, usePlanValueContext());
  const name = props.parameter.name;
  return (
    <div
      className="flex h-8 min-w-0 items-center gap-1 rounded-lg border border-dashed border-plan-parameter/70 bg-plan-parameter-subtle pl-2 text-xs text-foreground"
      title={t("plans.boundValue", { parameter: name, source: preview })}
    >
      <Link2
        className="size-3.5 shrink-0 text-plan-parameter"
        aria-hidden="true"
      />
      <span className="sr-only">{t("plans.boundTo")}</span>
      <span className="min-w-0 flex-1 truncate">{preview}</span>
      <button
        type="button"
        className="nodrag nopan flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
        disabled={!canEdit}
        aria-label={t("plans.disconnect", { name })}
        title={t("plans.disconnect", { name })}
        onClick={() => disconnectPlanInput(graph, props.step, name)}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

/** A typed manual value, stored as the input's literal binding. */
function ManualValue(
  props: PlanAgentInputProps & { readonly hasIssue: boolean },
): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit } = usePlanFlowContext();
  const context = usePlanValueContext();
  const { step, parameter } = props;
  const binding = step.bindings[parameter.name];
  const value = binding?.kind === "literal" ? binding.value : null;
  const fallback = planValuePreview(parameter.defaultValue, context);
  function change(next: AgentParameterValue): void {
    if (isEmptyPlanValue(next)) {
      disconnectPlanInput(graph, step, parameter.name);
      return;
    }
    graph.replaceNode({
      ...step,
      bindings: {
        ...step.bindings,
        [parameter.name]: { kind: "literal", value: next },
      },
    });
  }
  return (
    <PlanValueInput
      type={parameter.type}
      value={value}
      label={t("plans.inputValue", {
        parameter: parameter.name,
        name: props.label,
      })}
      placeholder={
        fallback
          ? t("plans.defaultValue", { value: fallback })
          : t("plans.noValue")
      }
      isEmptyAllowed
      hasIssue={props.hasIssue}
      disabled={!canEdit}
      onChange={change}
    />
  );
}
