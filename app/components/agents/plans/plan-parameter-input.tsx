import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { planSourceType } from "@/definition/AgentPlanGraph";

import { planNodeLabel } from "./plan-layout";

import type {
  AgentPlanInput,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type {
  AgentParameter,
  AgentParameterValue,
} from "@/definition/AgentParameters";
import type { PlanGraphActions } from "./use-plan-graph";

/** A named input selects one compatible source; legacy literals can become explicit value nodes. */
export function PlanParameterInput(props: {
  readonly parameter: AgentParameter;
  readonly step: AgentPlanStep;
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly disabled: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { parameter, step, graph } = props;
  const binding = step.bindings[parameter.name];
  const literal =
    binding?.kind === "literal" ? binding.value : parameter.defaultValue;
  let selected = "";
  if (binding?.kind === "source") selected = binding.nodeId;
  if (binding?.kind === "result") selected = binding.stepId;
  const options = props.draft.nodes
    .filter((node) => planSourceType(node) === parameter.type)
    .map((node) => ({
      value: node.id,
      label: planNodeLabel(node, props.sources),
    }));
  if (selected && !options.some((option) => option.value === selected)) {
    const source = props.draft.nodes.find((node) => node.id === selected);
    options.push({
      value: selected,
      label: source ? planNodeLabel(source, props.sources) : selected,
    });
  }
  function disconnect(): void {
    graph.replaceStep({
      ...step,
      bindings: Object.fromEntries(
        Object.entries(step.bindings).filter(
          ([name]) => name !== parameter.name,
        ),
      ),
    });
  }
  function createValue(): void {
    const value = literal ?? emptyPortValue(parameter, props.draft.workspaceId);
    graph.insertValue(step, parameter.name, value);
  }
  return (
    <fieldset
      disabled={props.disabled}
      className="space-y-2 rounded-lg border border-border p-2"
    >
      <legend className="px-1 text-xs">
        {t("plans.dataIn")} · {parameter.name} ({parameter.type})
        {parameter.isRequired ? " *" : ""}
      </legend>
      <p className="text-xs text-muted-foreground">{parameter.description}</p>
      <Select
        value={selected}
        ariaLabel={t("plans.bindingSource", { name: parameter.name })}
        disabled={props.disabled || Boolean(binding)}
        options={[{ value: "", label: t("plans.useDefault") }, ...options]}
        onValueChange={(source) =>
          graph.bindSource(source, step.id, parameter.name)
        }
      />
      {binding ? (
        <Button size="sm" variant="ghost" onClick={disconnect}>
          {t("plans.resetBinding")}
        </Button>
      ) : null}
      {!binding || binding.kind === "literal" ? (
        <Button size="sm" variant="outline" onClick={createValue}>
          {t("plans.createPortValue")}
        </Button>
      ) : null}
    </fieldset>
  );
}

function emptyPortValue(
  parameter: AgentParameter,
  workspaceId: string,
): AgentParameterValue {
  if (parameter.type === "workspace") return { type: "workspace", workspaceId };
  if (parameter.type === "wiki") return { type: "wiki", pageId: "" };
  if (parameter.type === "number") return { type: "number", number: 0 };
  if (parameter.type === "ticket") return { type: "ticket", ticketId: "" };
  return { type: "text", text: "" };
}
