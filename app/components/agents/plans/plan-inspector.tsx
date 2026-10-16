import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { planStepTemplate } from "@/definition/AgentPlanConfiguration";
import { findPlanStep } from "@/definition/AgentPlanGroupEdit";
import { Textarea } from "@/app/components/ui/textarea";

import { PlanNodeConfigurationFields } from "./plan-node-configuration-fields";
import { PlanGroupEditor } from "./plan-group-editor";
import { PlanGroupMembership } from "./plan-group-membership";
import {
  PlanGroupSessionValue,
  planRunGroupSession,
} from "./plan-group-session";
import { PlanValueFields } from "./plan-value-fields";
import { PlanParameterInput } from "./plan-parameter-input";
import { PlanAgentAssignment } from "./plan-agent-assignment";
import { planNodeLabel } from "./plan-layout";
import { PlanNodeActions } from "./plan-node-actions";

import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanRun,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { PlanGraphActions } from "./use-plan-graph";

interface InspectorProps {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly workspaces: readonly AgentWorkspaceChoice[];
  readonly graph: PlanGraphActions;
  readonly disabled: boolean;
  /** The selected run, whose group session a member inherits. */
  readonly run?: AgentPlanRun | null;
}

/** The selected node, also an agent inside a frame, and the frame around it. */
export function selectedPlanNode(
  draft: AgentPlanInput,
  id: string | null,
): {
  readonly node: AgentPlanNode;
  readonly group: AgentPlanGroup | null;
} | null {
  if (id === null) return null;
  const node = draft.nodes.find((entry) => entry.id === id);
  if (node) return { node, group: null };
  const member = findPlanStep(draft, id);
  return member ? { node: member.step, group: member.group } : null;
}

function PositionFields(
  props: InspectorProps & {
    readonly node: AgentPlanNode;
    readonly isMember: boolean;
  },
): React.ReactElement {
  const { t } = useTranslation();
  const { node } = props;
  const prefix = props.isMember ? "plans.positionInGroup" : "plans.position";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm">
        {t(`${prefix}X`)}
        <Input
          type="number"
          min={0}
          max={6000}
          step={20}
          className="w-24"
          value={node.x}
          disabled={props.disabled}
          onChange={(event) =>
            props.graph.move(node.id, Number(event.target.value), node.y)
          }
        />
      </label>
      <label className="text-sm">
        {t(`${prefix}Y`)}
        <Input
          type="number"
          min={0}
          max={6000}
          step={20}
          className="w-24"
          value={node.y}
          disabled={props.disabled}
          onChange={(event) =>
            props.graph.move(node.id, node.x, Number(event.target.value))
          }
        />
      </label>
      <PlanNodeActions
        label={
          node.type === "start" || node.type === "end"
            ? t(`plans.nodeType.${node.type}`)
            : planNodeLabel(node, props.sources)
        }
        disabled={props.disabled}
        onRemove={() => props.graph.remove(node.id)}
      />
    </div>
  );
}

/** Selection exposes per-step values and grid coordinates without expanding node cards. */
export function PlanInspector(props: InspectorProps): React.ReactElement {
  const { t } = useTranslation();
  const selected = selectedPlanNode(props.draft, props.graph.selectedId);
  if (!selected)
    return (
      <p className="text-sm text-muted-foreground">
        {t("plans.inspectorHint")}
      </p>
    );
  const { node, group } = selected;
  return (
    <section
      className="space-y-3 rounded-lg border border-border p-3"
      aria-label={t("plans.nodeSettings")}
    >
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 font-semibold break-words">
          {planNodeLabel(node, props.sources) || t("plans.missingAgent")}
        </h2>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("plans.clearSelection")}
          title={t("plans.clearSelection")}
          onClick={() => props.graph.select(null)}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <PositionFields {...props} node={node} isMember={group !== null} />
      {node.type === "agent" ? (
        <StepFields {...props} step={node} group={group} />
      ) : null}
      {node.type === "group" ? (
        <>
          <PlanGroupSessionValue
            session={planRunGroupSession(props.run ?? null, node.id)}
          />
          <PlanGroupEditor {...props} group={node} />
        </>
      ) : null}
      {node.type === "parameter" ? (
        <PlanValueFields
          node={node}
          workspaces={props.workspaces.filter(
            (workspace) => workspace.projectId === props.draft.projectId,
          )}
          disabled={props.disabled}
          onChange={props.graph.replaceNode}
        />
      ) : null}
    </section>
  );
}

function StepFields(
  props: InspectorProps & {
    readonly step: AgentPlanStep;
    readonly group: AgentPlanGroup | null;
  },
): React.ReactElement {
  const { t } = useTranslation();
  const { step } = props;
  const template = planStepTemplate(step, props.sources.agents);
  return (
    <fieldset disabled={props.disabled} className="space-y-3">
      <PlanGroupMembership
        step={step}
        group={props.group}
        draft={props.draft}
        graph={props.graph}
        disabled={props.disabled}
      />
      {props.group ? (
        <InheritedSession group={props.group} run={props.run ?? null} />
      ) : null}
      <PlanAgentAssignment
        step={step}
        sources={props.sources}
        disabled={props.disabled}
        onChange={props.graph.replaceStep}
      />
      <PlanNodeConfigurationFields
        step={step}
        sources={props.sources}
        disabled={props.disabled}
        isGroupStep={props.group !== null}
        onChange={props.graph.replaceStep}
      />
      <label className="block space-y-1 text-sm">
        <span>{t("plans.instruction")}</span>
        <Textarea
          maxLength={200000}
          value={step.instruction}
          onChange={(event) =>
            props.graph.replaceStep({
              ...step,
              instruction: event.target.value,
            })
          }
        />
      </label>
      <div className="grid gap-3">
        {template?.parameters.map((parameter) => (
          <PlanParameterInput
            key={parameter.name}
            parameter={parameter}
            step={step}
            group={props.group ?? undefined}
            draft={props.draft}
            sources={props.sources}
            graph={props.graph}
            disabled={props.disabled}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** The session a member continues, read-only, as the selected run reported it. */
function InheritedSession(props: {
  readonly group: AgentPlanGroup;
  readonly run: AgentPlanRun | null;
}): React.ReactElement {
  const { t } = useTranslation();
  const session = planRunGroupSession(props.run, props.group.id);
  return (
    <div className="space-y-1 rounded-lg border border-plan-group/40 bg-plan-group-subtle/60 p-2 text-sm">
      <p>
        {t("plans.groups.session.inherited", {
          name: props.group.name,
          state: t(`plans.groups.session.state.${session.state}`),
        })}
      </p>
      <PlanGroupSessionValue session={session} />
      <p className="text-xs text-muted-foreground">
        {t("plans.groups.session.runScope")}
      </p>
    </div>
  );
}
