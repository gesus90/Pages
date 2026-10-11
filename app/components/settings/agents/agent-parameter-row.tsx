import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { AgentParameterDefault } from "./agent-parameter-default";

import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";

import type { AgentParameter } from "@/definition/AgentParameters";

/** Edits declarations and workspace defaults; concrete step values remain separate. */
export function AgentParameterRow(props: {
  readonly workspaceChoices?: readonly AgentWorkspaceChoice[];
  readonly parameter: AgentParameter;
  readonly disabled: boolean;
  readonly onChange: (parameter: AgentParameter | null) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { parameter } = props;
  function chooseType(type: string): void {
    if (type !== "text" && type !== "workspace" && type !== "wiki") return;
    props.onChange({ ...parameter, type, defaultValue: null });
  }
  return (
    <fieldset
      disabled={props.disabled}
      className="space-y-3 rounded-xl border border-border p-3"
    >
      <legend className="pages-selectable px-1 font-mono text-sm">
        {parameter.name}
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium">
          <span className="block">
            {t("settings.agents.definition.parameterName")}
          </span>
          <Input
            value={parameter.name}
            maxLength={64}
            required
            pattern="[a-z][a-z0-9_]{0,63}"
            onChange={(event) =>
              props.onChange({ ...parameter, name: event.target.value })
            }
          />
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          <span className="block">
            {t("settings.agents.definition.parameterType")}
          </span>
          <Select
            size="default"
            className="w-full"
            value={parameter.type}
            disabled={props.disabled}
            onValueChange={chooseType}
            options={(["text", "workspace", "wiki"] as const).map((type) => ({
              value: type,
              label: t(`settings.agents.definition.type.${type}`),
            }))}
          />
        </label>
      </div>
      <label className="block space-y-1.5 text-sm font-medium">
        <span className="block">
          {t("settings.agents.definition.parameterDescription")}
        </span>
        <Input
          value={parameter.description}
          maxLength={1000}
          onChange={(event) =>
            props.onChange({ ...parameter, description: event.target.value })
          }
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={parameter.isRequired}
          onChange={(event) =>
            props.onChange({ ...parameter, isRequired: event.target.checked })
          }
        />
        {t("settings.agents.definition.required")}
      </label>
      <AgentParameterDefault
        parameter={parameter}
        onChange={props.onChange}
        workspaceChoices={props.workspaceChoices ?? []}
        disabled={props.disabled}
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={props.disabled}
        onClick={() => props.onChange(null)}
        aria-label={t("settings.agents.definition.removeParameter", {
          name: parameter.name,
        })}
      >
        <Trash2 className="size-4" aria-hidden="true" />
        {t("settings.agents.remove")}
      </Button>
    </fieldset>
  );
}
