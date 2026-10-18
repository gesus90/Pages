import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import {
  planGroupAdapter,
  planGroupOrder,
  planGroupRefusal,
} from "@/definition/AgentPlanGroup";

import { PlanGroupAdapterBadge } from "./plan-group-adapter";
import { PlanGroupParameters } from "./plan-group-parameters";
import { planAgentName, planMemberOrigin } from "./plan-layout";
import { PlanNodeActions } from "./plan-node-actions";

import type {
  AgentPlanInput,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { PlanGraphActions } from "./use-plan-graph";

interface GroupEditorProps {
  readonly group: AgentPlanGroup;
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly graph: PlanGraphActions;
  readonly disabled: boolean;
}

/**
 * The settings of a selected group: name, ACP class, order, ports and members.
 *
 * @remarks
 * The order follows the flow edges between the members on the grid; this
 * view only reads it. Members are configured by selecting them like any
 * other agent node.
 */
export function PlanGroupEditor(props: GroupEditorProps): React.ReactElement {
  const { t } = useTranslation();
  const { group } = props;
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
      <GroupClass group={group} sources={props.sources} />
      <PlanGroupParameters
        group={group}
        draft={props.draft}
        sources={props.sources}
        disabled={props.disabled}
        onChange={props.graph.replaceNode}
      />
      <GroupMembers {...props} />
      <GroupAgentPicker {...props} />
    </fieldset>
  );
}

/** The ACP class of the group and how members decide it. */
function GroupClass(props: {
  readonly group: AgentPlanGroup;
  readonly sources: AgentPlanSources;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        {t("plans.groups.adapterLabel")}
        <PlanGroupAdapterBadge
          adapter={planGroupAdapter(props.group, props.sources.agents)}
        />
      </p>
      <p className="text-sm text-muted-foreground">{t("plans.groups.hint")}</p>
    </>
  );
}

/** Members in execution order, or in joining order while the edges leave the order open. */
function GroupMembers(props: GroupEditorProps): React.ReactElement {
  const { t } = useTranslation();
  const { group, graph } = props;
  const order = planGroupOrder(group);
  const members = order ?? group.steps;
  function label(step: AgentPlanStep): string {
    return planAgentName(step, props.sources) || t("plans.missingAgent");
  }
  let summary = t("plans.groups.orderOpen");
  if (group.steps.length === 0) summary = t("plans.groups.empty");
  if (order && order.length > 0)
    summary = t("plans.groups.orderValue", {
      order: order.map(label).join(" → "),
    });
  return (
    <div className="space-y-2">
      <p className="text-sm">{summary}</p>
      <ol className="space-y-1" aria-label={t("plans.groups.order")}>
        {members.map((step, index) => (
          <li
            key={step.id}
            className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1 pl-2 text-sm"
          >
            <span className="min-w-0 flex-1 truncate">
              {order ? `${index + 1}. ` : ""}
              {label(step)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => graph.select(step.id)}
            >
              {t("plans.groups.selectMember")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => graph.assign(step.id, null)}
            >
              {t("plans.groups.takeOut")}
            </Button>
            <PlanNodeActions
              label={label(step)}
              disabled={props.disabled}
              onRemove={() => graph.remove(step.id)}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Offers only usable agents that may join: ACP agents of the group's class, or of any class while it is neutral.
 *
 * @remarks
 * A template that cannot be loaded adds nothing and is named here, where the agent was chosen.
 */
function GroupAgentPicker(props: GroupEditorProps): React.ReactElement {
  const { t } = useTranslation();
  const [agentId, setAgentId] = useState("");
  const { group } = props;
  function add(): void {
    const origin = planMemberOrigin(group);
    const right = Math.max(0, ...group.steps.map((step) => step.x + 320));
    props.graph.add(
      "agent",
      agentId,
      { x: origin.x + right, y: origin.y },
      group.id,
    );
    setAgentId("");
  }
  return (
    <div className="space-y-2">
      <Select
        ariaLabel={t("plans.groups.addAgent")}
        value={agentId}
        onValueChange={setAgentId}
        options={[
          { value: "", label: t("plans.groups.addAgent") },
          ...props.sources.agents
            .filter(
              (agent) =>
                agent.availability.isUsable &&
                planGroupRefusal(
                  group,
                  candidateStep(agent.id),
                  props.sources.agents,
                ) === null,
            )
            .map((agent) => ({
              value: agent.id,
              label: `${agent.name} · ${t(`plans.session.runner.${agent.provider ?? "api"}`)} · ${agent.model}`,
            })),
        ]}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={props.disabled || !agentId}
        onClick={add}
      >
        {t("plans.groups.addAgent")}
      </Button>
      {props.graph.insertionError ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`settings.agents.error.${props.graph.insertionError}`)}
        </p>
      ) : null}
    </div>
  );
}

/** A stand-in node that names only the agent, for asking whether it may join. */
function candidateStep(agentId: string): AgentPlanStep {
  return {
    id: "",
    type: "agent",
    agentId,
    personalAgentId: null,
    instruction: "",
    bindings: {},
    x: 0,
    y: 0,
  };
}
