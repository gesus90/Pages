import { useTranslation } from "react-i18next";

import { PageAgentModelFields } from "@/app/components/agents/definitions/page-agent-model-fields";
import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import {
  defaultAgentRunOptions,
  emptyAgentConfiguration,
} from "@/definition/AgentConfiguration";
import { copyPlanConfiguration } from "@/definition/AgentPlanConfiguration";

import type { AgentPlanSources, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanCompletion } from "@/definition/AgentPlanSession";
import type { PageAgentInput } from "@/definition/PageAgent";

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
  readonly disabled: boolean;
  readonly isGroupStep?: boolean;
  readonly onChange: (step: AgentPlanStep) => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const source = props.sources.agents.find(
    (entry) => entry.id === props.step.agentId,
  );
  const configuration =
    props.step.configuration ?? (source ? copyPlanConfiguration(source) : null);
  if (!configuration) return null;
  const models = props.sources.models ?? [];
  const draft: PageAgentInput = {
    name: configuration.name,
    modelProfileId: configuration.modelProfileId,
    reasoningEffort: configuration.reasoningEffort,
    configuration: emptyAgentConfiguration(),
  };
  function changeModel(input: PageAgentInput): void {
    if (!configuration) return;
    const model = models.find((entry) => entry.id === input.modelProfileId);
    if (!model) return;
    props.onChange({
      ...props.step,
      configuration: {
        ...configuration,
        modelProfileId: model.id,
        model: model.model,
        provider: model.provider,
        reasoningEffort: input.reasoningEffort,
        template: {
          ...configuration.template,
          ...(model.provider === configuration.provider
            ? {}
            : { run: defaultAgentRunOptions(model.provider) }),
        },
      },
    });
  }
  return (
    <fieldset disabled={props.disabled} className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t("plans.nodeConfigurationHint")}
      </p>
      <label className="block space-y-1 text-sm">
        <span>{t("plans.nodeMarkdown")}</span>
        <Textarea
          rows={10}
          maxLength={200000}
          value={configuration.template.markdown}
          onChange={(event) =>
            props.onChange({
              ...props.step,
              configuration: {
                ...configuration,
                template: {
                  ...configuration.template,
                  markdown: event.target.value,
                },
              },
            })
          }
        />
      </label>
      <PlanCompletionField
        step={props.step}
        isGroupStep={props.isGroupStep}
        onChange={props.onChange}
      />
      <PageAgentModelFields
        draft={draft}
        models={models}
        disabled={props.disabled}
        isModelWithdrawn={
          !models.some((model) => model.id === configuration.modelProfileId)
        }
        onChange={changeModel}
      />
    </fieldset>
  );
}
