import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import {
  agentParameterIssues,
  scanAgentPlaceholders,
} from "@/definition/AgentParameters";

import { AgentParameterRow } from "./agent-parameter-row";

import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";
import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { AgentParameter } from "@/definition/AgentParameters";

/** Shows declarations and explicitly confirmed discoveries; prompt references have no runner side effects. */
export function AgentParameterFields(props: {
  readonly workspaceChoices?: readonly AgentWorkspaceChoice[];
  readonly configuration: AgentConfiguration;
  readonly disabled: boolean;
  readonly onChange: (configuration: AgentConfiguration) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { configuration } = props;
  const scanned = scanAgentPlaceholders(configuration.markdown);
  const suggestions = scanned.placeholders.filter(
    (entry, index, all) =>
      !configuration.parameters.some(
        (parameter) => parameter.name === entry.name,
      ) &&
      all.findIndex((candidate) => candidate.name === entry.name) === index,
  );
  function replace(index: number, parameter: AgentParameter | null): void {
    const parameters = configuration.parameters.flatMap((entry, position) => {
      if (position !== index) return [entry];
      return parameter === null ? [] : [parameter];
    });
    props.onChange({ ...configuration, parameters });
  }
  function add(name: string, type: AgentParameter["type"]): void {
    props.onChange({
      ...configuration,
      parameters: [
        ...configuration.parameters,
        { name, type, description: "", isRequired: true, defaultValue: null },
      ],
    });
  }
  function addManual(): void {
    let index = 1;
    while (
      configuration.parameters.some(
        (entry) => entry.name === `parameter_${index}`,
      )
    )
      index++;
    add(`parameter_${index}`, "text");
  }
  return (
    <section
      className="space-y-4"
      aria-label={t("settings.agents.definition.parameters")}
    >
      <h3 className="text-base font-semibold">
        {t("settings.agents.definition.parameters")}
      </h3>
      <AgentParameterIssueSummary configuration={configuration} />
      {suggestions.map((entry) => (
        <div
          key={entry.name}
          className="flex flex-wrap items-center gap-2 text-sm"
        >
          <span className="pages-selectable font-mono">{entry.name}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.disabled || configuration.parameters.length >= 50}
            onClick={() => add(entry.name, entry.type)}
          >
            {t("settings.agents.definition.confirmParameter")}
          </Button>
        </div>
      ))}
      {configuration.parameters.map((parameter, index) => (
        <AgentParameterRow
          key={index}
          parameter={parameter}
          workspaceChoices={props.workspaceChoices}
          disabled={props.disabled}
          onChange={(next) => replace(index, next)}
        />
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={props.disabled || configuration.parameters.length >= 50}
        onClick={addManual}
      >
        <Plus className="size-4" aria-hidden="true" />
        {t("settings.agents.definition.addParameter")}
      </Button>
      <AgentDirectoryParameter {...props} />
      <p className="text-xs text-muted-foreground">
        {t("settings.agents.definition.bindingLater")}
      </p>
    </section>
  );
}

function AgentParameterIssueSummary(props: {
  readonly configuration: AgentConfiguration;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const issues = agentParameterIssues(props.configuration);
  if (issues.length === 0) return null;
  return (
    <p role="status" className="text-sm text-warning">
      {t("settings.agents.definition.parameterIssues", {
        issues: issues
          .map((issue) => t(`settings.agents.definition.issue.${issue}`))
          .join(", "),
      })}
    </p>
  );
}

function AgentDirectoryParameter(props: {
  readonly configuration: AgentConfiguration;
  readonly disabled: boolean;
  readonly onChange: (configuration: AgentConfiguration) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { configuration } = props;
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      <span className="block">
        {t("settings.agents.definition.directoryParameter")}
      </span>
      <Select
        size="default"
        className="w-full"
        value={configuration.directoryParameter ?? ""}
        disabled={props.disabled}
        onValueChange={(name) =>
          props.onChange({
            ...configuration,
            directoryParameter: name || null,
          })
        }
        options={[
          { value: "", label: t("settings.agents.definition.noDirectory") },
          ...configuration.parameters
            .filter((parameter) => parameter.type === "workspace")
            .map((parameter) => ({
              value: parameter.name,
              label: parameter.name,
            })),
        ]}
      />
    </label>
  );
}
