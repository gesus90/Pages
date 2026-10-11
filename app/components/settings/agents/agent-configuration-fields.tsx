import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { isAgentProfileTargetKind } from "@/definition/AgentProfile";

import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { AgentProfileTarget } from "@/definition/AgentProfile";

/** Separates organizational scope, project context and personal access mode from sharing. */
export function AgentConfigurationFields(props: {
  readonly configuration: AgentConfiguration;
  readonly projects: readonly { readonly id: string; readonly name: string }[];
  readonly disabled: boolean;
  readonly onChange: (configuration: AgentConfiguration) => void;
  readonly onTargets: (targets: readonly AgentProfileTarget[]) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { configuration } = props;
  function chooseScope(scope: string): void {
    if (!isAgentProfileTargetKind(scope)) return;
    props.onTargets([]);
    props.onChange({
      ...configuration,
      scope,
      accessMode: scope === "person" ? "personal" : "shared",
    });
  }
  return (
    <section className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-1.5 text-sm font-medium">
        <span className="block">{t("settings.agents.definition.tag")}</span>
        <Input
          maxLength={40}
          value={configuration.tag}
          disabled={props.disabled}
          onChange={(event) =>
            props.onChange({ ...configuration, tag: event.target.value })
          }
        />
      </label>
      <label className="space-y-1.5 text-sm font-medium">
        <span className="block">{t("settings.agents.definition.scope")}</span>
        <Select
          size="default"
          className="w-full"
          value={configuration.scope}
          disabled={props.disabled}
          onValueChange={chooseScope}
          options={(["person", "group", "department", "system"] as const).map(
            (scope) => ({
              value: scope,
              label: t(`settings.agents.profiles.target.${scope}`),
            }),
          )}
        />
      </label>
      <label className="space-y-1.5 text-sm font-medium">
        <span className="block">{t("settings.agents.definition.project")}</span>
        <Select
          size="default"
          className="w-full"
          value={configuration.projectId ?? ""}
          disabled={props.disabled}
          onValueChange={(projectId) =>
            props.onChange({ ...configuration, projectId: projectId || null })
          }
          options={[
            { value: "", label: t("settings.agents.definition.global") },
            ...props.projects.map((project) => ({
              value: project.id,
              label: project.name,
            })),
          ]}
        />
      </label>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t(`settings.agents.definition.accessMode.${configuration.accessMode}`)}
      </p>
    </section>
  );
}
