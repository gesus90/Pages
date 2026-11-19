import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { SegmentedControl } from "@/app/components/ui/segmented-control";
import { Select } from "@/app/components/ui/select";

import { RemotePathStep } from "./remote/remote-path-step";
import { WorkspacePathStep } from "./workspace-path-step";
import { WorkspaceStep } from "./workspace-step";

import type {
  AgentWorkspaceInput,
  AgentWorkspaceProject,
} from "@/definition/AgentWorkspace";
import type { RemoteConnectionChoice } from "@/definition/RemoteConnection";
import type { WorkspaceDraft, WorkspaceLocation } from "./use-workspace-form";

/** Chooses where a new registration lies; the path of the other place is cleared. */
function WorkspaceLocationChoice(props: {
  readonly input: WorkspaceDraft;
  readonly onChange: (input: WorkspaceDraft) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { input } = props;
  function handleChange(location: WorkspaceLocation): void {
    if (location === input.location) return;
    props.onChange({ ...input, location, path: "", connectionId: "" });
  }
  return (
    <div className="space-y-1.5 text-sm font-medium">
      <span className="block">{t("remote.workspace.location")}</span>
      <SegmentedControl<WorkspaceLocation>
        ariaLabel={t("remote.workspace.location")}
        value={input.location}
        onValueChange={handleChange}
        options={[
          { value: "local", label: t("remote.workspace.local") },
          { value: "remote", label: t("remote.workspace.remote") },
        ]}
      />
    </div>
  );
}

/**
 * Name first, then where the workspace lies, then the two choices that make a
 * registration: the project, then its directory.
 */
export function WorkspaceFields(props: {
  readonly input: WorkspaceDraft;
  readonly projects: readonly AgentWorkspaceProject[];
  readonly canBrowse: boolean;
  readonly connections: readonly RemoteConnectionChoice[];
  /** An existing registration keeps its place; only a new one chooses. */
  readonly isLocationFixed: boolean;
  readonly disabled: boolean;
  readonly onChange: (input: WorkspaceDraft) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { input } = props;
  function update(next: Partial<WorkspaceDraft>): void {
    props.onChange({ ...input, ...next });
  }
  const canChooseLocation =
    !props.isLocationFixed && props.connections.length > 0;
  return (
    <fieldset disabled={props.disabled} className="space-y-4">
      <label className="block space-y-1.5 text-sm font-medium">
        <span className="block">{t("workspaces.name")}</span>
        <Input
          required
          maxLength={120}
          value={input.name}
          onChange={(event) => update({ name: event.target.value })}
        />
      </label>
      {canChooseLocation ? (
        <WorkspaceLocationChoice input={input} onChange={props.onChange} />
      ) : null}
      <WorkspaceProjectStep
        input={input}
        projects={props.projects}
        disabled={props.disabled}
        onChange={update}
      />
      {input.location === "remote" ? (
        <RemotePathStep
          input={input}
          connections={props.connections}
          isConnectionFixed={props.isLocationFixed}
          disabled={props.disabled}
          onChange={update}
        />
      ) : (
        <WorkspacePathStep
          input={input}
          canBrowse={props.canBrowse}
          disabled={props.disabled}
          onChange={update}
        />
      )}
    </fieldset>
  );
}

function WorkspaceProjectStep(props: {
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
