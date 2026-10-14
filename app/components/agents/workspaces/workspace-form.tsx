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

import { WorkspaceFields } from "./workspace-fields";
import { useWorkspaceForm } from "./use-workspace-form";

import type {
  AgentWorkspaceProject,
  AgentWorkspaceView,
} from "@/definition/AgentWorkspace";

/** Registers metadata for an existing directory and displays the inherited project integration. */
export function WorkspaceForm(props: {
  readonly workspace: AgentWorkspaceView | null;
  readonly projects: readonly AgentWorkspaceProject[];
  /** Whether the person may browse the server's folders, as the server decided for the page. */
  readonly canBrowse: boolean;
  readonly onSaved: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const draft = useWorkspaceForm(props.workspace, props.onSaved);
  const { input, fetcher, isPending } = draft;
  const project = props.projects.find((entry) => entry.id === input.projectId);
  const isIncomplete =
    !input.name.trim() ||
    !input.path.trim() ||
    project === undefined ||
    project.github === null;
  return (
    <DialogContent
      size="lg"
      className="flex max-h-[90dvh] flex-col"
      onEscapeKeyDown={draft.guardDismiss}
      onPointerDownOutside={draft.guardDismiss}
    >
      <DialogTitle className="text-lg font-semibold">
        {t(props.workspace ? "workspaces.edit" : "workspaces.register")}
      </DialogTitle>
      <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
        {t("workspaces.formDescription")}
      </DialogDescription>
      <fetcher.Form
        method="post"
        action="/agents/workspaces"
        className="mt-5 flex min-h-0 flex-col"
      >
        <input type="hidden" name="intent" value="save-workspace" />
        <input
          type="hidden"
          name="workspaceId"
          value={props.workspace?.id ?? ""}
        />
        <input type="hidden" name="workspace" value={JSON.stringify(input)} />
        <VerticalScrollArea
          className="min-h-0 flex-1"
          contentClassName="space-y-5 px-1 pt-1 pb-10"
        >
          <WorkspaceFields
            input={input}
            projects={props.projects}
            canBrowse={props.canBrowse}
            disabled={isPending}
            onChange={draft.setInput}
          />
          <p className="text-xs text-muted-foreground">
            {t("workspaces.visibilityHint")}
          </p>
          <AgentAssignmentResult result={fetcher.data} />
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
          <Button type="submit" disabled={isPending || isIncomplete}>
            {t("workspaces.save")}
          </Button>
        </div>
      </fetcher.Form>
      <AgentDiscardDialog
        open={draft.shouldConfirmClose}
        onOpenChange={draft.setConfirmClose}
        onDiscard={props.onSaved}
      />
    </DialogContent>
  );
}
