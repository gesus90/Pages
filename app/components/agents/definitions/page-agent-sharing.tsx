import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AgentProfileTargets } from "@/app/components/settings/agents/agent-profile-targets";
import { Select } from "@/app/components/ui/select";

import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";

type SharingScope = "private" | "global" | "restricted";
type SharingOperator = "and" | "or";

const SCOPES: readonly SharingScope[] = ["private", "global", "restricted"];

function scopeOf(sharing: AgentConfiguration["sharing"]): SharingScope {
  if (sharing.isGlobal) return "global";
  return sharing.targets.length > 0 ? "restricted" : "private";
}

/** Explicit private/global/restricted choices preserve every selected group and department. */
export function PageAgentSharing(props: {
  readonly configuration: AgentConfiguration;
  readonly directory: AgentProfileDirectory;
  readonly disabled: boolean;
  /** The saved share names a group or department that is gone; saving stores the list without it. */
  readonly hasDeletedTargets: boolean;
  readonly onChange: (configuration: AgentConfiguration) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { configuration } = props;
  const sharing = configuration.sharing;
  // A restricted share without a target looks like a private one in the data.
  const [isRestricted, setRestricted] = useState(
    scopeOf(sharing) === "restricted",
  );
  const scope = isRestricted ? "restricted" : scopeOf(sharing);
  function changeScope(next: SharingScope): void {
    setRestricted(next === "restricted");
    props.onChange({
      ...configuration,
      sharing: {
        ...sharing,
        isGlobal: next === "global",
        targets: next === "restricted" ? sharing.targets : [],
      },
    });
  }
  return (
    <section className="space-y-4">
      {props.hasDeletedTargets ? (
        <p role="status" className="text-sm text-warning">
          {t("pageAgents.deletedTargets")}
        </p>
      ) : null}
      <label className="block space-y-2 text-sm font-medium">
        <span>{t("pageAgents.sharing")}</span>
        <Select<SharingScope>
          value={scope}
          disabled={props.disabled}
          onValueChange={changeScope}
          options={SCOPES.map((option) => ({
            value: option,
            label: t(`pageAgents.${option}`),
          }))}
        />
      </label>
      {isRestricted ? (
        <>
          <label className="block space-y-2 text-sm font-medium">
            <span>{t("pageAgents.operator")}</span>
            <Select<SharingOperator>
              value={sharing.operator ?? "or"}
              disabled={props.disabled}
              options={[
                { value: "or", label: t("pageAgents.or") },
                { value: "and", label: t("pageAgents.and") },
              ]}
              onValueChange={(operator) =>
                props.onChange({
                  ...configuration,
                  sharing: { ...sharing, operator },
                })
              }
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
