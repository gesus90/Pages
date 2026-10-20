import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import {
  planGroupAdapter,
  planGroupRefusal,
} from "@/definition/AgentPlanGroup";

import { PlanGroupAdapterBadge } from "./plan-group-adapter";
import { PlanGroupLegacy } from "./plan-group-legacy";
import { planAgentName, planMemberOrigin } from "./plan-layout";
import { PlanNodeActions } from "./plan-node-actions";
import { PanelField, PanelNote } from "./plan-panel-controls";

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
 * The settings of a selected session container and its retained legacy contracts.
 *
 * @remarks
 * Membership is listed in stored order; only explicit edges determine the
 * schedule. Members are configured by selecting them like any other agent
 * node, and ambiguous legacy connections require an explicit choice. A group
 * has no runs and no end condition; the note at the end says so.
 */
export function PlanGroupEditor(props: GroupEditorProps): React.ReactElement {
  const { t } = useTranslation();
  const { group } = props;
  const nameId = useId();
  return (
    <fieldset disabled={props.disabled} className="flex flex-col gap-4">
      <PanelField id={nameId} label={t("plans.groups.panel.name")}>
        <Input
          id={nameId}
          size="sm"
          value={group.name}
          maxLength={120}
          onChange={(event) =>
            props.graph.replaceNode({ ...group, name: event.target.value })
          }
          className="h-8 bg-muted/50"
        />
      </PanelField>
      <GroupClass group={group} sources={props.sources} />
      <PlanGroupLegacy
        group={group}
        draft={props.draft}
        sources={props.sources}
        disabled={props.disabled}
        graph={props.graph}
      />
      <GroupMembers {...props} />
      <GroupAgentPicker {...props} />
      <PanelNote>{t("plans.groups.panel.note")}</PanelNote>
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
    <div className="flex flex-col items-start gap-1.5">
      <span className="text-xs font-semibold">
        {t("plans.groups.adapterLabel")}
      </span>
      <PlanGroupAdapterBadge
        adapter={planGroupAdapter(props.group, props.sources.agents)}
      />
      <p className="text-xs text-muted-foreground">
        {t("plans.groups.panel.classHint")}
      </p>
    </div>
  );
}

/** Membership is shown in stored order; only the full agent graph determines dependencies. */
function GroupMembers(props: GroupEditorProps): React.ReactElement {
  const { t } = useTranslation();
  const { group, graph } = props;
  function label(step: AgentPlanStep): string {
    return planAgentName(step, props.sources) || t("plans.missingAgent");
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold">
        {t("plans.groups.panel.members")}
      </span>
      <ol
        className="flex flex-col gap-1.5"
        aria-label={t("plans.groups.order")}
      >
        {group.steps.map((step) => (
          <li
            key={step.id}
            className="flex items-center gap-1 rounded-lg border border-border bg-muted/50 py-1 pr-1 pl-3 text-sm"
          >
            <span className="min-w-0 flex-1 truncate">{label(step)}</span>
            <Button
              size="xs"
              variant="ghost"
              className="h-7 min-h-7 px-1.5 text-[11px] font-normal text-muted-foreground"
              onClick={() => graph.select(step.id)}
            >
              {t("plans.groups.selectMember")}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              className="h-7 min-h-7 px-1.5 text-[11px] font-normal text-muted-foreground"
              aria-label={t("plans.groups.takeOut")}
              onClick={() => graph.assign(step.id, null)}
            >
              {t("plans.groups.panel.takeOut")}
            </Button>
            <PlanNodeActions
              label={label(step)}
              disabled={props.disabled}
              onRemove={() => graph.remove(step.id)}
            />
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">
        {t(
          group.steps.length === 0
            ? "plans.groups.empty"
            : "plans.groups.orderOpen",
        )}
      </p>
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
    <div className="flex flex-col items-start gap-1.5">
      <span className="text-xs font-semibold">
        {t("plans.groups.panel.addLabel")}
      </span>
      <Select
        className="h-8 w-full"
        ariaLabel={t("plans.groups.addAgent")}
        value={agentId}
        onValueChange={setAgentId}
        options={[
          { value: "", label: t("plans.groups.panel.addPlaceholder") },
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
