import { useTranslation } from "react-i18next";

import { AgentProfileTargets } from "./agent-profile-targets";

import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";

/** Usage shares never change model-access assignments or administrator editing rights. */
export function AgentUsageSharing(props: {
  readonly configuration: AgentConfiguration;
  readonly directory: AgentProfileDirectory;
  readonly disabled: boolean;
  readonly onChange: (configuration: AgentConfiguration) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { configuration } = props;
  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold">
        {t("settings.agents.definition.sharing")}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t("settings.agents.definition.sharingHint")}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          disabled={props.disabled}
          checked={configuration.sharing.isGlobal}
          onChange={(event) =>
            props.onChange({
              ...configuration,
              sharing: {
                ...configuration.sharing,
                isGlobal: event.target.checked,
              },
            })
          }
        />
        {t("settings.agents.definition.shareGlobally")}
      </label>
      <AgentProfileTargets
        directory={props.directory}
        targets={configuration.sharing.targets}
        disabled={props.disabled}
        isSharing
        onChange={(targets) =>
          props.onChange({
            ...configuration,
            sharing: { ...configuration.sharing, targets },
          })
        }
      />
    </section>
  );
}
