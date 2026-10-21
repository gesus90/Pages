import { useTranslation } from "react-i18next";

import { PageAgentModelFields } from "@/app/components/agents/definitions/page-agent-model-fields";
import { Select } from "@/app/components/ui/select";
import { PlanNodeContentFields } from "./plan-node-content-fields";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import {
  copyPlanConfiguration,
  planConfigurationModelKey,
} from "@/definition/AgentPlanConfiguration";

import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";

import type { AgentPlanSources, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { AgentPlanCompletion } from "@/definition/AgentPlanSession";
import type { PageAgentInput, PageAgentModel } from "@/definition/PageAgent";

/**
 * The node with another released model and reasoning level.
 *
 * @remarks
 * Only the node's own configuration copy changes, never its template. A
 * changed provider must support the node's retained run options.
 */
export function planStepWithModel(
  step: AgentPlanStep,
  configuration: AgentPlanConfiguration,
  model: PageAgentModel,
  reasoningEffort: string | null,
): AgentPlanStep {
  return {
    ...step,
    configuration: {
      ...configuration,
      modelProfileId: model.id,
      connectionId: model.connectionId,
      model: model.model,
      provider: model.provider,
      reasoningEffort,
    },
  };
}

/** Chooses what decides that the node finished; it belongs to the node, not to its configuration copy. */
function PlanCompletionField(props: {
  readonly step: AgentPlanStep;
  readonly isGroupStep?: boolean;
  readonly onChange: (step: AgentPlanStep) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { step } = props;
  function change(completion: AgentPlanCompletion): void {
    const { completion: previous, ...rest } = step;
    if (completion === "todos") props.onChange({ ...rest, completion });
    else if (previous !== undefined) props.onChange(rest);
  }
  return (
    <div className="space-y-1 text-sm">
      <label htmlFor={`plan-completion-${step.id}`}>
        {t("plans.completion.label")}
      </label>
      <Select
        id={`plan-completion-${step.id}`}
        ariaLabel={t("plans.completion.label")}
        value={step.completion ?? "report"}
        options={[
          { value: "report", label: t("plans.completion.report") },
          { value: "todos", label: t("plans.completion.todos") },
        ]}
        onValueChange={change}
      />
      <p className="text-xs text-muted-foreground">
        {t(
          props.isGroupStep
            ? "plans.groups.acceptanceHint"
            : `plans.completion.${step.completion ?? "report"}Hint`,
        )}
      </p>
    </div>
  );
}

/** Edits the selected node's content and released model without writing to its template. */
export function PlanNodeConfigurationFields(props: {
  readonly step: AgentPlanStep;
  readonly sources: AgentPlanSources;
  readonly workspaces?: readonly AgentWorkspaceChoice[];
  readonly disabled: boolean;
  readonly isGroupStep?: boolean;
  readonly onChange: (step: AgentPlanStep) => void;
}): React.ReactElement | null {
  const source = props.sources.agents.find(
    (entry) => entry.id === props.step.agentId,
  );
  const configuration =
    props.step.configuration ?? (source ? copyPlanConfiguration(source) : null);
  if (!configuration) return null;
  const models = props.sources.models ?? [];
  const draft: PageAgentInput = {
    name: configuration.name,
    modelProfileId: planConfigurationModelKey(configuration),
    reasoningEffort: configuration.reasoningEffort,
    configuration: emptyAgentConfiguration(),
  };
  function changeModel(input: PageAgentInput): void {
    if (!configuration) return;
    const model = models.find((entry) => entry.id === input.modelProfileId);
    if (!model) return;
    props.onChange(
      planStepWithModel(
        props.step,
        configuration,
        model,
        input.reasoningEffort,
      ),
    );
  }
  return (
    <fieldset disabled={props.disabled} className="space-y-3">
      <PlanNodeContentFields
        step={props.step}
        configuration={configuration}
        workspaces={props.workspaces}
        disabled={props.disabled}
        onChange={props.onChange}
      />
      <PlanCompletionField
        step={props.step}
        isGroupStep={props.isGroupStep}
        onChange={props.onChange}
      />
      <PageAgentModelFields
        savedModel={configuration.model}
        draft={draft}
        models={models}
        disabled={props.disabled}
        isModelWithdrawn={
          !models.some(
            (model) => model.id === planConfigurationModelKey(configuration),
          )
        }
        onChange={changeModel}
      />
    </fieldset>
  );
}
