import { useTranslation } from "react-i18next";

import { AgentAssignmentResult } from "@/app/components/settings/agents/agent-assignment-result";
import { AgentDiscardDialog } from "@/app/components/settings/agents/agent-discard-dialog";
import { AgentProfileTargets } from "@/app/components/settings/agents/agent-profile-targets";
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
  AgentProfileDirectory,
  AgentProfileTarget,
} from "@/definition/AgentProfile";
import type {
  AgentWorkspacePage,
  AgentWorkspaceView,
} from "@/definition/AgentWorkspace";

/** Registers metadata for an existing directory and displays the inherited project integration. */
export function WorkspaceForm(props: {
  readonly workspace: AgentWorkspaceView | null;
  readonly projects: AgentWorkspacePage["projects"];
  readonly directory: AgentProfileDirectory;
  readonly onSaved: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const draft = useWorkspaceForm(props.workspace, props.onSaved);
  const { input, fetcher, isPending } = draft;
  function changeTargets(targets: readonly AgentProfileTarget[]): void {
    draft.setInput({
      ...input,
      targets: targets.flatMap((target) =>
        target.kind === "system"
          ? []
          : [{ kind: target.kind, targetId: target.targetId }],
      ),
    });
  }
  const isIncomplete =
    !input.name.trim() ||
    !input.path.trim() ||
    !input.projectId ||
    input.targets.length === 0;
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
        {t("workspaces.description")}
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
            disabled={isPending}
            onChange={draft.setInput}
          />
          <AgentProfileTargets
            directory={props.directory}
            targets={input.targets}
            isSharing
            disabled={isPending}
            onChange={changeTargets}
          />
          <p className="text-xs text-muted-foreground">
            {t("workspaces.usageHint")}
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
