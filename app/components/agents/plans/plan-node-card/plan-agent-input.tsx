import { Link2, Link2Off, X } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { placeholderNames } from "@/definition/AgentParameters";
import { planStepTemplate } from "@/definition/AgentPlanConfiguration";

import { usePlanFlowContext } from "../plan-flow-context";
import { PlanFlowHandle } from "../plan-flow-handle";
import { planInTargetClass } from "../plan-flow-ports";
import { PLAN_NODE_TEXT } from "../plan-node-text";
import { disconnectPlanInput } from "../plan-ports";
import { PlanPreviousMenu } from "./plan-previous-menu";
import { PlanValueInput } from "./plan-value-input";
import {
  isEmptyPlanValue,
  planBindingPreview,
  planValuePreview,
} from "./plan-value-preview";

import type { TFunction } from "i18next";
import type { AgentParameter } from "@/definition/AgentParameters";
import type { AgentPlanBinding, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";
import type { AgentParameterValue } from "@/definition/AgentParameters";
import type { PlanValueContext } from "./plan-value-preview";

interface PlanAgentInputProps {
  /** An agent, or a script with its declared text inputs. */
  readonly step: AgentPlanStep | AgentPlanScript;
  /** The node's name, which the controls of the row name. */
  readonly label: string;
  readonly parameter: AgentParameter;
}

function usePlanValueContext(): PlanValueContext {
  const { t } = useTranslation();
  const { draft, sources, workspaces = [] } = usePlanFlowContext();
  return { draft, sources, workspaces, translate: t };
}

/**
 * One input of an agent or a script: its violet data IN, its name and its value.
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
  const requiredId = useId();
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
          "nodrag nopan -ml-1.25 flex h-7 min-w-0 items-center rounded-md border border-transparent px-1 text-left font-medium hover:bg-surface/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default",
          PLAN_NODE_TEXT.field,
          hasIssue && "text-destructive",
          planInTargetClass(graph, step.id, parameter.name),
        )}
        aria-label={t("plans.bindPort", {
          parameter: parameter.name,
          name: props.label,
        })}
        aria-describedby={parameter.isRequired ? requiredId : undefined}
        title={parameter.description || parameter.name}
        disabled={!canEdit}
        onClick={() => graph.connect(step.id, parameter.name)}
      >
        <span className="truncate">{parameter.name}</span>
      </button>
      {parameter.isRequired ? (
        <span id={requiredId} className="sr-only">
          {t("plans.requiredValue")}
        </span>
      ) : null}
      {binding && binding.kind !== "literal" ? (
        <BoundValue {...props} binding={binding} />
      ) : (
        <ManualValue {...props} hasIssue={hasIssue} />
      )}
    </div>
  );
}

/**
 * How a bound input reads in its tooltip: a result names the placeholder of
 * `AGENT.md` it fills, or that `AGENT.md` does not use it; a script input
 * names its source.
 */
function boundTitle(
  props: PlanAgentInputProps & { readonly binding: AgentPlanBinding },
  input: {
    readonly preview: string;
    readonly isUnused: boolean;
    readonly translate: TFunction;
  },
): string {
  const { translate, preview } = input;
  const name = props.parameter.name;
  if (props.binding.kind !== "result" || props.step.type === "script")
    return translate("plans.boundValue", { parameter: name, source: preview });
  return translate(input.isUnused ? "plans.resultUnused" : "plans.resultUsed", {
    source: preview,
    placeholder: `{{${name}}}`,
  });
}

/**
 * A connected source, read only, distinct from a typed value.
 *
 * @remarks
 * A predecessor's result reaches the agent only where `AGENT.md` names the
 * input; a result bound to an input it does not name is marked unused.
 */
function BoundValue(
  props: PlanAgentInputProps & { readonly binding: AgentPlanBinding },
): React.ReactElement {
  const { t } = useTranslation();
  const { graph, canEdit, sources } = usePlanFlowContext();
  const preview = planBindingPreview(props.binding, usePlanValueContext());
  const name = props.parameter.name;
  const { step } = props;
  // A script receives every declared input; only AGENT.md can leave one unused.
  const markdown =
    step.type === "agent"
      ? (planStepTemplate(step, sources.agents)?.markdown ?? "")
      : null;
  const isUnused =
    props.binding.kind === "result" &&
    markdown !== null &&
    !placeholderNames(markdown).has(name);
  const Icon = isUnused ? Link2Off : Link2;
  return (
    <div
      className={cn(
        "flex h-8 min-w-0 items-center gap-1 rounded-lg border border-dashed border-plan-parameter/70 bg-plan-parameter-subtle pl-2 text-foreground",
        PLAN_NODE_TEXT.field,
        isUnused && "text-muted-foreground",
      )}
      title={boundTitle(props, { preview, isUnused, translate: t })}
    >
      <Icon
        className={cn(
          "size-3.5 shrink-0",
          isUnused ? "text-muted-foreground" : "text-plan-parameter",
        )}
        aria-hidden="true"
      />
      <span className="sr-only">{t("plans.boundTo")}</span>
      <span className="min-w-0 flex-1 truncate">{preview}</span>
      {isUnused ? (
        <span
          className={cn(
            "shrink-0 rounded-sm bg-surface/70 px-1 font-medium",
            PLAN_NODE_TEXT.meta,
          )}
        >
          {t("plans.resultUnusedShort")}
        </span>
      ) : null}
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
  const input = (
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
  if (parameter.type !== "text") return input;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <div className="min-w-0 flex-1">{input}</div>
      <PlanPreviousMenu
        step={step}
        parameter={parameter.name}
        label={props.label}
      />
    </div>
  );
}
