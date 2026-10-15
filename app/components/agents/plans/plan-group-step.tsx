import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { planStepTemplate } from "@/definition/AgentPlanConfiguration";

import { PlanNodeConfigurationFields } from "./plan-node-configuration-fields";
import { PlanAgentAssignment } from "./plan-agent-assignment";
import { PlanNodeActions } from "./plan-node-actions";

import type { AgentPlanSources, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentParameter } from "@/definition/AgentParameters";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";

/** Edits one internal agent and its connections to named boundary ports. */
export function PlanGroupStep(props: {
  readonly step: AgentPlanStep;
  readonly group: AgentPlanGroup;
  readonly index: number;
  readonly sources: AgentPlanSources;
  readonly disabled: boolean;
  readonly onChange: (step: AgentPlanStep) => void;
  readonly onMove: (offset: number) => void;
  readonly onRemove: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { step, group } = props;
  const parameters =
    planStepTemplate(step, props.sources.agents)?.parameters ?? [];
  return (
    <li className="space-y-2 rounded-lg border border-border bg-surface p-2">
      <div className="flex items-center gap-2 text-sm">
        <span>
          {props.index + 1}. {step.configuration?.name ?? step.agentId}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={props.disabled || props.index === 0}
          onClick={() => props.onMove(-1)}
          aria-label={t("plans.groups.up")}
        >
          ↑
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={props.disabled || props.index === group.steps.length - 1}
          onClick={() => props.onMove(1)}
          aria-label={t("plans.groups.down")}
        >
          ↓
        </Button>
        <PlanNodeActions
          label={step.configuration?.name ?? step.agentId}
          disabled={props.disabled}
          onRemove={props.onRemove}
        />
      </div>
      <details>
        <summary className="cursor-pointer text-sm">
          {t("plans.editNode")}
        </summary>
        <fieldset disabled={props.disabled} className="space-y-3 pt-3">
          <PlanAgentAssignment
            step={step}
            sources={props.sources}
            disabled={props.disabled}
            onChange={props.onChange}
          />
          <PlanNodeConfigurationFields
            step={step}
            sources={props.sources}
            disabled={props.disabled}
            isGroupStep
            onChange={props.onChange}
          />
          <label className="block space-y-1 text-sm">
            <span>{t("plans.instruction")}</span>
            <Textarea
              value={step.instruction}
              maxLength={200000}
              onChange={(event) =>
                props.onChange({ ...step, instruction: event.target.value })
              }
            />
          </label>
          <GroupStepBindings
            step={step}
            group={group}
            parameters={parameters}
            onChange={props.onChange}
          />
        </fieldset>
      </details>
    </li>
  );
}

function GroupStepBindings(props: {
  readonly step: AgentPlanStep;
  readonly group: AgentPlanGroup;
  readonly parameters: readonly AgentParameter[];
  readonly onChange: (step: AgentPlanStep) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { step, group } = props;
  function bind(name: string, port: string): void {
    const bindings = Object.fromEntries(
      Object.entries(step.bindings).filter(([key]) => key !== name),
    );
    props.onChange({
      ...step,
      bindings: {
        ...bindings,
        ...(port ? { [name]: { kind: "source" as const, nodeId: port } } : {}),
      },
    });
  }
  return (
    <>
      {props.parameters.map((parameter) => {
        const binding = step.bindings[parameter.name];
        const selected = binding?.kind === "source" ? binding.nodeId : "";
        const options = group.parameters
          .filter((port) => port.type === parameter.type)
          .map((port) => ({
            value: port.id,
            label: `${port.name} (${port.type}) → ${parameter.name}`,
          }));
        if (selected && !options.some((option) => option.value === selected))
          options.push({ value: selected, label: selected });
        return (
          <Select
            key={parameter.name}
            ariaLabel={t("plans.bindingSource", { name: parameter.name })}
            value={selected}
            options={[
              {
                value: "",
                label: `${parameter.name} (${parameter.type}) · ${t("plans.useDefault")}`,
              },
              ...options,
            ]}
            onValueChange={(port) => bind(parameter.name, port)}
          />
        );
      })}
    </>
  );
}
