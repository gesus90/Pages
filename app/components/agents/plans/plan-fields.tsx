import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";

import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";

/** Project and GitHub are readonly facts of the selected workspace. */
export function PlanFields(props: {
  readonly draft: AgentPlanInput;
  readonly workspaces: readonly AgentWorkspaceChoice[];
  readonly disabled: boolean;
  readonly onChange: (draft: AgentPlanInput) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { draft } = props;
  const workspace = props.workspaces.find(
    (entry) => entry.id === draft.workspaceId,
  );
  return (
    <fieldset disabled={props.disabled} className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-1 text-sm font-medium">
        <span>{t("plans.name")}</span>
        <Input
          value={draft.name}
          maxLength={120}
          onChange={(event) =>
            props.onChange({ ...draft, name: event.target.value })
          }
        />
      </label>
      <div className="space-y-1">
        <label className="block text-sm font-medium" htmlFor="plan-workspace">
          {t("plans.workspace")}
        </label>
        <Select
          id="plan-workspace"
          ariaLabel={t("plans.workspace")}
          value={draft.workspaceId}
          disabled={props.disabled || draft.nodes.length > 0}
          onValueChange={(workspaceId) =>
            props.onChange({ ...draft, workspaceId })
          }
          options={[
            { value: "", label: t("plans.chooseWorkspace") },
            ...props.workspaces.map((entry) => ({
              value: entry.id,
              label: entry.isUsable
                ? entry.name
                : t("plans.workspaceUnavailable", { name: entry.name }),
              disabled: !entry.isUsable,
            })),
          ]}
        />
        {props.workspaces.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("plans.noWorkspaces")}
          </p>
        ) : null}
        {draft.nodes.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("plans.workspaceChangeHint")}
          </p>
        ) : null}
      </div>
      <dl className="space-y-1 text-sm">
        <dt className="font-medium">{t("plans.project")}</dt>
        <dd>{workspace?.projectName ?? "—"}</dd>
        <dt className="font-medium">{t("plans.github")}</dt>
        <dd className="pages-selectable break-all">
          {workspace?.github?.repoUrl ?? t("workspaces.noGitHub")}
        </dd>
      </dl>
      <div className="space-y-1">
        <label htmlFor="plan-usage" className="block text-sm font-medium">
          {t("plans.usage")}
        </label>
        <Select
          id="plan-usage"
          ariaLabel={t("plans.usage")}
          value={draft.usage}
          disabled={props.disabled}
          onValueChange={(usage) => props.onChange({ ...draft, usage })}
          options={[
            { value: "private", label: t("plans.private") },
            { value: "workspace", label: t("plans.sharedWorkspace") },
          ]}
        />
        <p className="text-xs text-muted-foreground">{t("plans.usageHint")}</p>
      </div>
    </fieldset>
  );
}
