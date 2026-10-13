import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AgentProfileTargets } from "@/app/components/settings/agents/agent-profile-targets";
import { Select } from "@/app/components/ui/select";

import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";

type SharingScope = "private" | "global" | "restricted";

/** Reuses the Pages sharing directory and OR/AND semantics without granting edit or project access. */
export function PlanSharing(props: {
  readonly draft: AgentPlanInput;
  readonly directory: AgentProfileDirectory;
  readonly disabled: boolean;
  readonly onChange: (draft: AgentPlanInput) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { draft } = props;
  const sharing = draft.sharing ?? {
    isGlobal: draft.usage === "workspace",
    targets: [],
    operator: "or" as const,
  };
  const [isRestricted, setRestricted] = useState(
    draft.usage === "workspace" && !sharing.isGlobal,
  );
  let scope: SharingScope = "private";
  if (draft.usage === "workspace") scope = "global";
  if (isRestricted) scope = "restricted";
  function changeScope(next: SharingScope): void {
    setRestricted(next === "restricted");
    props.onChange({
      ...draft,
      usage: next === "private" ? "private" : "workspace",
      sharing: {
        ...sharing,
        isGlobal: next === "global",
        targets: next === "restricted" ? sharing.targets : [],
      },
    });
  }
  return (
    <div className="space-y-2">
      <label className="block space-y-1 text-sm font-medium">
        <span>{t("plans.usage")}</span>
        <Select<SharingScope>
          value={scope}
          disabled={props.disabled}
          onValueChange={changeScope}
          options={[
            { value: "private", label: t("pageAgents.private") },
            { value: "global", label: t("pageAgents.global") },
            { value: "restricted", label: t("pageAgents.restricted") },
          ]}
        />
      </label>
      {isRestricted ? (
        <>
          <Select<"or" | "and">
            ariaLabel={t("pageAgents.operator")}
            value={sharing.operator ?? "or"}
            disabled={props.disabled}
            options={[
              { value: "or", label: t("pageAgents.or") },
              { value: "and", label: t("pageAgents.and") },
            ]}
            onValueChange={(operator) =>
              props.onChange({ ...draft, sharing: { ...sharing, operator } })
            }
          />
          <AgentProfileTargets
            kinds={["group", "department"]}
            directory={props.directory}
            targets={sharing.targets}
            disabled={props.disabled}
            isSharing
            onChange={(targets) =>
              props.onChange({ ...draft, sharing: { ...sharing, targets } })
            }
          />
        </>
      ) : null}
      <p className="text-xs text-muted-foreground">{t("plans.usageHint")}</p>
    </div>
  );
}
