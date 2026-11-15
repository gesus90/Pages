import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import { useAgentControl } from "./use-agent-control";

import type { AgentChatModelLabel } from "@/definition/AgentChatControl";
import type { AgentChatSessionBrief } from "@/definition/AgentChatSession";

/** The member a removal asks about. */
export interface RemovalCandidate {
  readonly id: string;
  readonly name: string;
  readonly kind: "human" | "agent";
  /** The session of an agent in the group, for the context it loses. */
  readonly brief?: AgentChatSessionBrief;
  /** The model of an agent in the group, when it deviates from its own. */
  readonly model?: AgentChatModelLabel;
}

interface ChatPageRemoveDialogProps {
  readonly groupId: string;
  readonly groupName: string;
  /** The member to remove; `null` while the dialog is closed. */
  readonly member: RemovalCandidate | null;
  readonly onClose: () => void;
  /** Called once the member is removed. */
  readonly onRemoved?: () => void;
}

/** What a removed agent loses, and that its knowledge stays. */
function AgentConsequences({
  member,
}: {
  readonly member: RemovalCandidate;
}): React.ReactElement {
  const { t } = useTranslation();
  const percent = member.brief?.contextPercent ?? null;
  return (
    <>
      <ul className="mt-4 list-disc rounded-lg border border-destructive/30 bg-destructive-subtle py-3 pr-3 pl-7 text-sm">
        <li>
          {percent === null
            ? t("chatPage.removeMember.session", { name: member.name })
            : t("chatPage.removeMember.sessionPercent", {
                name: member.name,
                percent,
              })}
        </li>
        {member.model?.isOverride === true ? (
          <li>
            {t("chatPage.removeMember.model", { model: member.model.name })}
          </li>
        ) : null}
        <li>{t("chatPage.removeMember.running")}</li>
      </ul>
      <p className="mt-3 rounded-lg border border-success/30 bg-success-subtle p-3 text-sm">
        {t("chatPage.removeMember.kept", { name: member.name })}
      </p>
    </>
  );
}

/**
 * The short question before the creator of a group removes a member
 * (PAGE-380). For an agent it names the session and the model of the group
 * it loses, and that `MEMORY.md`, `DREAM.md`, lessons, recipes and the
 * Lagebuch stay.
 */
export function ChatPageRemoveDialog({
  groupId,
  groupName,
  member,
  onClose,
  onRemoved,
}: ChatPageRemoveDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const request = useAgentControl();

  async function handleRemove(): Promise<void> {
    if (member === null) return;
    const response = await request.send({
      intent: "remove-member",
      groupId,
      memberId: member.id,
    });
    if (response?.ok !== true) return;
    onRemoved?.();
    onClose();
  }

  return (
    <Dialog open={member !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        <DialogTitle className="text-lg font-semibold">
          {t("chatPage.removeMember.title", {
            name: member?.name ?? "",
            group: groupName,
          })}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {t("chatPage.removeMember.description", { name: member?.name ?? "" })}
        </DialogDescription>
        {member?.kind === "agent" ? (
          <AgentConsequences member={member} />
        ) : null}
        {request.failure === null ? null : (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {t(`chatPage.control.failure.${request.failure}`)}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("chatPage.modelChoice.cancel")}
          </Button>
          <Button
            variant="destructive"
            isPending={request.isPending}
            onClick={() => void handleRemove()}
          >
            {t("chatPage.removeMember.confirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
