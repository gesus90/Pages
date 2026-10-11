import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";

import type { AgentParameter } from "@/definition/AgentParameters";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";

/** Defaults retain workspace IDs; directory paths are resolved by the server at preparation. */
export function AgentParameterDefault(props: {
  readonly parameter: AgentParameter;
  readonly onChange: (parameter: AgentParameter) => void;
  readonly disabled: boolean;
  readonly workspaceChoices: readonly AgentWorkspaceChoice[];
}): React.ReactElement {
  const { t } = useTranslation();
  if (props.parameter.type === "text") return <AgentTextDefault {...props} />;
  if (props.parameter.type === "workspace")
    return <AgentWorkspaceDefault {...props} />;
  return (
    <p className="text-xs text-muted-foreground">
      {t("settings.agents.definition.referenceLater")}
    </p>
  );
}

function AgentWorkspaceDefault(props: {
  readonly parameter: AgentParameter;
  readonly onChange: (parameter: AgentParameter) => void;
  readonly disabled: boolean;
  readonly workspaceChoices: readonly AgentWorkspaceChoice[];
}): React.ReactElement {
  const { t } = useTranslation();
  const { parameter } = props;
  const workspaceId =
    parameter.defaultValue?.type === "workspace"
      ? parameter.defaultValue.workspaceId
      : "";
  const options = props.workspaceChoices.map((workspace) => ({
    value: workspace.id,
    label: `${workspace.name} · ${workspace.projectName}`,
    disabled: !workspace.isUsable,
    description: workspace.reason
      ? t(`settings.agents.error.${workspace.reason}`)
      : workspace.path,
  }));
  if (workspaceId && !options.some((option) => option.value === workspaceId))
    options.push({
      value: workspaceId,
      label: t("workspaces.unavailableDefault"),
      disabled: true,
      description: t("settings.agents.error.workspace_access_denied"),
    });
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      <span className="block">
        {t("settings.agents.definition.defaultValue")}
      </span>
      <Select
        size="default"
        className="w-full"
        disabled={props.disabled}
        value={workspaceId}
        onValueChange={(id) =>
          props.onChange({
            ...parameter,
            defaultValue: id ? { type: "workspace", workspaceId: id } : null,
          })
        }
        options={[{ value: "", label: t("workspaces.noDefault") }, ...options]}
      />
    </label>
  );
}

function AgentTextDefault(props: {
  readonly parameter: AgentParameter;
  readonly onChange: (parameter: AgentParameter) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { parameter } = props;
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={parameter.defaultValue !== null}
          onChange={(event) =>
            props.onChange({
              ...parameter,
              defaultValue: event.target.checked
                ? { type: "text", text: "" }
                : null,
            })
          }
        />
        {t("settings.agents.definition.useDefault")}
      </label>
      {parameter.defaultValue?.type === "text" ? (
        <label className="block space-y-1.5 text-sm font-medium">
          <span className="block">
            {t("settings.agents.definition.defaultValue")}
          </span>
          <Textarea
            value={parameter.defaultValue.text}
            maxLength={200000}
            onChange={(event) =>
              props.onChange({
                ...parameter,
                defaultValue: { type: "text", text: event.target.value },
              })
            }
          />
        </label>
      ) : null}
    </div>
  );
}
