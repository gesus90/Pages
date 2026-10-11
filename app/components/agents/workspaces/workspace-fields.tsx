import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";

import type {
  AgentWorkspaceInput,
  AgentWorkspacePage,
} from "@/definition/AgentWorkspace";

/** Uses the existing project selector; GitHub is derived rather than entered again. */
export function WorkspaceFields(props: {
  readonly input: AgentWorkspaceInput;
  readonly projects: AgentWorkspacePage["projects"];
  readonly disabled: boolean;
  readonly onChange: (input: AgentWorkspaceInput) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { input } = props;
  const project = props.projects.find((entry) => entry.id === input.projectId);
  const projects = [...props.projects];
  if (input.projectId && !project)
    projects.push({
      id: input.projectId,
      name: t("workspaces.unavailableProject"),
      github: null,
    });
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
            ...projects.map((entry) => ({
              value: entry.id,
              label: entry.name,
              disabled: !props.projects.some(
                (available) => available.id === entry.id,
              ),
            })),
          ]}
        />
      </label>
      <div className="space-y-1.5 text-sm">
        <p className="font-medium">{t("workspaces.github")}</p>
        <p className="pages-selectable break-all">
          {project?.github?.repoUrl ?? t("workspaces.noGitHub")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("workspaces.githubHint")}
        </p>
      </div>
    </fieldset>
  );
}
