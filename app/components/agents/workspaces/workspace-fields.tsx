import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";

import type {
  AgentWorkspaceInput,
  AgentWorkspaceProject,
} from "@/definition/AgentWorkspace";

/** Lists the manageable projects; those without a GitHub link are shown but cannot be chosen. */
export function WorkspaceFields(props: {
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
    <fieldset disabled={props.disabled} className="space-y-4">
      <label className="block space-y-1.5 text-sm font-medium">
        <span className="block">{t("workspaces.name")}</span>
        <Input
          required
          maxLength={120}
          value={input.name}
          onChange={(event) =>
            props.onChange({ ...input, name: event.target.value })
          }
        />
      </label>
      <label className="block space-y-1.5 text-sm font-medium">
        <span className="block">{t("workspaces.path")}</span>
        <Input
          required
          maxLength={4096}
          value={input.path}
          onChange={(event) =>
            props.onChange({ ...input, path: event.target.value })
          }
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {t("workspaces.pathHint")}
      </p>
      <label className="block space-y-1.5 text-sm font-medium">
        <span className="block">{t("workspaces.project")}</span>
        <Select
          size="default"
          className="w-full"
          disabled={props.disabled}
          value={input.projectId}
          onValueChange={(projectId) => props.onChange({ ...input, projectId })}
          options={[
            { value: "", label: t("workspaces.chooseProject") },
            ...options,
          ]}
        />
      </label>
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
    </fieldset>
  );
}
