import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import { AgentProfileTargets } from "@/app/components/settings/agents/agent-profile-targets";

import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";

/** Explicit private/global/restricted choices preserve every selected group and department. */
export function PageAgentSharing(props: {
  readonly configuration: AgentConfiguration;
  readonly directory: AgentProfileDirectory;
  readonly disabled: boolean;
  readonly onChange: (configuration: AgentConfiguration) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { configuration } = props;
  const sharing = configuration.sharing;
  let scope = sharing.targets.length > 0 ? "restricted" : "private";
  if (sharing.isGlobal) scope = "global";
  const [isRestricted, setRestricted] = useState(scope === "restricted");
  function changeScope(next: string): void {
    setRestricted(next === "restricted");
    props.onChange({
      ...configuration,
      sharing: {
        isGlobal: next === "global",
        targets: next === "restricted" ? sharing.targets : [],
        operator: sharing.operator ?? "or",
      },
    });
  }
  return (
    <section className="space-y-4">
      <label className="block space-y-2 text-sm font-medium">
        <span>{t("pageAgents.sharing")}</span>
        <Select
          value={isRestricted ? "restricted" : scope}
          disabled={props.disabled}
          onValueChange={changeScope}
          options={["private", "global", "restricted"].map((option) => ({
            value: option,
            label: t(`pageAgents.${option}`),
          }))}
        />
      </label>
      {isRestricted ? (
        <>
          <label className="block space-y-2 text-sm font-medium">
            <span>{t("pageAgents.operator")}</span>
            <Select
              value={sharing.operator ?? "or"}
              disabled={props.disabled}
              options={[
                { value: "or", label: t("pageAgents.or") },
                { value: "and", label: t("pageAgents.and") },
              ]}
              onValueChange={(operator) => {
                if (operator === "and" || operator === "or")
                  props.onChange({
                    ...configuration,
                    sharing: { ...sharing, operator },
                  });
              }}
            />
          </label>
          <AgentProfileTargets
            kinds={["group", "department"]}
            directory={props.directory}
            targets={sharing.targets}
            disabled={props.disabled}
            isSharing
            onChange={(targets) =>
              props.onChange({
                ...configuration,
                sharing: { ...sharing, targets },
              })
            }
          />
        </>
      ) : null}
    </section>
  );
}
