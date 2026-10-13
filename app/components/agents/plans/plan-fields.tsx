import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";

import { PlanSharing } from "./plan-sharing";

import type { AgentPlanInput } from "@/definition/AgentPlan";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";

/** Project selection narrows authorized workspaces; the server verifies their relationship again. */
export function PlanFields(props: {
  readonly draft: AgentPlanInput;
  readonly workspaces: readonly AgentWorkspaceChoice[];
  readonly directory: AgentProfileDirectory;
  readonly disabled: boolean;
  readonly onChange: (draft: AgentPlanInput) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { draft } = props;
  const workspace = props.workspaces.find(
    (entry) => entry.id === draft.workspaceId,
  );
  const projectId = draft.projectId ?? workspace?.projectId ?? "";
  const projects = [
    ...new Map(
      props.workspaces.map((entry) => [entry.projectId, entry.projectName]),
    ).entries(),
  ];
  const contextDisabled = props.disabled || draft.nodes.length > 0;
  return (
    <fieldset
      disabled={props.disabled}
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
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
      <label className="space-y-1 text-sm font-medium">
        <span>{t("plans.project")}</span>
        <Select
          value={projectId}
          disabled={contextDisabled}
          ariaLabel={t("plans.project")}
          options={[
            { value: "", label: t("plans.chooseProject") },
            ...projects.map(([id, name]) => ({ value: id, label: name })),
          ]}
          onValueChange={(next) =>
            props.onChange({ ...draft, projectId: next, workspaceId: "" })
          }
        />
      </label>
      <div className="space-y-1 text-sm">
        <label className="block font-medium" htmlFor="plan-workspace">
          {t("plans.workspace")}
        </label>
        <Select
          id="plan-workspace"
          ariaLabel={t("plans.workspace")}
          value={draft.workspaceId}
          disabled={contextDisabled || !projectId}
          onValueChange={(workspaceId) =>
            props.onChange({ ...draft, workspaceId })
          }
          options={[
            { value: "", label: t("plans.chooseWorkspace") },
            ...props.workspaces
              .filter((entry) => entry.projectId === projectId)
              .map((entry) => ({
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
      <PlanSharing
        draft={draft}
        directory={props.directory}
        disabled={props.disabled}
        onChange={props.onChange}
      />
    </fieldset>
  );
}
