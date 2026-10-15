import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";

import { createPlanNode } from "./plan-node-factory";
import { PlanGroupParameters } from "./plan-group-parameters";
import { PlanGroupStep } from "./plan-group-step";

import type {
  AgentPlanInput,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { PlanGraphActions } from "./use-plan-graph";

/** The ordered subgraph remains inspectable within the selected outer group. */
export function PlanGroupEditor(props: {
  readonly group: AgentPlanGroup;
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly disabled: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const [agentId, setAgentId] = useState("");
  const { group } = props;
  function replace(step: AgentPlanStep): void {
    props.graph.replaceNode({
      ...group,
      steps: group.steps.map((entry) => (entry.id === step.id ? step : entry)),
    });
  }
  function move(index: number, offset: number): void {
    const steps = [...group.steps];
    const first = steps[index];
    const second = steps[index + offset];
    if (!first || !second) return;
    steps[index] = second;
    steps[index + offset] = first;
    props.graph.replaceNode({ ...group, steps });
  }
  function add(): void {
    const step = createPlanNode({
      draft: props.draft,
      sources: props.sources,
      kind: "agent",
      reference: agentId,
    });
    if (step?.type === "agent")
      props.graph.replaceNode({ ...group, steps: [...group.steps, step] });
  }
  return (
    <fieldset disabled={props.disabled} className="space-y-3">
      <label className="block space-y-1 text-sm">
        <span>{t("plans.groups.name")}</span>
        <Input
          value={group.name}
          maxLength={120}
          onChange={(event) =>
            props.graph.replaceNode({ ...group, name: event.target.value })
          }
        />
      </label>
      <p className="text-sm text-muted-foreground">{t("plans.groups.hint")}</p>
      <p className="text-sm">
        {t("plans.flowIn")} →{" "}
        {group.steps
          .map(
            (step, index) =>
              `${index + 1}. ${step.configuration?.name ?? step.agentId}`,
          )
          .join(" → ")}{" "}
        → {t("plans.flowOut")}
      </p>
      <PlanGroupParameters
        group={group}
        draft={props.draft}
        sources={props.sources}
        disabled={props.disabled}
        onChange={props.graph.replaceNode}
      />
      <ol className="space-y-2" aria-label={t("plans.groups.order")}>
        {group.steps.map((step, index) => (
          <PlanGroupStep
            key={step.id}
            step={step}
            index={index}
            group={group}
            sources={props.sources}
            disabled={props.disabled}
            onChange={replace}
            onMove={(offset) => move(index, offset)}
            onRemove={() =>
              props.graph.replaceNode({
                ...group,
                steps: group.steps.filter((entry) => entry.id !== step.id),
              })
            }
          />
        ))}
      </ol>
      <GroupAgentPicker
        sources={props.sources}
        agentId={agentId}
        onChange={setAgentId}
        disabled={props.disabled}
        onAdd={add}
      />
    </fieldset>
  );
}

function GroupAgentPicker(props: {
  readonly sources: AgentPlanSources;
  readonly agentId: string;
  readonly onChange: (id: string) => void;
  readonly disabled: boolean;
  readonly onAdd: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <Select
        ariaLabel={t("plans.groups.addAgent")}
        value={props.agentId}
        onValueChange={props.onChange}
        options={[
          { value: "", label: t("plans.groups.addAgent") },
          ...props.sources.agents
            .filter(
              (agent) =>
                agent.provider === "codex_cli" && agent.availability.isUsable,
            )
            .map((agent) => ({
              value: agent.id,
              label: `${agent.name} · ${agent.model}`,
            })),
        ]}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={props.disabled || !props.agentId}
        onClick={props.onAdd}
      >
        {t("plans.groups.addAgent")}
      </Button>
    </>
  );
}
