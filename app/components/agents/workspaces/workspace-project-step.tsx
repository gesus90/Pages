import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";

import { WorkspaceStep } from "./workspace-step";

import type {
  AgentWorkspaceInput,
  AgentWorkspaceProject,
} from "@/definition/AgentWorkspace";

/** Lists the manageable projects; those without a GitHub link are shown but cannot be chosen. */
export function WorkspaceProjectStep(props: {
  readonly input: AgentWorkspaceInput;
  readonly projects: readonly AgentWorkspaceProject[];
  readonly disabled: boolean;
  readonly onChange: (input: AgentWorkspaceInput) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { input } = props;
  const project = props.projects.find((entry) => entry.id === input.projectId);
  const options = props.projects.map((entry) => ({
    value: entry.id,
    label: entry.github
      ? entry.name
      : t("workspaces.projectWithoutGitHub", { name: entry.name }),
    disabled: entry.github === null,
  }));
  if (input.projectId && !project)
    options.push({
      value: input.projectId,
      label: t("workspaces.unavailableProject"),
      disabled: true,
    });
  const isUnsupported = project !== undefined && project.github === null;
  return (
    <WorkspaceStep number={1} title={t("workspaces.project")}>
      <Select
        size="default"
        className="w-full"
        ariaLabel={t("workspaces.project")}
        disabled={props.disabled}
        value={input.projectId}
        onValueChange={(projectId) => props.onChange({ ...input, projectId })}
        options={[
          { value: "", label: t("workspaces.chooseProject") },
          ...options,
        ]}
      />
      <p className="text-xs text-muted-foreground">
        {t("workspaces.githubRequired")}
      </p>
      <div className="space-y-1.5 text-sm">
        <p className="font-medium">{t("workspaces.github")}</p>
        <p className="pages-selectable break-all">
          {project?.github?.repoUrl ?? t("workspaces.noGitHub")}
        </p>
        {isUnsupported ? (
          <p role="alert" className="text-xs text-warning">
            {t("workspaces.projectUnsupported")}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("workspaces.githubHint")}
          </p>
        )}
      </div>
    </WorkspaceStep>
  );
}
