import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";

import { AgentAssignmentResult } from "./agent-assignment-result";
import { AgentDiscardDialog } from "./agent-discard-dialog";
import { AgentProfileFormBody } from "./agent-profile-form-body";
import { useAgentProfileForm } from "./use-agent-profile-form";

import type { AgentProfileFormProps } from "./use-agent-profile-form";

/** Edits the one central agent, with a large wiki editor and separate usage shares. */
export function AgentProfileForm(
  props: AgentProfileFormProps,
): React.ReactElement {
  const { t } = useTranslation();
  const { fetcher, draft, selection, input, isPending, isInvalid, dismissal } =
    useAgentProfileForm(props);
  return (
    <DialogContent
      size="lg"
      className="flex h-[90dvh] w-[min(64rem,92vw)] flex-col"
      onEscapeKeyDown={dismissal.guardDismiss}
      onPointerDownOutside={dismissal.guardDismiss}
    >
      <DialogTitle className="text-lg font-semibold">
        {t("settings.agents.profiles.title")}
      </DialogTitle>
      <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
        {t("settings.agents.profiles.description")}
      </DialogDescription>
      <fetcher.Form
        action="/settings/agents"
        method="post"
        className="mt-5 flex min-h-0 flex-1 flex-col"
      >
        <input type="hidden" name="intent" value="save-profile" />
        <input type="hidden" name="profileId" value={props.profile?.id ?? ""} />
        <input type="hidden" name="profile" value={JSON.stringify(input)} />
        <VerticalScrollArea
          className="min-h-0 flex-1"
          contentClassName="space-y-5 px-1 pt-1 pb-10"
        >
          <AgentProfileFormBody
            draft={draft}
            workspaceChoices={props.workspaceChoices}
            selection={selection}
            isPending={isPending}
            directory={props.directory}
            projects={props.projects ?? []}
            taskAssignments={props.taskAssignments}
          />
          <AgentAssignmentResult result={fetcher.data} />
        </VerticalScrollArea>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={isPending}
            onClick={dismissal.requestClose}
          >
            {t("settings.agents.cancel")}
          </Button>
          <Button type="submit" disabled={isPending || isInvalid}>
            {t("settings.agents.definition.save")}
          </Button>
        </div>
      </fetcher.Form>
      <AgentDiscardDialog
        open={dismissal.shouldConfirmClose}
        onOpenChange={dismissal.setConfirmClose}
        onDiscard={props.onSaved}
      />
    </DialogContent>
  );
}
