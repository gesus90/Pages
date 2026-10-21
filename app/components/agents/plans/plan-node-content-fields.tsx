import { useTranslation } from "react-i18next";

import { AgentParameterFields } from "@/app/components/settings/agents/agent-parameter-fields";
import { AgentRunOptionsFields } from "@/app/components/settings/agents/agent-run-options-fields";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";

/** Edits the node's own name, instructions, declarations and supported runtime options. */
export function PlanNodeContentFields(props: {
  readonly step: AgentPlanStep;
  readonly configuration: AgentPlanConfiguration;
  readonly disabled: boolean;
  readonly workspaces?: readonly AgentWorkspaceChoice[];
  readonly onChange: (step: AgentPlanStep) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { step, configuration } = props;
  function changeTemplate(next: AgentConfiguration): void {
    const removed = new Set(
      configuration.template.parameters
        .filter(
          (entry) =>
            !next.parameters.some((parameter) => parameter.name === entry.name),
        )
        .map((entry) => entry.name),
    );
    props.onChange({
      ...step,
      bindings: Object.fromEntries(
        Object.entries(step.bindings).filter(([name]) => !removed.has(name)),
      ),
      configuration: {
        ...configuration,
        template: {
          markdown: next.markdown,
          parameters: next.parameters,
          directoryParameter: next.directoryParameter,
          ...(next.run ? { run: next.run } : {}),
        },
      },
    });
  }
  const template: AgentConfiguration = {
    ...emptyAgentConfiguration(),
    ...configuration.template,
  };
  return (
    <div className="space-y-4">
      <label className="block space-y-1 text-sm">
        <span>{t("settings.agents.profiles.name")}</span>
        <Input
          value={configuration.name}
          maxLength={200}
          onChange={(event) =>
            props.onChange({
              ...step,
              configuration: { ...configuration, name: event.target.value },
            })
          }
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>{t("plans.nodeMarkdown")}</span>
        <Textarea
          rows={8}
          maxLength={200000}
          value={template.markdown}
          onChange={(event) =>
            changeTemplate({ ...template, markdown: event.target.value })
          }
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>{t("plans.nodeInstruction")}</span>
        <Textarea
          rows={3}
          maxLength={200000}
          value={step.instruction}
          onChange={(event) =>
            props.onChange({
              ...step,
              configuration,
              instruction: event.target.value,
            })
          }
        />
      </label>
      <AgentParameterFields
        configuration={template}
        workspaceChoices={props.workspaces}
        disabled={props.disabled}
        onChange={changeTemplate}
      />
      <AgentRunOptionsFields
        configuration={template}
        provider={configuration.provider}
        disabled={props.disabled}
        onChange={changeTemplate}
      />
    </div>
  );
}
