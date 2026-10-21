import { useTranslation } from "react-i18next";

import { AgentAssignmentResult } from "@/app/components/settings/agents/agent-assignment-result";
import { AgentDiscardDialog } from "@/app/components/settings/agents/agent-discard-dialog";
import { Button } from "@/app/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";

import { RemoteActionMessage } from "./remote/remote-action-message";
import { WorkspaceFields } from "./workspace-fields";
import { useWorkspaceForm } from "./use-workspace-form";

import type { AgentWorkspaceProject } from "@/definition/AgentWorkspace";
import type { RemoteConnectionChoice } from "@/definition/RemoteConnection";
import type {
  WorkspaceDraft,
  WorkspaceLocation,
  WorkspaceSubject,
} from "./use-workspace-form";

/** The hidden fields of a save, which differ between a local and a remote registration. */
function SaveFields(props: {
  readonly input: WorkspaceDraft;
  readonly workspaceId: string;
}): React.ReactElement {
  const { input } = props;
  const registration = {
    name: input.name,
    path: input.path,
    projectId: input.projectId,
    revision: input.revision,
  };
  if (input.location === "remote")
    return (
      <>
        <input type="hidden" name="intent" value="save-remote-workspace" />
        <input type="hidden" name="workspaceId" value={props.workspaceId} />
        <input
          type="hidden"
          name="input"
          value={JSON.stringify({
            ...registration,
            connectionId: input.connectionId,
          })}
        />
      </>
    );
  return (
    <>
      <input type="hidden" name="intent" value="save-workspace" />
      <input type="hidden" name="workspaceId" value={props.workspaceId} />
      <input
        type="hidden"
        name="workspace"
        value={JSON.stringify(registration)}
      />
    </>
  );
}

function isIncomplete(
  input: WorkspaceDraft,
  project: AgentWorkspaceProject | undefined,
): boolean {
  return (
    !input.name.trim() ||
    !input.path.trim() ||
    project === undefined ||
    project.github === null ||
    (input.location === "remote" && !input.connectionId)
  );
}

/**
 * Registers metadata for an existing directory, on this server or on a
 * remote machine, and displays the inherited project integration.
 */
export function WorkspaceForm(props: {
  readonly subject: WorkspaceSubject;
  readonly projects: readonly AgentWorkspaceProject[];
  /** Whether the person may browse the server's folders, as the server decided for the page. */
  readonly canBrowse: boolean;
  /** Remote connections the person may use; without any, only local registration is offered. */
  readonly connections: readonly RemoteConnectionChoice[];
  /** Where a new registration starts. */
  readonly defaultLocation: WorkspaceLocation;
  readonly onSaved: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const draft = useWorkspaceForm(
    props.subject,
    props.onSaved,
    props.defaultLocation,
  );
  const { input, isPending } = draft;
  const isRemote = input.location === "remote";
  const form = isRemote ? draft.remoteFetcher : draft.fetcher;
  const project = props.projects.find((entry) => entry.id === input.projectId);
  return (
    <DialogContent
      size="lg"
      className="flex max-h-[90dvh] flex-col"
      onEscapeKeyDown={draft.guardDismiss}
      onPointerDownOutside={draft.guardDismiss}
    >
      <DialogTitle className="text-lg font-semibold">
        {t(props.subject ? "workspaces.edit" : "workspaces.register")}
      </DialogTitle>
      <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
        {t(
          isRemote
            ? "remote.workspace.formDescription"
            : "workspaces.formDescription",
        )}
      </DialogDescription>
      <form.Form
        method="post"
        action={isRemote ? "/agents/workspaces/remote" : "/agents/workspaces"}
        className="mt-5 flex min-h-0 flex-col"
      >
        <SaveFields
          input={input}
          workspaceId={props.subject?.workspace.id ?? ""}
        />
        <VerticalScrollArea
          className="min-h-0 flex-1"
          contentClassName="space-y-5 px-1 pt-1 pb-10"
        >
          <WorkspaceFields
            input={input}
            projects={props.projects}
            canBrowse={props.canBrowse}
            connections={props.connections}
            isLocationFixed={props.subject !== null}
            disabled={isPending}
            onChange={draft.setInput}
          />
          <p className="text-xs text-muted-foreground">
            {t(
              isRemote
                ? "remote.workspace.visibilityHint"
                : "workspaces.visibilityHint",
            )}
          </p>
          {isRemote ? (
            <RemoteActionMessage result={draft.remoteFetcher.data} />
          ) : (
            <AgentAssignmentResult result={draft.fetcher.data} />
          )}
        </VerticalScrollArea>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={isPending}
            onClick={draft.requestClose}
          >
            {t("settings.agents.cancel")}
          </Button>
          <Button
            type="submit"
            disabled={isPending || isIncomplete(input, project)}
            isPending={isPending}
          >
            {t("workspaces.save")}
          </Button>
        </div>
      </form.Form>
      <AgentDiscardDialog
        open={draft.shouldConfirmClose}
        onOpenChange={draft.setConfirmClose}
        onDiscard={props.onSaved}
      />
    </DialogContent>
  );
}
