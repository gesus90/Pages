import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { planStepTemplate } from "@/definition/AgentPlanConfiguration";
import { Textarea } from "@/app/components/ui/textarea";

import { PlanNodeConfigurationFields } from "./plan-node-configuration-fields";
import { PlanGroupEditor } from "./plan-group-editor";
import { PlanValueFields } from "./plan-value-fields";
import { PlanParameterInput } from "./plan-parameter-input";
import { PlanAgentAssignment } from "./plan-agent-assignment";
import { planNodeLabel } from "./plan-layout";
import { PlanNodeActions } from "./plan-node-actions";

import type {
  AgentPlanInput,
  AgentPlanSources,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { PlanGraphActions } from "./use-plan-graph";

interface InspectorProps {
  readonly draft: AgentPlanInput;
  readonly sources: AgentPlanSources;
  readonly workspaces: readonly AgentWorkspaceChoice[];
  readonly graph: PlanGraphActions;
  readonly disabled: boolean;
}

/** Selection exposes per-step values and grid coordinates without expanding node cards. */
export function PlanInspector(props: InspectorProps): React.ReactElement {
  const { t } = useTranslation();
  const node = props.draft.nodes.find(
    (entry) => entry.id === props.graph.selectedId,
  );
  if (!node)
    return (
      <p className="text-sm text-muted-foreground">
        {t("plans.inspectorHint")}
      </p>
    );
  return (
    <section
      className="space-y-3 rounded-xl border border-border p-4"
      aria-label={t("plans.nodeSettings")}
    >
      <h2 className="font-semibold">
        {planNodeLabel(node, props.sources) || t("plans.missingAgent")}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">
          {t("plans.positionX")}
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
          {t("plans.positionY")}
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
      {node.type === "agent" ? <StepFields {...props} step={node} /> : null}
      {node.type === "group" ? (
        <PlanGroupEditor {...props} group={node} />
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
  props: InspectorProps & { readonly step: AgentPlanStep },
): React.ReactElement {
  const { t } = useTranslation();
  const { step } = props;
  const template = planStepTemplate(step, props.sources.agents);
  return (
    <fieldset disabled={props.disabled} className="space-y-3">
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
