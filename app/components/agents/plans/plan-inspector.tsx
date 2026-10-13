import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";

import { PlanValueFields } from "./plan-value-fields";
import { PlanParameterInput } from "./plan-parameter-input";
import { planNodeLabel } from "./plan-layout";

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
      <h2 className="font-semibold">{planNodeLabel(node, props.sources)}</h2>
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
        <Button
          size="sm"
          variant="outline"
          disabled={props.disabled}
          onClick={() => props.graph.remove(node.id)}
        >
          {t("plans.removeNode")}
        </Button>
      </div>
      {node.type === "agent" ? <StepFields {...props} step={node} /> : null}
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
  const agent = props.sources.agents.find((entry) => entry.id === step.agentId);
  return (
    <fieldset disabled={props.disabled} className="space-y-3">
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
      {agent?.configuration.accessMode === "personal" ? (
        <div className="space-y-1">
          <label className="text-sm" htmlFor="plan-personal-access">
            {t("plans.personalAccess")}
          </label>
          <Select
            id="plan-personal-access"
            ariaLabel={t("plans.personalAccess")}
            value={step.personalAgentId ?? ""}
            disabled={props.disabled}
            options={[
              { value: "", label: t("plans.uniquePersonalAccess") },
              ...agent.availability.personalChoices.map((choice) => ({
                value: choice.id,
                label: choice.name,
              })),
            ]}
            onValueChange={(personalAgentId) =>
              props.graph.replaceStep({
                ...step,
                personalAgentId: personalAgentId || null,
              })
            }
          />
        </div>
      ) : null}
      <div className="grid gap-3">
        {agent?.configuration.parameters.map((parameter) => (
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
