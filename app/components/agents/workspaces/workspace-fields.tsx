import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";
import { SegmentedControl } from "@/app/components/ui/segmented-control";

import { RemotePathStep } from "./remote/remote-path-step";
import { WorkspacePathStep } from "./workspace-path-step";
import { WorkspaceProjectStep } from "./workspace-project-step";

import type { AgentWorkspaceProject } from "@/definition/AgentWorkspace";
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
